import type { PostingCardData } from "@/components/postings/posting-card";
import { formatRelative } from "@/lib/format/time";
import { dayLabel, tailoringDay } from "@/lib/tailor/mass";

import { postedAt } from "./group";
import type { InboxItem } from "./queries";

/**
 * The card's tailoring line, from the row's latest tailoring: queued for a
 * later day ("Tailor all" past the daily cap), in progress, or the fit
 * score after tailoring. Nothing for a failed one, one without a score (too
 * little posting text), or none at all (Simple mode).
 */
export function tailoringBadge(
  latest:
    { state: string; score_after: number | null; run_on?: string } | undefined,
  today: string,
): PostingCardData["tailoring"] {
  if (!latest) return null;
  if (latest.state === "queued" && latest.run_on && latest.run_on > today) {
    return { kind: "later", day: dayLabel(latest.run_on) };
  }
  if (latest.state === "queued" || latest.state === "running") {
    return { kind: "working" };
  }
  if (latest.state === "done" && latest.score_after !== null) {
    return { kind: "score", score: latest.score_after };
  }
  return null;
}

/** A user_postings row (with its posting) → what PostingCard renders. */
export function toCardData(item: InboxItem, now: number): PostingCardData {
  const p = item.posting;
  return {
    tailoring: tailoringBadge(item.tailorings[0], tailoringDay(now)),
    id: item.id,
    unseen: item.seen_at === null,
    posting: {
      id: p.id,
      title: p.title,
      url: p.url,
      company: p.company?.name ?? "Unknown company",
      locations: p.locations,
      sourceNames: p.source_names,
      closed: p.status === "closed",
    },
    postedLabel: `posted ${formatRelative(postedAt(item), now)}`,
  };
}
