/**
 * Worker configuration, read from the environment (GitHub Actions secrets in
 * CI, `.env.local` when run locally via `npm run worker`).
 *
 * Missing secrets are not an error: a fork, or this repo before the secrets
 * are added, should get a green run with a warning rather than a red X every
 * 30 minutes. Present-but-wrong secrets *are* an error (the run fails loudly).
 */

export type WorkerConfig = {
  supabaseUrl: string;
  /** Secret key (sb_secret_…) or legacy service_role JWT. Bypasses RLS. */
  serviceRoleKey: string;
  /**
   * The workflow's GITHUB_TOKEN, for GitHub API calls (1,000 requests/hour
   * instead of 60 unauthenticated). Optional: local runs work without it.
   */
  githubToken?: string;
};

export type ConfigResult =
  { ok: true; config: WorkerConfig } | { ok: false; missing: string[] };

type Env = Record<string, string | undefined>;

export function loadWorkerConfig(env: Env): ConfigResult {
  // SUPABASE_URL is the Actions secret name; locally the app's public var
  // already holds the same value, so accept it rather than duplicate it.
  const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return { ok: false, missing };
  return {
    ok: true,
    config: {
      supabaseUrl,
      serviceRoleKey,
      ...(env.GITHUB_TOKEN ? { githubToken: env.GITHUB_TOKEN } : {}),
    },
  };
}

/**
 * Format a warning so GitHub Actions shows it as an annotation on the run
 * summary page (`::warning::`), and as plain text everywhere else.
 */
export function formatWarning(message: string, env: Env): string {
  return env.GITHUB_ACTIONS === "true"
    ? `::warning title=Worker skipped::${message}`
    : `[worker] warning: ${message}`;
}
