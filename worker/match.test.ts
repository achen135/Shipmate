// @vitest-environment node
import { describe, expect, it } from "vitest";

import { planMatches } from "./match";

function profile(id: string, userId: string, categories: string[]) {
  return {
    id,
    user_id: userId,
    name: id,
    preset: "custom",
    categories,
    include_keywords: [],
    exclude_keywords: [],
    terms: ["Summer 2027"],
    locations: [],
    remote_ok: true,
    needs_sponsorship: false,
  };
}

const swePosting = {
  id: "p1",
  title: "Software Engineer Intern",
  category: "Software",
  terms: ["Summer 2027"],
  locations: ["NYC"],
};
const quantPosting = {
  ...swePosting,
  id: "p2",
  title: "Quant Trader Intern",
  category: "Quant",
};

describe("planMatches", () => {
  it("one row per user per matching posting, credited to the first match", () => {
    const rows = planMatches(
      [swePosting, quantPosting],
      [
        profile("alex-swe", "alex", ["Software"]),
        profile("alex-all", "alex", ["Software", "Quant"]),
        profile("sam-quant", "sam", ["Quant"]),
      ],
    );
    expect(rows).toEqual([
      { user_id: "alex", posting_id: "p1", watch_profile_id: "alex-swe" },
      { user_id: "alex", posting_id: "p2", watch_profile_id: "alex-all" },
      { user_id: "sam", posting_id: "p2", watch_profile_id: "sam-quant" },
    ]);
  });

  it("no profiles, no rows", () => {
    expect(planMatches([swePosting], [])).toEqual([]);
  });
});
