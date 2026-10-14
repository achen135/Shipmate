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

/** Postgres foreign_key_violation. */
const FK_VIOLATION = "23503";

/**
 * Insert one batch of Inbox rows, returning the rows actually created. The
 * rows were planned from a snapshot of users and watch profiles taken a moment
 * earlier; if a user deleted their account (or a watch profile) since, the
 * insert fails a foreign key. One person's deletion must not fail everyone's
 * run, so on that error the rows whose user or profile is gone are dropped
 * and the batch is retried once. Any other error, or a second failure, throws.
 */
export async function insertInboxRows(
  db: Db,
  batch: InboxRow[],
): Promise<{ user_id: string; posting_id: string | null }[]> {
  const insert = (rows: InboxRow[]) =>
    db
      .from("user_postings")
      .upsert(rows, {
        onConflict: "user_id,posting_id",
        ignoreDuplicates: true,
      })
      .select("user_id, posting_id");

  const first = await insert(batch);
  if (!first.error) return first.data;
  if (first.error.code !== FK_VIOLATION) {
    throw new Error(`insert user_postings: ${first.error.message}`);
  }

  const userIds = [...new Set(batch.map((r) => r.user_id))];
  const profileIds = [...new Set(batch.map((r) => r.watch_profile_id))];
  const [users, profiles] = await Promise.all([
    db.from("profiles").select("user_id").in("user_id", userIds),
    db.from("watch_profiles").select("id").in("id", profileIds),
  ]);
  if (users.error) throw new Error(`recheck users: ${users.error.message}`);
  if (profiles.error) {
    throw new Error(`recheck watch profiles: ${profiles.error.message}`);
  }
  const liveUsers = new Set(users.data.map((u) => u.user_id));
  const liveProfiles = new Set(profiles.data.map((p) => p.id));
  const kept = batch.filter(
    (r) => liveUsers.has(r.user_id) && liveProfiles.has(r.watch_profile_id),
  );
  console.warn(
    `[worker] matching: ${batch.length - kept.length} row(s) dropped for deleted users or watch profiles; retrying`,
  );
  if (kept.length === 0) return [];

  const retry = await insert(kept);
  if (retry.error)
    throw new Error(`insert user_postings: ${retry.error.message}`);
  return retry.data;
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
    for (const row of await insertInboxRows(db, batch)) {
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
