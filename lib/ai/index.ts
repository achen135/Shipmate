/**
 * The AI provider layer's front door.
 *
 * - `createProvider(name, apiKey)` builds a client for a key the caller holds
 *   in plain text: only the key-saving action, for the test call before the
 *   key is stored.
 * - `getProvider(source, userId)` is how everything else gets a client: it
 *   fetches the user's sealed key from `source`, decrypts it, and returns a
 *   ready provider. **This is the only place a stored key is ever
 *   decrypted** (lib/ai/guard.test.ts fails if anything else imports
 *   `openApiKey`), so there is one function to audit, and the plaintext key
 *   never leaves this module except inside the SDK client.
 *
 * Where the sealed key comes from depends on who's asking: the web app's
 * server reads the caller's own row through `sealed_api_key()` with the
 * server secret (lib/ai/keys.ts); the worker (M7) reads with its
 * service-role client (`serviceRoleKeySource`). Signed-in users can't select
 * the ciphertext at all.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { e2eAiBaseUrl } from "@/lib/e2e-origin";
import type { Database } from "@/lib/supabase/database.types";

import { createAnthropicProvider } from "./anthropic";
import { loadMasterKey, openApiKey } from "./crypto";
import { createOpenAIProvider } from "./openai";
import { type AiProvider, PROVIDERS, type ProviderName } from "./types";

export * from "./types";

type Env = Record<string, string | undefined>;

export function createProvider(
  name: ProviderName,
  apiKey: string,
  options: { env?: Env; fetch?: typeof fetch; timeoutMs?: number } = {},
): AiProvider {
  const env = options.env ?? process.env;
  const config = {
    apiKey: apiKey.trim(),
    baseURL: e2eAiBaseUrl(name, env),
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
  };
  return name === "anthropic"
    ? createAnthropicProvider(config)
    : createOpenAIProvider(config);
}

export class NoKeyError extends Error {
  constructor() {
    super("No AI key saved. Add one in Profile → AI.");
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

/** Worker only: read the sealed key with the service-role client. */
export function serviceRoleKeySource(
  db: SupabaseClient<Database>,
): SealedKeySource {
  return async (userId) => {
    const { data, error } = await db
      .from("api_keys")
      .select("provider, ciphertext, iv")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`load api key: ${error.message}`);
    return data;
  };
}

export async function getProvider(
  source: SealedKeySource,
  userId: string,
  options: { env?: Env; fetch?: typeof fetch } = {},
): Promise<AiProvider> {
  const sealed = await source(userId);
  if (!sealed) throw new NoKeyError();
  const provider = sealed.provider as ProviderName;
  if (!PROVIDERS.includes(provider)) throw new NoKeyError();

  const env = options.env ?? process.env;
  const apiKey = openApiKey(sealed, { userId, provider }, loadMasterKey(env));
  return createProvider(provider, apiKey, { env, fetch: options.fetch });
}
