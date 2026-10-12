// @vitest-environment node
import { describe, expect, it } from "vitest";

import { sourceStatus } from "./status";

const NOW = Date.UTC(2026, 9, 10, 15, 0, 0);
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("sourceStatus", () => {
  it("an alert wins over everything", () => {
    expect(
      sourceStatus(
        { last_alert: "Check failed", last_success_at: hoursAgo(0.1) },
        NOW,
      ),
    ).toBe("alert");
  });

  it("healthy within 3 hours of the last success, stale after", () => {
    expect(
      sourceStatus({ last_alert: null, last_success_at: hoursAgo(2.9) }, NOW),
    ).toBe("healthy");
    expect(
      sourceStatus({ last_alert: null, last_success_at: hoursAgo(3.1) }, NOW),
    ).toBe("stale");
  });

  it("unchecked before the first success", () => {
    expect(sourceStatus({ last_alert: null, last_success_at: null }, NOW)).toBe(
      "unchecked",
    );
  });

  it("a Workday source whose last check failed is best effort, not an alert", () => {
    expect(
      sourceStatus(
        {
          kind: "workday",
          last_error: "Workday x: HTTP 403",
          last_alert: null,
          last_success_at: hoursAgo(30),
        },
        NOW,
      ),
    ).toBe("best_effort");
    // ...also when it has never worked.
    expect(
      sourceStatus(
        {
          kind: "workday",
          last_error: "Workday x: HTTP 403",
          last_alert: null,
          last_success_at: null,
        },
        NOW,
      ),
    ).toBe("best_effort");
  });

  it("a Workday source that last worked is judged like any other", () => {
    expect(
      sourceStatus(
        {
          kind: "workday",
          last_error: null,
          last_alert: null,
          last_success_at: hoursAgo(1),
        },
        NOW,
      ),
    ).toBe("healthy");
  });

  it("other kinds with an error but no alert are not best effort", () => {
    expect(
      sourceStatus(
        {
          kind: "greenhouse",
          last_error: "x",
          last_alert: null,
          last_success_at: hoursAgo(1),
        },
        NOW,
      ),
    ).toBe("healthy");
  });
});
