import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import { loadMasterKey, MasterKeyError, sealApiKey } from "./crypto";
import { AiError, createProvider, getProvider, PROVIDERS } from "./index";

/**
 * App-side key handling: save (test, then seal, then store) and load for a
 * request. The only app code that holds the service-role client.
 *
 * Logging rule: only the provider name and an error code or status, never a
 * key, a ciphertext, or an SDK error object.
 */

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
  try {
    masterKey = loadMasterKey();
  } catch (error) {
    if (error instanceof MasterKeyError) {
      console.error(`[ai] can't store keys: ${error.message}`);
      return {
        ok: false,
        message: "Shipmate can't store keys right now. Tell Alex.",
      };
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
  const admin = createAdminClient();
  const stored = await admin.from("api_keys").upsert(
    {
      user_id: userId,
      provider,
      ...sealed,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (stored.error) {
    console.error(`[ai] store key failed: ${stored.error.code}`);
    return { ok: false, message: "Couldn't save the key. Try again." };
  }
  const profile = await admin
    .from("profiles")
    .update({ ai_provider: provider, mode: "ai" })
    .eq("user_id", userId);
  if (profile.error) {
    console.error(`[ai] turn on AI mode failed: ${profile.error.code}`);
    return {
      ok: false,
      message: "Saved the key, but couldn't turn on AI mode. Try again.",
    };
  }
  return { ok: true, last4: sealed.last4 };
}

/** A ready provider for this user's saved key (decrypted inside getProvider). */
export function providerFor(userId: string) {
  return getProvider(createAdminClient(), userId);
}
