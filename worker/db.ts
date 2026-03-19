/**
 * Database I/O for the worker (service-role client, bypasses RLS). Reads the
 * state ingest planning needs and writes plans back in chunks.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { IngestPlan, IngestState } from "@/lib/postings/plan";
import { buildState } from "@/lib/postings/plan";
import type { NormalizedPosting } from "@/lib/sources/types";
import type { Database, Json } from "@/lib/supabase/database.types";

export type Db = SupabaseClient<Database>;

/** PostgREST returns at most 1000 rows per request (Supabase default). */
const PAGE = 1000;
/** Rows per insert/update request: keeps bodies well under a few MB. */
const CHUNK = 500;

/** Read every row of a query, a page at a time, ordered by id for stable paging. */
export async function selectAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

function check(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export async function loadIngestState(
  db: Db,
  sources: { id: string; name: string }[],
): Promise<IngestState> {
  const [postings, links, companies] = await Promise.all([
    selectAll(
      (from, to) =>
        db
          .from("postings")
          .select(
            "id, status, closed_at, content_hash, canonical_url, ats, ats_job_id, fuzzy_key",
          )
          .order("id")
          .range(from, to),
      "load postings",
    ),
    selectAll(
      (from, to) =>
        db
          .from("posting_sources")
          .select(
            "id, posting_id, source_id, source_job_id, data, content_hash, active, missed_runs, first_seen_at",
          )
          .order("id")
          .range(from, to),
      "load posting_sources",
    ),
    selectAll(
      (from, to) =>
        db
          .from("companies")
          .select("id, normalized_name")
          .order("id")
          .range(from, to),
      "load companies",
    ),
  ]);

  return buildState({
    postings: postings.map((p) => ({
      id: p.id,
      status: p.status as "open" | "closed",
      closedAt: p.closed_at,
      hash: p.content_hash,
      canonicalUrl: p.canonical_url,
      ats: p.ats,
      atsJobId: p.ats_job_id,
      fuzzyKey: p.fuzzy_key,
    })),
    links: links.map((l) => ({
      id: l.id,
      postingId: l.posting_id,
      sourceId: l.source_id,
      sourceJobId: l.source_job_id,
      data: l.data as unknown as NormalizedPosting,
      hash: l.content_hash,
      active: l.active,
      missedRuns: l.missed_runs,
      firstSeenAt: l.first_seen_at,
    })),
    companies: companies.map((c) => ({
      id: c.id,
      normalizedName: c.normalized_name,
    })),
    sources,
  });
}

/**
 * Write one source's plan. Order follows the foreign keys: companies →
 * postings → links. A failure throws and the run stops; the next run reloads
 * state from the database, so nothing is lost but this run's progress.
 */
export async function applyPlan(db: Db, plan: IngestPlan): Promise<void> {
  for (const batch of chunks(plan.companies)) {
    check("insert companies", (await db.from("companies").insert(batch)).error);
  }
  for (const batch of chunks(plan.insertPostings)) {
    check("insert postings", (await db.from("postings").insert(batch)).error);
  }
  for (const batch of chunks(plan.updatePostings)) {
    check(
      "update postings",
      (await db.from("postings").upsert(batch, { onConflict: "id" })).error,
    );
  }
  for (const batch of chunks(plan.insertLinks)) {
    const rows = batch.map((l) => ({
      ...l,
      data: l.data as unknown as NonNullable<Json>,
      raw: (l.raw ?? {}) as NonNullable<Json>,
    }));
    check(
      "insert posting_sources",
      (await db.from("posting_sources").insert(rows)).error,
    );
  }
  for (const batch of chunks(plan.updateLinks)) {
    check(
      "update posting_sources",
      (await db.rpc("update_links", { p_links: batch as unknown as Json }))
        .error,
    );
  }
  for (const batch of chunks(plan.seenLinkIds, 5000)) {
    check(
      "touch_seen",
      (await db.rpc("touch_seen", { p_link_ids: batch })).error,
    );
  }
}
