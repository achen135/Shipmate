/**
 * The AI provider layer's front door.
 *
 * - `createProvider(name, apiKey)` builds a client for a key the caller holds
 *   in plain text: only the key-saving action, for the test call before the
 *   key is stored.
 * - `getProvider(sources, userId)` is how everything else gets a client.
 *   Resolution order (Alex, 2026-10-14): the user's own sealed key if they
 *   saved one, decrypted here; otherwise Shipmate's shared free Gemini key.
 *   **This is the only place a stored key is ever decrypted**
 *   (lib/ai/guard.test.ts fails if anything else imports `openApiKey`), so
 *   there is one function to audit, and the plaintext key never leaves this
 *   module except inside the SDK client.
 *
 * Where the keys come from depends on who's asking: the web app's server
 * reads the caller's own sealed row through `sealed_api_key()` and the
 * shared key through `shared_ai_key()`, both with the server secret
 * (lib/ai/keys.ts); the worker reads both with its service-role client
 * (`serviceRoleKeySources`). Signed-in users can't read either at all. The
 * shared key lives in Supabase Vault only, never in env or the repo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { e2eAiBaseUrl } from "@/lib/e2e-origin";
import type { Database } from "@/lib/supabase/database.types";

import { createAnthropicProvider } from "./anthropic";
import { loadMasterKey, openApiKey } from "./crypto";
import { createGoogleProvider } from "./google";
import { createOpenAIProvider } from "./openai";
import { type AiProvider, PROVIDERS, type ProviderName } from "./types";

export * from "./types";

type Env = Record<string, string | undefined>;

export function createProvider(
  name: ProviderName,
  apiKey: string,
  options: {
    env?: Env;
    fetch?: typeof fetch;
    timeoutMs?: number;
    shared?: boolean;
    backup?: boolean;
  } = {},
): AiProvider {
  const env = options.env ?? process.env;
  const config = {
    apiKey: apiKey.trim(),
    baseURL: e2eAiBaseUrl(name, env),
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
  };
  switch (name) {
    case "anthropic":
      return createAnthropicProvider(config);
    case "openai":
      return createOpenAIProvider(config);
    case "google":
      return createGoogleProvider({
        ...config,
        shared: options.shared,
        backup: options.backup,
      });
  }
}

/**
 * What a person sees when the shared free key hits Google's limits. Not
 * their fault and not broken: the per-minute limit clears within a minute,
 * the daily one at midnight Pacific.
 */
export const SHARED_BUSY_MESSAGE =
  "Shipmate's shared free AI is busy right now. Try again in a minute, or add your own key in Profile → AI.";

/**
 * What a person sees when the shared key's model is overloaded (a 503) and
 * a few quick retries didn't get through: Google's moment, not theirs.
 */
export const SHARED_OVERLOADED_MESSAGE =
  "Google's servers are briefly overloaded. Try again in a moment.";

/** Neither a personal key nor the shared key is available. */
export class NoKeyError extends Error {
  constructor() {
    super(
      "Shipmate's shared AI isn't set up right now. Tell Alex, or add your own key in Profile → AI.",
    );
    this.name = "NoKeyError";
  }
}

export type SealedKey = {
  provider: string;
  ciphertext: string;
  iv: string;
};

/** Fetches one user's sealed key, or null when they have none. */
export type SealedKeySource = (userId: string) => Promise<SealedKey | null>;

/** Fetches Shipmate's shared Gemini key, or null when none is set up. */
export type SharedKeySource = () => Promise<string | null>;

export type KeySources = { sealed: SealedKeySource; shared: SharedKeySource };

/** Worker only: read both keys with the service-role client. */
export function serviceRoleKeySources(
  db: SupabaseClient<Database>,
): KeySources {
  let shared: Promise<string | null> | null = null;
  return {
    sealed: async (userId) => {
      const { data, error } = await db
        .from("api_keys")
        .select("provider, ciphertext, iv")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`load api key: ${error.message}`);
      return data;
    },
    // Read once per worker process.
    shared: () => {
      shared ??= (async () => {
        const { data, error } = await db.rpc("worker_shared_ai_key");
        if (error) throw new Error(`load shared key: ${error.code}`);
        return data?.trim() || null;
      })();
      return shared;
    },
  };
}

/**
 * A ready provider for this user: their own key if they saved one, else the
 * shared free Gemini key (`provider.shared` says which). Throws NoKeyError
 * when there's neither. `sharedBackup` puts the shared key on its backup
 * model (Flash-Lite); it never affects a user's own key.
 */
export async function getProvider(
  sources: KeySources,
  userId: string,
  options: { env?: Env; fetch?: typeof fetch; sharedBackup?: boolean } = {},
): Promise<AiProvider> {
  const env = options.env ?? process.env;
  const sealed = await sources.sealed(userId);
  if (sealed) {
    const provider = sealed.provider as ProviderName;
    if (!PROVIDERS.includes(provider)) throw new NoKeyError();
    const apiKey = openApiKey(sealed, { userId, provider }, loadMasterKey(env));
    return createProvider(provider, apiKey, { env, fetch: options.fetch });
  }

  const shared = await sources.shared();
  if (!shared) throw new NoKeyError();
  return createProvider("google", shared, {
    env,
    fetch: options.fetch,
    shared: true,
    backup: options.sharedBackup,
  });
}
