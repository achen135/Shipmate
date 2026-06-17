import "server-only";

import { SHARED_BACKUP_MODEL } from "@/lib/ai/models";
import { createClient } from "@/lib/supabase/server";

import {
  TAILORING_FIELDS,
  type TailoringView,
  toTailoringView,
} from "./queries";

/**
 * The fast-review queue's list (M9 §2): the signed-in user's postings whose
 * latest tailoring finished, still in the Inbox or on To Apply. Read-only:
 * the results are exactly what the worker's pipeline saved (the same rows,
 * parsed by the same toTailoringView as the review page), and this file
 * never writes a tailoring. Changing a status goes through the same
 * changeStatus action as the cards.
 */

/** The queue shows at most this many, newest tailoring first. */
export const QUEUE_LIMIT = 60;

export type QueueItem = {
  /** user_postings.id */
  id: string;
  status: "new" | "saved";
  posting: {
    id: string;
    title: string;
    company: string;
    locations: string[];
    closed: boolean;
  };
  tailoring: TailoringView;
  /** Ran on the shared key's backup model: the score may be less reliable. */
  onBackupModel: boolean;
};

const ITEM_FIELDS =
  `id, status, posting:postings!inner(id, title, locations, status, company:companies(name)), tailorings(${TAILORING_FIELDS}, finished_at)` as const;

export async function listReviewQueue(): Promise<QueueItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_postings")
    .select(ITEM_FIELDS)
    .in("status", ["new", "saved"])
    .order("created_at", { ascending: false })
    .limit(300)
    .order("created_at", { referencedTable: "tailorings", ascending: false })
    .limit(1, { referencedTable: "tailorings" });
  if (error) throw new Error(`review queue: ${error.message}`);

  const items: (QueueItem & { finishedAt: string })[] = [];
  for (const row of data) {
    const latest = row.tailorings[0];
    // Only a finished latest tailoring: one being redone, or failed, isn't a
    // result to review.
    if (!latest || latest.state !== "done") continue;
    const tailoring = toTailoringView(latest);
    items.push({
      id: row.id,
      status: row.status as QueueItem["status"],
      posting: {
        id: row.posting.id,
        title: row.posting.title,
        company: row.posting.company?.name ?? "Unknown company",
        locations: row.posting.locations,
        closed: row.posting.status === "closed",
      },
      tailoring,
      onBackupModel:
        tailoring.keySource === "shared" &&
        tailoring.model === SHARED_BACKUP_MODEL.id,
      finishedAt: latest.finished_at ?? latest.created_at,
    });
  }
  items.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  return items.slice(0, QUEUE_LIMIT).map((item) => ({
    id: item.id,
    status: item.status,
    posting: item.posting,
    tailoring: item.tailoring,
    onBackupModel: item.onBackupModel,
  }));
}
