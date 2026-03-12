#!/usr/bin/env node
/**
 * Run a command against the LOCAL Supabase stack instead of the linked project.
 *
 *   node scripts/with-local-supabase.mjs npm run dev
 *   node scripts/with-local-supabase.mjs npm run db:test:rls
 *
 * `.env.local` holds the production project's URL and keys. A plain
 * `npm run dev` on a branch with a migration production hasn't got yet fails
 * with errors that look nothing like "wrong database". This sets the env vars
 * from `supabase status` (they win over `.env.local`, which Next and the
 * worker only read for keys not already set).
 *
 * The local keys are the CLI's well-known development keys, not secrets, but
 * they're read rather than copied so they can't go stale.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const [, , ...command] = process.argv;

if (command.length === 0) {
  console.error(
    "usage: node scripts/with-local-supabase.mjs <command> [args...]\n" +
      "e.g.   node scripts/with-local-supabase.mjs npm run dev",
  );
  process.exit(1);
}

/**
 * Docker Desktop on macOS installs its CLI to ~/.docker/bin and relies on the
 * shell profile to put it on PATH. Without it the Supabase CLI fails with
 * `docker: command not found`.
 */
function withDockerOnPath(env) {
  const onPath = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (onPath.status === 0) return env;

  const dockerBin = join(homedir(), ".docker", "bin");
  if (!existsSync(join(dockerBin, "docker"))) return env;
  return { ...env, PATH: `${dockerBin}${delimiter}${env.PATH ?? ""}` };
}

/**
 * `supabase status -o json` pretty-prints over many lines and may print a
 * notice first, so slice from the first `{` to the last `}`.
 */
function readLocalStatus(env) {
  const result = spawnSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    env,
  });
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { status: null, text };
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (parsed.API_URL && parsed.PUBLISHABLE_KEY && parsed.SECRET_KEY) {
      return { status: parsed, text };
    }
  } catch {
    // Fall through to the diagnostic below.
  }
  return { status: null, text };
}

const baseEnv = withDockerOnPath(process.env);
const { status, text } = readLocalStatus(baseEnv);

if (!status) {
  console.error(
    "Could not read the local Supabase stack.\n\n" +
      "Start it first (needs Docker Desktop running):\n" +
      "  npx supabase start\n\n" +
      "Re-apply migrations from scratch with:\n" +
      "  npm run db:reset:local     # local only; `db push` targets PRODUCTION\n\n" +
      "--- what `supabase status` said ---\n" +
      text.trim(),
  );
  process.exit(1);
}

const env = {
  ...baseEnv,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  // Local email goes to Mailpit (status.MAILPIT_URL), so magic links work.
  NEXT_PUBLIC_AUTH_EMAIL_ENABLED: "true",
  // Worker + tests only. Never read by app code.
  SUPABASE_URL: status.API_URL,
  SUPABASE_SERVICE_ROLE_KEY: status.SECRET_KEY,
  // E2E reads magic-link emails from Mailpit's API.
  ...(status.MAILPIT_URL ? { MAILPIT_URL: status.MAILPIT_URL } : {}),
};

console.log(`→ local Supabase: ${status.API_URL}`);
if (status.MAILPIT_URL)
  console.log(`→ magic-link emails: ${status.MAILPIT_URL}`);
console.log(`→ ${command.join(" ")}\n`);

const child = spawn(command[0], command.slice(1), { env, stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
