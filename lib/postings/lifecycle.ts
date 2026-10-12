/**
 * Posting lifecycle (CLAUDE.md "close stale"). State lives per link (one
 * source's view of one job):
 *
 * - `active`: the source lists the job as open. Simplify `active=false` (or
 *   hidden) flips it at once.
 * - `missedRuns`: consecutive successful snapshots that left the job out.
 *
 * A link is live while active and missed fewer than 2 times; a posting is
 * open while any of its links is live. A failed fetch is not a snapshot, so
 * nothing here runs for it and nothing counts as missing.
 */

export const MISSES_TO_CLOSE = 2;

export type LinkLife = { active: boolean; missedRuns: number };

export function isLive(link: LinkLife): boolean {
  return link.active && link.missedRuns < MISSES_TO_CLOSE;
}

export function postingStatus(links: readonly LinkLife[]): "open" | "closed" {
  return links.some(isLive) ? "open" : "closed";
}

/**
 * After a fresh snapshot: listed → reset misses and take the source's
 * active flag; left out → one more miss (capped, so a long-gone job isn't
 * rewritten every run).
 */
export function afterSnapshot(
  link: LinkLife,
  listed: { active: boolean } | null,
): LinkLife {
  if (listed) return { active: listed.active, missedRuns: 0 };
  if (!link.active) return link;
  return {
    active: true,
    missedRuns: Math.min(link.missedRuns + 1, MISSES_TO_CLOSE),
  };
}

/**
 * After an unchanged check (same commit SHA, nothing downloaded): the last
 * snapshot still holds, so a job it left out is still left out. Without this,
 * a job dropped just before upstream went quiet would sit at one miss for
 * hours.
 */
export function afterUnchanged(link: LinkLife): LinkLife {
  if (!link.active || link.missedRuns === 0) return link;
  return {
    active: true,
    missedRuns: Math.min(link.missedRuns + 1, MISSES_TO_CLOSE),
  };
}

export function sameLife(a: LinkLife, b: LinkLife): boolean {
  return a.active === b.active && a.missedRuns === b.missedRuns;
}
