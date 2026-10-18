/**
 * Pre-fetching the full posting text for what people have saved (M9 §3).
 *
 * Most postings come from the aggregators with no description, and the
 * tailoring pipeline fetches one the first time someone tailors to it
 * (lib/tailor/posting-text.ts, cached on postings.fetched_description). That
 * made a "Tailor all" sit-down wait on a network call per posting. This runs
 * the same fetch and writes the same two columns ahead of time, for open
 * postings someone in AI mode has saved to To Apply and that still have no
 * text. No AI, no cost; just the ATS's public job API or the posting page.
 *
 * It runs in the 30-minute Watch run, so a saved posting has its text within
 * half an hour, not the instant it's saved. The application *questions* are
 * different: those the app fetches right after the Save (lib/questions/
 * prefetch.ts). The text can't take that route. It goes into the AI's prompt
 * for everyone who tailors to the posting, so only the worker (service role)
 * may write it; the questions are only ever shown as plain text, which is
 * why users have a narrow door for those and none for this.
 *
 * Best effort: a failure is logged and never fails the run. A posting whose
 * text couldn't be fetched is tried again after RETRY_AFTER_MS, not every
 * run, and tailoring still tries it itself.
 *
 * Logging: counts only.
 */

import type { BoardHint } from "@/lib/questions/locate";
import { fetchPostingText } from "@/lib/tailor/posting-text";
import { MIN_POSTING_CHARS } from "@/lib/tailor/score";

import { type Db, chunks } from "./db";

/** The most postings one run fetches: politeness, and the run's time. */
export const MAX_PER_RUN = 20;
/** A fetch that came back empty waits this long before it's tried again. */
export const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

export type PrefetchStats = {
  /** Open postings that were saved by someone in AI mode and still need text. */
  due: number;
  fetched: number;
  /** Fetches that found no usable text (retried much later). */
  empty: number;
  /** Cut off by MAX_PER_RUN or the deadline. */
  left: number;
};

export type PrefetchCandidate = {
  id: string;
  description: string | null;
  fetched_description: string | null;
  description_fetched_at: string | null;
};

/**
 * Which of these still need their text fetched now, never-tried first, then
 * the longest-waiting. A posting needs it when neither the source's own
 * description nor an earlier fetch gave it enough text, and no fetch has
 * been tried in the last RETRY_AFTER_MS.
 */
export function needingText<T extends PrefetchCandidate>(
  postings: T[],
  now: number,
): T[] {
  return postings
    .filter((p) => {
      if ((p.description ?? "").length >= MIN_POSTING_CHARS) return false;
      if ((p.fetched_description ?? "").length >= MIN_POSTING_CHARS) {
        return false;
      }
      const tried = p.description_fetched_at
        ? Date.parse(p.description_fetched_at)
        : Number.NaN;
      return Number.isNaN(tried) || now - tried >= RETRY_AFTER_MS;
    })
    .sort((a, b) => {
      const at = a.description_fetched_at
        ? Date.parse(a.description_fetched_at)
        : 0;
      const bt = b.description_fetched_at
        ? Date.parse(b.description_fetched_at)
        : 0;
      return at - bt;
    });
}

function check(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export async function prefetchSavedText(
  db: Db,
  options: { fetch: typeof fetch; deadline: number; now?: number },
): Promise<PrefetchStats> {
  const now = options.now ?? Date.now();

  const saved = await db
    .from("user_postings")
    .select("user_id, posting_id")
    .eq("status", "saved")
    .limit(2000);
  check("saved postings", saved.error);
  const savedRows = saved.data ?? [];
  const users = [...new Set(savedRows.map((row) => row.user_id))];
  if (users.length === 0) return { due: 0, fetched: 0, empty: 0, left: 0 };

  // Only people in AI mode ever tailor, and the text is only for tailoring.
  const aiUsers = new Set<string>();
  for (const chunk of chunks(users, 100)) {
    const profiles = await db
      .from("profiles")
      .select("user_id")
      .eq("mode", "ai")
      .in("user_id", chunk);
    check("profiles", profiles.error);
    for (const row of profiles.data ?? []) aiUsers.add(row.user_id);
  }
  const ids = [
    ...new Set(
      savedRows
        .filter((r) => aiUsers.has(r.user_id))
        .map((r) => r.posting_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const candidates: (PrefetchCandidate & {
    url: string;
    canonical_url: string;
    company: { name: string } | null;
  })[] = [];
  for (const chunk of chunks(ids, 100)) {
    const postings = await db
      .from("postings")
      .select(
        "id, url, canonical_url, description, fetched_description, description_fetched_at, company:companies(name)",
      )
      .eq("status", "open")
      .in("id", chunk);
    check("postings", postings.error);
    candidates.push(...(postings.data ?? []));
  }

  const due = needingText(candidates, now);
  const stats: PrefetchStats = {
    due: due.length,
    fetched: 0,
    empty: 0,
    left: 0,
  };

  // One at a time, like everything that talks to other people's servers.
  for (const [index, posting] of due.entries()) {
    if (index >= MAX_PER_RUN || Date.now() >= options.deadline) {
      stats.left = due.length - index;
      break;
    }
    const { data: boardRows } = await db.rpc("posting_boards", {
      p_posting_id: posting.id,
    });
    const text = await fetchPostingText(
      {
        url: posting.url,
        canonical_url: posting.canonical_url,
        company: posting.company?.name ?? "",
      },
      (boardRows ?? []) as BoardHint[],
      options.fetch,
    );
    // The same two columns the tailoring pipeline writes (worker/tailor.ts).
    // A miss is recorded too, so it isn't tried again for a while.
    const { error } = await db
      .from("postings")
      .update({
        fetched_description: text,
        description_fetched_at: new Date().toISOString(),
      })
      .eq("id", posting.id);
    check("save fetched description", error);
    if (text) stats.fetched += 1;
    else stats.empty += 1;
  }
  return stats;
}
