/**
 * The 30-minute watcher run (GitHub Actions `watch.yml`).
 *
 * M0: a no-op that proves the wiring: the schedule fires, secrets reach the
 * process, and the service-role client can talk to Supabase. Later milestones
 * fill in the run order from CLAUDE.md (aggregators → hot boards → … → runs).
 */

import { createClient } from "@supabase/supabase-js";

import { formatWarning, loadWorkerConfig } from "./config";

async function main(): Promise<number> {
  const started = Date.now();
  const result = loadWorkerConfig(process.env);

  if (!result.ok) {
    console.log(
      formatWarning(
        `missing ${result.missing.join(", ")}; skipping this run. ` +
          "Add them as repository secrets (Settings → Secrets and variables → Actions).",
        process.env,
      ),
    );
    return 0;
  }

  const { supabaseUrl, serviceRoleKey } = result.config;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Connectivity + credentials check. Listing one auth user needs the
  // service-role key, so a wrong key fails here instead of later. It also
  // counts as project activity, which keeps the free tier from pausing.
  const { error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) {
    console.error(`[worker] Supabase check failed: ${error.message}`);
    return 1;
  }

  console.log(`[worker] ok: Supabase reachable (${Date.now() - started} ms)`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error("[worker] crashed:", err);
    process.exitCode = 1;
  },
);
