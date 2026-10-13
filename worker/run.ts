/**
 * The 30-minute watcher run (GitHub Actions `watch.yml`, dispatched by
 * Supabase pg_cron with GitHub's schedule as a fallback).
 *
 * Run order (CLAUDE.md "Worker run order"), as far as M4 goes:
 *   1. every enabled source, aggregators then the company boards users
 *      follow: each checks its upstream and returns a snapshot (or, for an
 *      aggregator whose commit is unchanged, nothing new)
 *   2. normalize + dedupe + upsert, and close stale postings (per source,
 *      via lib/postings/plan.ts), writing source health with alerts
 *   3. match newly listed postings to watch profiles → Inbox rows
 *   4. one notification per user for the rows just created (push, with an
 *      email fallback; worker/notify.ts)
 *   5. write the `runs` row
 * Later milestones add the cold tier and tailoring.
 *
 * WATCH_SOURCES=greenhouse:stripe,lever:palantir limits a run to those
 * source keys (a hand run for one company, and the E2E tests).
 */

import { createClient } from "@supabase/supabase-js";

import { createPoliteFetch } from "@/lib/http";
import {
  type PostingRow,
  type Snapshot,
  planSource,
} from "@/lib/postings/plan";
import { ADAPTERS, isBoardKind } from "@/lib/sources";
import {
  BestEffortFailure,
  type FetchResult,
  type SourceKind,
} from "@/lib/sources/types";
import type { Database, Json } from "@/lib/supabase/database.types";

import { formatWarning, loadWorkerConfig } from "./config";
import { type Db, applyPlan, loadIngestState } from "./db";
import { type CheckOutcome, formatAlert, nextHealth } from "./health";
import { type MatchResult, matchNewPostings } from "./match";
import { type NotifyStats, notifyUsers } from "./notify";
import { withE2eOrigin } from "@/lib/e2e-origin";

type SourceRunStats = {
  outcome: CheckOutcome["kind"];
  version?: string | null;
  invalid?: number;
  durationMs: number;
  error?: string;
  rows?: number;
  active?: number;
  new?: number;
  merged?: number;
  updated?: number;
  closed?: number;
  reopened?: number;
  /** First snapshot of this source: its new postings don't reach inboxes. */
  seed?: boolean;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function main(): Promise<number> {
  const result = loadWorkerConfig(process.env);
  if (!result.ok) {
    console.log(
      formatWarning(
        `missing ${result.missing.join(", ")}; skipping this run. ` +
          "Add them as repository secrets (Settings → Secrets and variables → Actions).",
        process.env,
      ),
    );
    return 0;
  }

  const { supabaseUrl, serviceRoleKey, githubToken } = result.config;
  const db: Db = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Also the credentials check: a wrong key fails here, loudly. Any query
  // counts as project activity, which keeps the free tier from pausing.
  const { data: run, error: runError } = await db
    .from("runs")
    .insert({
      trigger: process.env.GITHUB_EVENT_NAME ?? "local",
      github_run_id: process.env.GITHUB_RUN_ID ?? null,
    })
    .select("id")
    .single();
  if (runError) {
    console.error(`[worker] can't start a run: ${runError.message}`);
    return 1;
  }

  const stats: Record<string, SourceRunStats> = {};
  const errors: string[] = [];
  let isSeed = false;
  let matching: Omit<MatchResult, "newRows"> | null = null;
  let notifications: NotifyStats | null = null;
  let crashed: unknown = null;

  try {
    const watched = await watchSources(db, githubToken, stats, errors);
    isSeed = watched.isSeed;
    const matched = await matchNewPostings(db, watched.newPostings);
    const { newRows, ...matchStats } = matched;
    matching = matchStats;
    console.log(`[worker] matching: ${JSON.stringify(matching)}`);
    // One digest per user for the Inbox rows created just now. A failure here
    // is logged and never fails the run (lib: worker/notify.ts).
    notifications = await notifyUsers(db, run.id, newRows);
    if (notifications) {
      console.log(`[worker] notifications: ${JSON.stringify(notifications)}`);
    }
  } catch (error) {
    crashed = error;
    errors.push(`run: ${errorMessage(error)}`);
  }

  const { error: finishError } = await db
    .from("runs")
    .update({
      finished_at: new Date().toISOString(),
      ok: crashed === null,
      is_seed: isSeed,
      stats: {
        sources: stats,
        matching,
        notifications,
      } as unknown as NonNullable<Json>,
      errors,
    })
    .eq("id", run.id);
  if (finishError) console.error(`[worker] finish run: ${finishError.message}`);

  if (crashed) {
    console.error("[worker] run failed:", crashed);
    return 1;
  }
  console.log(`[worker] done${isSeed ? " (seed run)" : ""}`);
  return 0;
}

/**
 * Steps 1-2. Returns whether any source took its first snapshot, and the
 * postings this run listed for the first time that may reach inboxes: still
 * open at the end of the run, and not from a source's first snapshot.
 */
async function watchSources(
  db: Db,
  githubToken: string | undefined,
  stats: Record<string, SourceRunStats>,
  errors: string[],
): Promise<{ isSeed: boolean; newPostings: PostingRow[] }> {
  const only = (process.env.WATCH_SOURCES ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  let query = db
    .from("sources")
    .select(
      "id, key, kind, name, config, last_sha_or_etag, last_success_at, last_count, last_error, last_alert",
    )
    .eq("enabled", true);
  if (only.length > 0) query = query.in("key", only);
  const { data: sources, error } = await query.order("created_at");
  if (error) throw new Error(`load sources: ${error.message}`);
  if (only.length > 0) {
    console.log(
      `[worker] limited to ${only.join(", ")}: ${sources.length} found`,
    );
  }

  const state = await loadIngestState(db, sources);
  const http = withE2eOrigin(createPoliteFetch(), process.env);
  let isSeed = false;
  const candidates = new Map<string, PostingRow>();

  for (const source of sources) {
    const adapter = ADAPTERS[source.kind as SourceKind];
    if (!adapter) continue;
    const started = Date.now();

    let fetched: FetchResult | null = null;
    let failure: string | null = null;
    let bestEffort: string | null = null;
    try {
      fetched = await adapter.fetch(
        {
          id: source.id,
          kind: source.kind as SourceKind,
          name: source.name,
          config: source.config,
          lastVersion: source.last_sha_or_etag,
        },
        {
          fetch: http,
          githubToken,
          warn: (message) => console.log(formatWarning(message, process.env)),
        },
      );
    } catch (err) {
      // A best-effort source (Workday) not working is noted, not a failure.
      if (err instanceof BestEffortFailure) {
        bestEffort = err.message;
        console.log(
          formatWarning(`${source.name}: ${bestEffort}`, process.env),
        );
      } else {
        failure = errorMessage(err);
      }
    }

    const snapshot: Snapshot = !fetched
      ? { kind: "failed" }
      : fetched.kind === "fresh"
        ? { kind: "fresh", rows: fetched.rows }
        : { kind: "unchanged" };
    const plan = planSource(state, source.id, snapshot);
    // A database error here stops the run (state and DB would disagree).
    await applyPlan(db, plan);

    // An aggregator's first snapshot is thousands of old jobs, so it only
    // seeds. A company board is small and was added because someone follows
    // it, so its first snapshot reaches inboxes (jobs we already had from an
    // aggregator merge into those postings and don't count as new).
    const seed =
      fetched?.kind === "fresh" &&
      source.last_success_at === null &&
      !isBoardKind(source.kind);
    if (seed) isSeed = true;
    else for (const row of plan.insertPostings) candidates.set(row.id, row);

    const outcome: CheckOutcome = bestEffort
      ? { kind: "best_effort_failed", error: bestEffort }
      : failure
        ? { kind: "failed", error: failure }
        : fetched!.kind === "fresh"
          ? { kind: "fresh", count: plan.stats.active }
          : { kind: "unchanged" };
    const now = new Date().toISOString();
    const health = nextHealth(source, outcome, now, {
      board: isBoardKind(source.kind),
    });
    const { error: healthError } = await db
      .from("sources")
      .update({
        ...health,
        ...(fetched ? { last_sha_or_etag: fetched.version } : {}),
      })
      .eq("id", source.id);
    if (healthError) throw new Error(`update source: ${healthError.message}`);

    if (failure) errors.push(`${source.name}: ${failure}`);
    if (
      health.last_alert &&
      (failure || health.last_alert !== source.last_alert)
    ) {
      console.log(formatAlert(source.name, health.last_alert, process.env));
    }

    stats[source.name] = {
      outcome: outcome.kind,
      durationMs: Date.now() - started,
      ...(fetched ? { version: fetched.version } : {}),
      ...(fetched?.kind === "fresh" ? { invalid: fetched.invalid } : {}),
      ...(failure ? { error: failure } : {}),
      ...(fetched?.kind === "fresh" ? plan.stats : {}),
      ...(seed ? { seed } : {}),
    };
    console.log(
      `[worker] ${source.name}: ${JSON.stringify(stats[source.name])}`,
    );
  }

  const newPostings = [...candidates.values()].filter(
    (row) => state.postings.get(row.id)?.status === "open",
  );
  return { isSeed, newPostings };
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error("[worker] crashed:", err);
    process.exitCode = 1;
  },
);
