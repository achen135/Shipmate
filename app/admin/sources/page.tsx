import type { Metadata } from "next";

import { AdminNav } from "@/components/admin/admin-nav";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth/viewer";
import { formatRelative } from "@/lib/format/time";
import { type SourceStatus, sourceStatus } from "@/lib/sources/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Source health" };

const BADGES: Record<
  SourceStatus,
  {
    label: string;
    variant: "destructive" | "secondary" | "outline";
    className?: string;
  }
> = {
  alert: { label: "Alert", variant: "destructive" },
  stale: {
    label: "Stale",
    variant: "outline",
    className: "border-warning bg-warning/20",
  },
  healthy: { label: "Healthy", variant: "secondary" },
  unchecked: { label: "Not checked yet", variant: "outline" },
};

type RunStats = {
  sources?: Record<string, { outcome?: string; new?: number; closed?: number }>;
};

/** Data for the page, plus the clock it's rendered against. */
async function loadHealth() {
  const supabase = await createClient();
  const [sources, runs] = await Promise.all([
    supabase
      .from("sources")
      .select(
        "id, name, kind, enabled, last_checked_at, last_success_at, last_count, last_error, last_alert",
      )
      .order("created_at"),
    supabase
      .from("runs")
      .select(
        "id, started_at, finished_at, trigger, is_seed, ok, stats, errors",
      )
      .order("started_at", { ascending: false })
      .limit(12),
  ]);
  if (sources.error) throw new Error(`sources: ${sources.error.message}`);
  if (runs.error) throw new Error(`runs: ${runs.error.message}`);
  return { sources: sources.data, runs: runs.data, now: Date.now() };
}

export default async function SourcesPage() {
  await requireAdmin();
  const { sources, runs, now } = await loadHealth();

  return (
    <>
      <AdminNav />
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Source health
        </h1>
        <p className="mt-2 text-muted-foreground">
          Red means the last check failed or the job count fell by more than
          half. Stale means no successful check in 3 hours (usually the Watch
          trigger, not the source).
        </p>
      </div>

      <ul aria-label="Sources" className="divide-y rounded-xl border bg-card">
        {sources.map((source) => {
          const status = sourceStatus(source, now);
          const badge = BADGES[status];
          return (
            <li key={source.id} data-testid="source-row" className="p-4">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{source.name}</span>
                <Badge variant={badge.variant} className={badge.className}>
                  {badge.label}
                </Badge>
                {!source.enabled && <Badge variant="outline">Disabled</Badge>}
              </p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Last success</dt>
                <dd>
                  {source.last_success_at
                    ? formatRelative(source.last_success_at, now)
                    : "never"}
                </dd>
                <dt className="text-muted-foreground">Active jobs</dt>
                <dd>{source.last_count?.toLocaleString("en-US") ?? "—"}</dd>
                <dt className="text-muted-foreground">Last checked</dt>
                <dd>
                  {source.last_checked_at
                    ? formatRelative(source.last_checked_at, now)
                    : "never"}
                </dd>
              </dl>
              {source.last_alert && (
                <p
                  role="alert"
                  className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm break-words text-destructive"
                >
                  {source.last_alert}
                </p>
              )}
              {source.last_error && source.last_error !== source.last_alert && (
                <p className="mt-2 text-sm break-words text-muted-foreground">
                  Last error: {source.last_error}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="runs-heading" className="flex flex-col gap-3">
        <h2 id="runs-heading" className="text-lg font-medium">
          Recent runs
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <ul
            aria-label="Runs"
            className="divide-y rounded-xl border bg-card text-sm"
          >
            {runs.map((run) => {
              const perSource = Object.values(
                (run.stats as RunStats).sources ?? {},
              );
              const added = perSource.reduce((n, s) => n + (s.new ?? 0), 0);
              const closed = perSource.reduce((n, s) => n + (s.closed ?? 0), 0);
              const fresh = perSource.filter(
                (s) => s.outcome === "fresh",
              ).length;
              const seconds = run.finished_at
                ? Math.round(
                    (new Date(run.finished_at).getTime() -
                      new Date(run.started_at).getTime()) /
                      1000,
                  )
                : null;
              const errors = Array.isArray(run.errors) ? run.errors.length : 0;
              return (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3"
                >
                  <span className="font-medium">
                    {formatRelative(run.started_at, now)}
                  </span>
                  <span className="text-muted-foreground">
                    {run.trigger ?? "unknown"}
                    {seconds !== null ? ` · ${seconds}s` : " · running"}
                  </span>
                  <span className="text-muted-foreground">
                    {fresh} downloaded · +{added} new · {closed} closed
                  </span>
                  {run.is_seed && <Badge variant="outline">Seed</Badge>}
                  {run.ok === false && (
                    <Badge variant="destructive">Failed</Badge>
                  )}
                  {errors > 0 && run.ok !== false && (
                    <Badge variant="destructive">
                      {errors} error{errors === 1 ? "" : "s"}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
