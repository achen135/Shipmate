/**
 * Step "match" of the run: newly listed postings → Inbox rows (status new)
 * for every invited user with a matching active watch profile. Postings from
 * a source's first snapshot never come here (the seed rule); users get those
 * only through the 7-day backfill.
 */

import { type MatchablePosting, firstMatch } from "@/lib/matching";
import { rulesFromRow } from "@/lib/schemas/watch-profile";
import { selectAll } from "@/lib/supabase/select-all";

import { type Db, chunks } from "./db";

type ProfileRow = Parameters<typeof rulesFromRow>[0] & {
  id: string;
  user_id: string;
};

export type InboxRow = {
  user_id: string;
  posting_id: string;
  watch_profile_id: string;
};

/** Pure: one row per (user, posting) where any of the user's profiles match. */
export function planMatches(
  postings: (MatchablePosting & { id: string })[],
  profiles: ProfileRow[],
): InboxRow[] {
  const byUser = new Map<
    string,
    (ReturnType<typeof rulesFromRow> & { id: string })[]
  >();
  for (const profile of profiles) {
    const list = byUser.get(profile.user_id) ?? [];
    list.push({ id: profile.id, ...rulesFromRow(profile) });
    byUser.set(profile.user_id, list);
  }
  const rows: InboxRow[] = [];
  for (const posting of postings) {
    for (const [userId, rules] of byUser) {
      const match = firstMatch(rules, posting);
      if (match) {
        rows.push({
          user_id: userId,
          posting_id: posting.id,
          watch_profile_id: match.id,
        });
      }
    }
  }
  return rows;
}

export type MatchResult = {
  postings: number;
  users: number;
  inserted: number;
  /** The Inbox rows this run actually created (not ones already there). */
  newRows: { userId: string; postingId: string }[];
};

export async function matchNewPostings(
  db: Db,
  postings: (MatchablePosting & { id: string })[],
): Promise<MatchResult> {
  if (postings.length === 0) {
    return { postings: 0, users: 0, inserted: 0, newRows: [] };
  }

  const [invited, profiles] = await Promise.all([
    selectAll(
      (from, to) =>
        db
          .from("profiles")
          .select("user_id")
          .not("invited_at", "is", null)
          .order("user_id")
          .range(from, to),
      "load invited users",
    ),
    selectAll(
      (from, to) =>
        db
          .from("watch_profiles")
          .select(
            "id, user_id, name, preset, categories, include_keywords, exclude_keywords, terms, locations, remote_ok, needs_sponsorship",
          )
          .eq("active", true)
          .order("created_at")
          .order("id")
          .range(from, to),
      "load watch profiles",
    ),
  ]);
  const members = new Set(invited.map((p) => p.user_id));
  const eligible = profiles.filter((p) => members.has(p.user_id));
  const rows = planMatches(postings, eligible);

  const newRows: MatchResult["newRows"] = [];
  for (const batch of chunks(rows)) {
    const { data, error } = await db
      .from("user_postings")
      .upsert(batch, {
        onConflict: "user_id,posting_id",
        ignoreDuplicates: true,
      })
      .select("user_id, posting_id");
    if (error) throw new Error(`insert user_postings: ${error.message}`);
    for (const row of data) {
      // Manual Tracker rows have no posting, and are never inserted here.
      if (row.posting_id) {
        newRows.push({ userId: row.user_id, postingId: row.posting_id });
      }
    }
  }
  return {
    postings: postings.length,
    users: new Set(eligible.map((p) => p.user_id)).size,
    inserted: newRows.length,
    newRows,
  };
}
