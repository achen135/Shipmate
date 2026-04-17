/**
 * The AI provider layer's front door.
 *
 * - `createProvider(name, apiKey)` builds a client for a key the caller holds
 *   in plain text: only the key-saving action, for the test call before the
 *   key is stored.
 * - `getProvider(db, userId)` is how everything else gets a client: it reads
 *   the user's sealed key with the service-role client, decrypts it, and
 *   returns a ready provider. **This is the only place a stored key is ever
 *   decrypted** (lib/ai/guard.test.ts fails the build if anything else
 *   imports `openApiKey`), so there is one function to audit, and the
 *   plaintext key never leaves this module except inside the SDK client.
 *
 * Usable from the app's server code and from the worker (M7). The `db`
 * passed in must be a service-role client: signed-in users can't select the
 * ciphertext at all.
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

export async function getProvider(
  db: SupabaseClient<Database>,
  userId: string,
  options: { env?: Env; fetch?: typeof fetch } = {},
): Promise<AiProvider> {
  const { data, error } = await db
    .from("api_keys")
    .select("provider, ciphertext, iv")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`load api key: ${error.message}`);
  if (!data) throw new NoKeyError();
  const provider = data.provider as ProviderName;
  if (!PROVIDERS.includes(provider)) throw new NoKeyError();

  const env = options.env ?? process.env;
  const apiKey = openApiKey(data, { userId, provider }, loadMasterKey(env));
  return createProvider(provider, apiKey, { env, fetch: options.fetch });
}
