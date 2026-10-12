/**
 * The badge on /admin/sources. Red ("alert") is the worker's own verdict
 * (sources.last_alert: an error, or the count fell by more than half). Amber
 * ("stale") means no successful check for a while, which usually means the
 * Watch trigger stopped, not the source. Grey ("best_effort") is a Workday
 * source whose last check didn't work: expected now and then, never an alert.
 */

export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export type SourceStatus =
  "alert" | "stale" | "healthy" | "unchecked" | "best_effort";

export function sourceStatus(
  source: {
    kind?: string;
    last_error?: string | null;
    last_alert: string | null;
    last_success_at: string | null;
  },
  now = Date.now(),
): SourceStatus {
  if (source.last_alert) return "alert";
  if (source.kind === "workday" && source.last_error) return "best_effort";
  if (!source.last_success_at) return "unchecked";
  return now - new Date(source.last_success_at).getTime() > STALE_AFTER_MS
    ? "stale"
    : "healthy";
}
