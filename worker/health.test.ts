// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatAlert, nextHealth } from "./health";

const NOW = "2026-10-10T12:13:00.000Z";
const healthy = { last_count: 4000, last_error: null, last_alert: null };

describe("nextHealth", () => {
  it("a normal snapshot records success and the new count", () => {
    expect(nextHealth(healthy, { kind: "fresh", count: 4100 }, NOW)).toEqual({
      last_checked_at: NOW,
      last_success_at: NOW,
      last_count: 4100,
      last_error: null,
      last_alert: null,
    });
  });

  it("alerts when the count falls by more than half", () => {
    expect(
      nextHealth(healthy, { kind: "fresh", count: 1999 }, NOW).last_alert,
    ).toBe("Active jobs dropped from 4000 to 1999");
    expect(
      nextHealth(healthy, { kind: "fresh", count: 2000 }, NOW).last_alert,
    ).toBeNull();
  });

  it("alerts on an empty snapshot, even the first", () => {
    expect(
      nextHealth(
        { last_count: null, last_error: null, last_alert: null },
        { kind: "fresh", count: 0 },
        NOW,
      ).last_alert,
    ).toBe("No active jobs in the latest snapshot");
  });

  it("a failed check keeps the last success and count, and alerts", () => {
    const update = nextHealth(
      healthy,
      { kind: "failed", error: "GitHub commits API: HTTP 502" },
      NOW,
    );
    expect(update).toEqual({
      last_checked_at: NOW,
      last_error: "GitHub commits API: HTTP 502",
      last_alert: "Check failed: GitHub commits API: HTTP 502",
    });
  });

  it("an unchanged check clears an error but keeps a count alert", () => {
    expect(
      nextHealth(
        {
          last_count: 10,
          last_error: "boom",
          last_alert: "Check failed: boom",
        },
        { kind: "unchanged" },
        NOW,
      ).last_alert,
    ).toBeNull();
    expect(
      nextHealth(
        {
          last_count: 10,
          last_error: null,
          last_alert: "Active jobs dropped from 4000 to 10",
        },
        { kind: "unchanged" },
        NOW,
      ),
    ).toEqual({
      last_checked_at: NOW,
      last_success_at: NOW,
      last_error: null,
      last_alert: "Active jobs dropped from 4000 to 10",
    });
  });
});

describe("formatAlert", () => {
  it("is an ::error:: annotation in Actions", () => {
    expect(
      formatAlert("Simplify New Grad", "boom", { GITHUB_ACTIONS: "true" }),
    ).toBe("::error title=Source alert: Simplify New Grad::boom");
    expect(formatAlert("S", "boom", {})).toBe("[worker] ALERT S: boom");
  });
});
