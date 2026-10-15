import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Reads for Inbox, To Apply, and posting detail, as the signed-in user (RLS:
 * own user_postings; postings and companies readable by members).
 */

const POSTING_FIELDS =
  "id, title, url, locations, terms, category, sponsorship, degrees, posted_at, first_seen_at, source_names, status, company:companies(name)" as const;

/** With the latest tailoring (AI mode), for the card's spinner and fit score. */
const ITEM_FIELDS =
  `id, status, skip_reason, seen_at, created_at, posting:postings!inner(${POSTING_FIELDS}), tailorings(state, score_after, created_at)` as const;

/** The Inbox shows at most this many; triage brings older ones into view. */
export const LIST_LIMIT = 300;

export type ListStatus = "new" | "saved";

export async function listUserPostings(status: ListStatus) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_postings")
    .select(ITEM_FIELDS)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT)
    .order("created_at", { referencedTable: "tailorings", ascending: false })
    .limit(1, { referencedTable: "tailorings" });
  if (error) throw new Error(`user_postings: ${error.message}`);
  return data;
}

export type InboxItem = Awaited<ReturnType<typeof listUserPostings>>[number];
export type PostingSummary = InboxItem["posting"];

export async function getPostingDetail(postingId: string) {
  const supabase = await createClient();
  const [posting, item] = await Promise.all([
    supabase
      .from("postings")
      .select(POSTING_FIELDS)
      .eq("id", postingId)
      .maybeSingle(),
    supabase
      .from("user_postings")
      .select("id, status, skip_reason, seen_at")
      .eq("posting_id", postingId)
      .maybeSingle(),
  ]);
  if (posting.error) throw new Error(`posting: ${posting.error.message}`);
  if (item.error) throw new Error(`user_posting: ${item.error.message}`);
  return posting.data ? { posting: posting.data, item: item.data } : null;
}
