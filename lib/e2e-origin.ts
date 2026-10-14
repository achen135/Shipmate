/**
 * E2E only: with E2E_ATS_ORIGIN set AND the worker (or the app) pointed at a
 * local Supabase stack, board API calls go to that origin (e2e/helpers/
 * ats-mock-server.mjs) instead of the real ATS. Neither is ever true in the
 * Watch workflow or on Vercel, where this returns `fetchImpl` untouched.
 */
import type { PushSender } from "@/lib/notify/types";

type Env = Record<string, string | undefined>;

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;

export function withE2eOrigin(fetchImpl: typeof fetch, env: Env): typeof fetch {
  const origin = env.E2E_ATS_ORIGIN;
  const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!origin || !LOCAL.test(supabaseUrl)) return fetchImpl;
  return (input, init) => {
    const target = new URL(
      input instanceof Request ? input.url : String(input),
    );
    // Only the board APIs; GitHub calls (the aggregators) are left alone.
    if (target.hostname.endsWith("github.com")) return fetchImpl(input, init);
    return fetchImpl(new URL(target.pathname + target.search, origin), init);
  };
}

/**
 * E2E only: with E2E_PUSH_ORIGIN set AND a local Supabase stack, a push goes
 * to that origin as plain JSON (e2e/helpers/ats-mock-server.mjs records it)
 * instead of to a browser vendor's push service, so a test can count what was
 * sent. The real sender's encryption is covered by a unit test.
 */
export function withE2ePush(sender: PushSender, env: Env): PushSender {
  const origin = env.E2E_PUSH_ORIGIN;
  const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!origin || !LOCAL.test(supabaseUrl)) return sender;
  return async (device, payload) => {
    const response = await fetch(new URL("/push", origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: device.endpoint, payload }),
    });
    return response.ok
      ? { ok: true }
      : { ok: false, gone: false, error: `mock push ${response.status}` };
  };
}

/**
 * E2E only: with E2E_AI_ORIGIN set AND a local Supabase stack, AI provider
 * calls go to that origin (e2e/helpers/ats-mock-server.mjs answers like the
 * Anthropic, OpenAI and Gemini APIs) instead of the real ones, so tests never spend
 * money or need a real key. Undefined everywhere else, which means the
 * SDK's own default URL.
 */
export function e2eAiBaseUrl(
  provider: "anthropic" | "openai" | "google",
  env: Env,
): string | undefined {
  const origin = env.E2E_AI_ORIGIN;
  const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!origin || !LOCAL.test(supabaseUrl)) return undefined;
  const path = {
    anthropic: "/anthropic",
    openai: "/openai/v1",
    google: "/google",
  };
  return new URL(path[provider], origin).toString();
}
