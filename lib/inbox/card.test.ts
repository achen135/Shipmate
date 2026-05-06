import { describe, expect, it } from "vitest";

import { tailoringBadge } from "./card";

describe("the card's tailoring line", () => {
  it("in progress while queued or running", () => {
    expect(tailoringBadge({ state: "queued", score_after: null })).toEqual({
      kind: "working",
    });
    expect(tailoringBadge({ state: "running", score_after: null })).toEqual({
      kind: "working",
    });
  });

  it("the fit score once done", () => {
    expect(tailoringBadge({ state: "done", score_after: 87 })).toEqual({
      kind: "score",
      score: 87,
    });
  });

  it("nothing without a tailoring, for a failed one, or one with no score", () => {
    expect(tailoringBadge(undefined)).toBeNull();
    expect(tailoringBadge({ state: "failed", score_after: null })).toBeNull();
    expect(tailoringBadge({ state: "done", score_after: null })).toBeNull();
  });
});
