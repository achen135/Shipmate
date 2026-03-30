// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isStale } from "./badge";

const NOW = Date.parse("2026-11-01T15:00:00Z");

describe("isStale (no update in 30 days)", () => {
  it("uses the last status change", () => {
    expect(
      isStale(
        {
          status: "applied",
          lastEventAt: "2026-09-30T12:00:00Z",
          appliedAt: "2026-09-01",
        },
        NOW,
      ),
    ).toBe(true);
    expect(
      isStale(
        {
          status: "applied",
          lastEventAt: "2026-10-10T12:00:00Z",
          appliedAt: "2026-09-01",
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("falls back to the applied date", () => {
    expect(
      isStale(
        { status: "oa", lastEventAt: null, appliedAt: "2026-10-01" },
        NOW,
      ),
    ).toBe(true);
    expect(
      isStale(
        { status: "oa", lastEventAt: null, appliedAt: "2026-10-03" },
        NOW,
      ),
    ).toBe(false);
    expect(
      isStale({ status: "applied", lastEventAt: null, appliedAt: null }, NOW),
    ).toBe(false);
  });

  it("only flags applications still waiting (applied, OA)", () => {
    for (const status of ["interview", "offer", "rejected", "withdrawn"]) {
      expect(
        isStale(
          { status, lastEventAt: "2026-01-01T00:00:00Z", appliedAt: null },
          NOW,
        ),
      ).toBe(false);
    }
  });
});
