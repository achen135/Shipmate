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

describe("nextHealth for company boards", () => {
  const board = { board: true };

  it("an empty board is normal: no alert", () => {
    expect(
      nextHealth(
        { last_count: null, last_error: null, last_alert: null },
        { kind: "fresh", count: 0 },
        NOW,
        board,
      ),
    ).toEqual({
      last_checked_at: NOW,
      last_success_at: NOW,
      last_count: 0,
      last_error: null,
      last_alert: null,
    });
  });

  it("a big drop is normal too (the hiring cycle ends)", () => {
    expect(
      nextHealth(
        { last_count: 30, last_error: null, last_alert: null },
        { kind: "fresh", count: 2 },
        NOW,
        board,
      ).last_alert,
    ).toBeNull();
  });

  it("a failed check still alerts", () => {
    expect(
      nextHealth(healthy, { kind: "failed", error: "HTTP 500" }, NOW, board)
        .last_alert,
    ).toBe("Check failed: HTTP 500");
  });
});

describe("nextHealth for a best-effort failure", () => {
  it("notes the problem without an alert or touching the last success", () => {
    const update = nextHealth(
      healthy,
      { kind: "best_effort_failed", error: "Workday x: HTTP 403" },
      NOW,
    );
    expect(update).toEqual({
      last_checked_at: NOW,
      last_error: "Workday x: HTTP 403",
      last_alert: null,
    });
    expect(update).not.toHaveProperty("last_success_at");
    expect(update).not.toHaveProperty("last_count");
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
