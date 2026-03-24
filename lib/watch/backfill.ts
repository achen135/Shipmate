import "server-only";

import { firstMatch } from "@/lib/matching";
import { rulesFromRow } from "@/lib/schemas/watch-profile";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/select-all";

/**
 * The 7-day backfill (Spec "First Inbox isn't empty"): when a user finishes
 * "What to watch" or edits a watch profile, add open postings from the last
 * week that match. No notification, no tailoring.
 *
 * Runs as the signed-in user, through RLS: postings are readable by any
 * member, and the insert policy only accepts the caller's own rows. Existing
 * rows are left alone (a skipped posting stays skipped).
 */

export const BACKFILL_DAYS = 7;
const INSERT_CHUNK = 500;

export async function backfillInbox(now = Date.now()): Promise<number> {
  const supabase = await createClient();

  const { data: profiles, error } = await supabase
    .from("watch_profiles")
    .select(
      "id, name, preset, categories, include_keywords, exclude_keywords, terms, locations, remote_ok, needs_sponsorship",
    )
    .eq("active", true)
    .order("created_at");
  if (error) throw new Error(`backfill profiles: ${error.message}`);
  if (profiles.length === 0) return 0;
  const rules = profiles.map((p) => ({ id: p.id, ...rulesFromRow(p) }));

  const since = new Date(now - BACKFILL_DAYS * 86_400_000).toISOString();
  const postings = await selectAll(
    (from, to) =>
      supabase
        .from("postings")
        .select("id, title, category, terms, locations")
        .eq("status", "open")
        .gte("posted_at", since)
        .order("id")
        .range(from, to),
    "backfill postings",
  );

  const rows = postings.flatMap((posting) => {
    const match = firstMatch(rules, posting);
    return match
      ? [{ posting_id: posting.id, watch_profile_id: match.id }]
      : [];
  });

  let added = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { data, error: insertError } = await supabase
      .from("user_postings")
      .upsert(rows.slice(i, i + INSERT_CHUNK), {
        onConflict: "user_id,posting_id",
        ignoreDuplicates: true,
      })
      .select("id");
    if (insertError) throw new Error(`backfill insert: ${insertError.message}`);
    added += data.length;
  }
  return added;
}
