import type { PostingCardData } from "@/components/postings/posting-card";
import { formatRelative } from "@/lib/format/time";

import { postedAt } from "./group";
import type { InboxItem } from "./queries";

/** A user_postings row (with its posting) → what PostingCard renders. */
export function toCardData(item: InboxItem, now: number): PostingCardData {
  const p = item.posting;
  return {
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
