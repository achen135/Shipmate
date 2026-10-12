/**
 * "No update in 30 days": an application still waiting (applied or OA) whose
 * last status change is over 30 days old. A badge only; the status never
 * changes by itself.
 */

export const STALE_AFTER_DAYS = 30;

const DAY = 86_400_000;

export function isStale(
  row: {
    status: string;
    /** Newest status_events.at, if any. */
    lastEventAt: string | null;
    /** YYYY-MM-DD. */
    appliedAt: string | null;
  },
  now: number,
): boolean {
  if (row.status !== "applied" && row.status !== "oa") return false;
  // Noon UTC on the applied date: hours don't matter at a 30-day scale.
  const last = row.lastEventAt ?? (row.appliedAt && `${row.appliedAt}T12:00Z`);
  if (!last) return false;
  const at = new Date(last).getTime();
  return !Number.isNaN(at) && now - at > STALE_AFTER_DAYS * DAY;
}
