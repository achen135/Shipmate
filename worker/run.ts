/**
 * The 30-minute watcher run (GitHub Actions `watch.yml`, dispatched by
 * Supabase pg_cron with GitHub's schedule as a fallback).
 *
 * Run order (CLAUDE.md "Worker run order"), as far as M2 goes:
 *   1. aggregators: each source checks its upstream version and, if it
 *      changed, downloads a fresh snapshot
 *   2. normalize + dedupe + upsert, and close stale postings (per source,
 *      via lib/postings/plan.ts)
 *   3. write source health, with alerts
 *   4. write the `runs` row
 * Later milestones add hot boards, matching, tailoring, and notifications.
 */

import { createClient } from "@supabase/supabase-js";

import { createPoliteFetch } from "@/lib/http";
import { type Snapshot, planSource } from "@/lib/postings/plan";
import { ADAPTERS } from "@/lib/sources";
import type { FetchResult, SourceKind } from "@/lib/sources/types";
import type { Database, Json } from "@/lib/supabase/database.types";

import { formatWarning, loadWorkerConfig } from "./config";
import { type Db, applyPlan, loadIngestState } from "./db";
import { type CheckOutcome, formatAlert, nextHealth } from "./health";

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
  let crashed: unknown = null;

  try {
    isSeed = await watchSources(db, githubToken, stats, errors);
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
      stats: { sources: stats } as unknown as NonNullable<Json>,
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

/** Steps 1-3. Returns whether any source took its first snapshot. */
async function watchSources(
  db: Db,
  githubToken: string | undefined,
  stats: Record<string, SourceRunStats>,
  errors: string[],
): Promise<boolean> {
  const { data: sources, error } = await db
    .from("sources")
    .select(
      "id, kind, name, config, last_sha_or_etag, last_success_at, last_count, last_error, last_alert",
    )
    .eq("enabled", true)
    .order("created_at");
  if (error) throw new Error(`load sources: ${error.message}`);

  const state = await loadIngestState(db, sources);
  const http = createPoliteFetch();
  let isSeed = false;

  for (const source of sources) {
    const adapter = ADAPTERS[source.kind as SourceKind];
    if (!adapter) continue;
    const started = Date.now();

    let fetched: FetchResult | null = null;
    let failure: string | null = null;
    try {
      fetched = await adapter.fetch(
        {
          id: source.id,
          kind: source.kind as SourceKind,
          name: source.name,
          config: source.config,
          lastVersion: source.last_sha_or_etag,
        },
        { fetch: http, githubToken },
      );
    } catch (err) {
      failure = errorMessage(err);
    }

    const snapshot: Snapshot = !fetched
      ? { kind: "failed" }
      : fetched.kind === "fresh"
        ? { kind: "fresh", rows: fetched.rows }
        : { kind: "unchanged" };
    const plan = planSource(state, source.id, snapshot);
    // A database error here stops the run (state and DB would disagree).
    await applyPlan(db, plan);

    const seed = fetched?.kind === "fresh" && source.last_success_at === null;
    if (seed) isSeed = true;

    const outcome: CheckOutcome = failure
      ? { kind: "failed", error: failure }
      : fetched!.kind === "fresh"
        ? { kind: "fresh", count: plan.stats.active }
        : { kind: "unchanged" };
    const now = new Date().toISOString();
    const health = nextHealth(source, outcome, now);
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

  return isSeed;
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
