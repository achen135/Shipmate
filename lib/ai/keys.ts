import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

import { loadMasterKey, MasterKeyError, sealApiKey } from "./crypto";
import {
  AiError,
  createProvider,
  getProvider,
  type KeySources,
  PROVIDERS,
} from "./index";

/**
 * App-side key handling: save (test, then seal, then store) and load for a
 * request. All of it goes through the signed-in user's own client and
 * database functions that also require the server secret
 * (`API_KEY_SERVER_SECRET`, server env only), so the web app never needs the
 * service-role key and a browser holding the user's session still can't read
 * the ciphertext or the shared key.
 *
 * Logging rule: only the provider name and an error code or status, never a
 * key, a ciphertext, the shared key, the server secret, or an SDK error
 * object.
 */

export const SERVER_SECRET_ENV = "API_KEY_SERVER_SECRET";

class ServerSecretError extends Error {
  constructor() {
    super(`${SERVER_SECRET_ENV} isn't set (32+ characters).`);
    this.name = "ServerSecretError";
  }
}

function serverSecret(): string {
  const secret = process.env[SERVER_SECRET_ENV]?.trim() ?? "";
  if (secret.length < 32) throw new ServerSecretError();
  return secret;
}

export const apiKeyInputSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    apiKey: z
      .string()
      .trim()
      .min(20, "That's too short to be an API key.")
      .max(300, "That's too long to be an API key.")
      .regex(/^\S+$/, "An API key has no spaces in it."),
  })
  .superRefine((value, ctx) => {
    const looksGoogle = value.apiKey.startsWith("AIza");
    if (value.provider === "google") {
      if (!looksGoogle) {
        ctx.addIssue({
          code: "custom",
          path: ["apiKey"],
          message: "Gemini API keys start with AIza.",
        });
      }
      return;
    }
    if (looksGoogle) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "That's a Google key. Pick Google Gemini above.",
      });
      return;
    }
    const looksAnthropic = value.apiKey.startsWith("sk-ant-");
    if (value.provider === "anthropic" && !looksAnthropic) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "Anthropic keys start with sk-ant-. Is this an OpenAI key?",
      });
    }
    if (value.provider === "openai" && looksAnthropic) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "That's an Anthropic key. Pick Anthropic above.",
      });
    }
    if (value.provider === "openai" && !value.apiKey.startsWith("sk-")) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "OpenAI keys start with sk-.",
      });
    }
  });

export type SaveKeyResult =
  | { ok: true; last4: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const NOT_CONFIGURED = "Shipmate can't store keys right now. Tell Alex.";

/**
 * Test the key with one real (free) call, and only if that works, encrypt
 * and store it, replacing any key the user had (one key per user), and turn
 * on AI mode.
 */
export async function saveApiKey(
  userId: string,
  values: unknown,
): Promise<SaveKeyResult> {
  const parsed = apiKeyInputSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }
  const { provider, apiKey } = parsed.data;

  let masterKey: Buffer;
  let secret: string;
  try {
    masterKey = loadMasterKey();
    secret = serverSecret();
  } catch (error) {
    if (error instanceof MasterKeyError || error instanceof ServerSecretError) {
      console.error(`[ai] can't store keys: ${error.message}`);
      return { ok: false, message: NOT_CONFIGURED };
    }
    throw error;
  }

  try {
    await createProvider(provider, apiKey, { timeoutMs: 20_000 }).testKey();
  } catch (error) {
    const safe =
      error instanceof AiError
        ? error
        : new AiError("provider_error", "The test call failed. Try again.");
    console.warn(
      `[ai] key test failed: ${provider} ${safe.code}${safe.status ? ` ${safe.status}` : ""}`,
    );
    return { ok: false, message: safe.message };
  }

  const sealed = sealApiKey(apiKey, { userId, provider }, masterKey);
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_api_key", {
    p_secret: secret,
    p_provider: provider,
    p_ciphertext: sealed.ciphertext,
    p_iv: sealed.iv,
    p_last4: sealed.last4,
  });
  if (error) {
    // 42501 here means the server secret doesn't match Vault's.
    console.error(`[ai] store key failed: ${error.code}`);
    return {
      ok: false,
      message:
        error.code === "42501"
          ? NOT_CONFIGURED
          : "Couldn't save the key. Try again.",
    };
  }
  return { ok: true, last4: sealed.last4 };
}

/**
 * The signed-in user's own sealed key, through sealed_api_key(), and the
 * shared Gemini key, through shared_ai_key() (invited members only).
 */
async function appKeySources(): Promise<KeySources> {
  const supabase = await createClient();
  const secret = serverSecret();
  return {
    sealed: async () => {
      const { data, error } = await supabase.rpc("sealed_api_key", {
        p_secret: secret,
      });
      if (error) throw new Error(`load api key: ${error.code}`);
      return data?.[0] ?? null;
    },
    shared: async () => {
      const { data, error } = await supabase.rpc("shared_ai_key", {
        p_secret: secret,
      });
      if (error) throw new Error(`load shared key: ${error.code}`);
      return data?.trim() || null;
    },
  };
}

/**
 * A ready provider for the signed-in user: their saved key (decrypted
 * inside getProvider), or the shared free Gemini key if they have none.
 * `userId` must be the signed-in user: the database returns only the
 * caller's own row, and the key is bound to that id.
 */
export async function providerFor(userId: string) {
  return getProvider(await appKeySources(), userId);
}
