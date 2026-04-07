/**
 * E2E only: with E2E_ATS_ORIGIN set AND the worker pointed at a local
 * Supabase stack, board API calls go to that origin (e2e/helpers/
 * ats-mock-server.mjs) instead of the real ATS. Neither is ever true in the
 * Watch workflow, where this returns `fetchImpl` untouched.
 */
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
