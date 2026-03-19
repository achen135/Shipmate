/**
 * Source health (Spec "Source health"): after each check, what the admin page
 * shows and whether to raise an alert. Pure, so the rules are unit-tested.
 */

/** A drop below this share of the previous count is treated as breakage. */
export const DROP_ALERT_SHARE = 0.5;

export type CheckOutcome =
  | { kind: "fresh"; count: number }
  | { kind: "unchanged" }
  | { kind: "failed"; error: string };

export type SourceHealthBefore = {
  last_count: number | null;
  last_error: string | null;
  last_alert: string | null;
};

export type SourceHealthUpdate = {
  last_checked_at: string;
  last_success_at?: string;
  last_count?: number;
  last_error: string | null;
  last_alert: string | null;
};

export function nextHealth(
  before: SourceHealthBefore,
  outcome: CheckOutcome,
  now: string,
): SourceHealthUpdate {
  if (outcome.kind === "failed") {
    return {
      last_checked_at: now,
      last_error: outcome.error,
      last_alert: `Check failed: ${outcome.error}`,
    };
  }
  if (outcome.kind === "unchanged") {
    // Same data as the last snapshot: a count alert still stands, an error
    // alert is over (this check worked).
    return {
      last_checked_at: now,
      last_success_at: now,
      last_error: null,
      last_alert: before.last_error ? null : before.last_alert,
    };
  }
  const previous = before.last_count;
  let alert: string | null = null;
  if (outcome.count === 0) {
    alert = "No active jobs in the latest snapshot";
  } else if (previous && outcome.count < previous * DROP_ALERT_SHARE) {
    alert = `Active jobs dropped from ${previous} to ${outcome.count}`;
  }
  return {
    last_checked_at: now,
    last_success_at: now,
    last_count: outcome.count,
    last_error: null,
    last_alert: alert,
  };
}

type Env = Record<string, string | undefined>;

/** A red annotation on the Actions run page, plain text elsewhere. */
export function formatAlert(source: string, alert: string, env: Env): string {
  return env.GITHUB_ACTIONS === "true"
    ? `::error title=Source alert: ${source}::${alert}`
    : `[worker] ALERT ${source}: ${alert}`;
}
