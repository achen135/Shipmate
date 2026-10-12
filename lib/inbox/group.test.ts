// @vitest-environment node
import { describe, expect, it } from "vitest";

import { groupByDay } from "./group";

// 2026-10-10 15:00 UTC = 10:00 Chicago.
const NOW = Date.UTC(2026, 9, 10, 15, 0, 0);

const item = (id: string, posted: string | null, firstSeen = posted) => ({
  id,
  posting: {
    posted_at: posted,
    first_seen_at: firstSeen ?? "2026-10-10T00:00:00Z",
  },
});

describe("groupByDay", () => {
  it("groups by posted day, newest day and newest posting first", () => {
    const groups = groupByDay(
      [
        item("old", "2026-10-05T18:00:00Z"),
        item("morning", "2026-10-10T13:00:00Z"),
        item("late-yesterday", "2026-10-10T03:00:00Z"), // 22:00 Oct 9 Chicago
        item("afternoon", "2026-10-10T14:30:00Z"),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Today", ["afternoon", "morning"]],
      ["Yesterday", ["late-yesterday"]],
      ["Monday, Oct 5", ["old"]],
    ]);
  });

  it("falls back to first seen when the source has no posted date", () => {
    const groups = groupByDay([item("x", null, "2026-10-09T15:00:00Z")], NOW);
    expect(groups[0].label).toBe("Yesterday");
  });

  it("is empty for no items", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});
