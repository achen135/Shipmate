/**
 * Liveness check for the deployed app: "is this deployment serving?".
 * Touches no data and reads nothing at request time, so with Cache Components
 * it is prerendered at build. The commit is baked in by Vercel's build env,
 * which is exactly what a deploy check wants to compare against.
 */
export function GET() {
  return Response.json({
    ok: true,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  });
}
