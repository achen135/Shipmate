import { describe, expect, it } from "vitest";

import { tailoringBadge } from "./card";

const TODAY = "2026-10-18";

describe("the card's tailoring line", () => {
  it("in progress while queued or running", () => {
    expect(
      tailoringBadge({ state: "queued", score_after: null }, TODAY),
    ).toEqual({ kind: "working" });
    expect(
      tailoringBadge({ state: "running", score_after: null }, TODAY),
    ).toEqual({ kind: "working" });
    expect(
      tailoringBadge(
        { state: "queued", score_after: null, run_on: TODAY },
        TODAY,
      ),
    ).toEqual({ kind: "working" });
  });

  it("queued for a later day: which day, not a spinner", () => {
    expect(
      tailoringBadge(
        { state: "queued", score_after: null, run_on: "2026-10-20" },
        TODAY,
      ),
    ).toEqual({ kind: "later", day: "Tue, Oct 20" });
  });

  it("the fit score once done", () => {
    expect(tailoringBadge({ state: "done", score_after: 87 }, TODAY)).toEqual({
      kind: "score",
      score: 87,
    });
  });

  it("nothing without a tailoring, for a failed one, or one with no score", () => {
    expect(tailoringBadge(undefined, TODAY)).toBeNull();
    expect(
      tailoringBadge({ state: "failed", score_after: null }, TODAY),
    ).toBeNull();
    expect(
      tailoringBadge({ state: "done", score_after: null }, TODAY),
    ).toBeNull();
  });
});
