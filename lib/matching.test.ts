// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  type MatchRules,
  type MatchablePosting,
  firstMatch,
  keywordHits,
  matchPosting,
} from "./matching";
import { presetById } from "./watch/presets";

function rules(overrides: Partial<MatchRules> = {}): MatchRules {
  return {
    categories: [],
    includeKeywords: [],
    excludeKeywords: [],
    terms: ["Summer 2027"],
    locations: [],
    remoteOk: true,
    ...overrides,
  };
}

function presetRules(id: string, overrides: Partial<MatchRules> = {}) {
  const p = presetById(id);
  return rules({
    categories: p.categories,
    includeKeywords: p.includeKeywords,
    excludeKeywords: p.excludeKeywords,
    ...overrides,
  });
}

function posting(overrides: Partial<MatchablePosting> = {}): MatchablePosting {
  return {
    title: "Software Engineer Intern",
    category: "Software",
    terms: ["Summer 2027"],
    locations: ["San Francisco, CA"],
    ...overrides,
  };
}

describe("keywordHits", () => {
  it("short keywords need a whole word", () => {
    expect(keywordHits("ML Engineer Intern", "ML")).toBe(true);
    expect(keywordHits("HTML Email Developer", "ML")).toBe(false);
    expect(keywordHits("AI Research Intern", "AI")).toBe(true);
    expect(keywordHits("Air Quality Intern", "AI")).toBe(false);
  });

  it("longer keywords also hit words that start with them", () => {
    expect(keywordHits("Quantitative Research Intern", "quant")).toBe(true);
    expect(keywordHits("Software Engineering Intern", "engineer")).toBe(true);
    expect(keywordHits("Reengineering Intern", "engineer")).toBe(false);
  });

  it("ignores case and treats hyphens and slashes as spaces", () => {
    expect(keywordHits("Full-Stack Developer Co-op", "full stack")).toBe(true);
    expect(keywordHits("Intern/Co-op, Supply Chain", "supply chain")).toBe(
      true,
    );
    expect(keywordHits("C++ Developer Intern", "C++")).toBe(true);
  });
});

describe("matchPosting: term", () => {
  it("needs one of the profile's terms", () => {
    const swe = presetRules("swe");
    expect(matchPosting(swe, posting())).toBe(true);
    expect(matchPosting(swe, posting({ terms: ["Fall 2026"] }))).toBe(false);
    expect(
      matchPosting(swe, posting({ terms: ["Fall 2026", "Summer 2027"] })),
    ).toBe(true);
  });

  it("an unknown term (Simplify N/A) matches any profile", () => {
    expect(matchPosting(presetRules("swe"), posting({ terms: [] }))).toBe(true);
  });

  it("New Grad postings only reach profiles watching New Grad", () => {
    const ng = posting({
      title: "Software Engineer, New Grad",
      terms: ["New Grad"],
    });
    expect(matchPosting(presetRules("swe"), ng)).toBe(false);
    expect(
      matchPosting(
        presetRules("swe", { terms: ["Summer 2027", "New Grad"] }),
        ng,
      ),
    ).toBe(true);
  });
});

describe("matchPosting: role", () => {
  it("matches by category", () => {
    expect(
      matchPosting(
        presetRules("quant"),
        posting({ title: "Summer Analyst", category: "Quant" }),
      ),
    ).toBe(true);
  });

  it("or by an include keyword in the title, whatever the category", () => {
    // Simplify files plenty of SWE roles under AI/ML/Data or Hardware.
    expect(
      matchPosting(
        presetRules("swe"),
        posting({ title: "Embedded Software Intern", category: "Hardware" }),
      ),
    ).toBe(true);
    expect(
      matchPosting(
        presetRules("swe"),
        posting({
          title: "Mechanical Engineering Intern",
          category: "Hardware",
        }),
      ),
    ).toBe(false);
  });

  it("supply chain is keyword-only (no Simplify category)", () => {
    const ops = presetRules("supply_chain_ops");
    expect(
      matchPosting(
        ops,
        posting({ title: "Supply Chain Analyst Intern", category: null }),
      ),
    ).toBe(true);
    expect(
      matchPosting(
        ops,
        posting({ title: "Global Procurement Co-op", category: "Product" }),
      ),
    ).toBe(true);
    expect(matchPosting(ops, posting())).toBe(false);
  });

  it("exclude keywords win", () => {
    const swe = presetRules("swe", { excludeKeywords: ["PhD", "senior"] });
    expect(
      matchPosting(swe, posting({ title: "PhD Software Engineer Intern" })),
    ).toBe(false);
    expect(matchPosting(swe, posting())).toBe(true);
  });

  it("a profile with no role rules matches any role", () => {
    expect(
      matchPosting(
        rules(),
        posting({ title: "Marketing Intern", category: null }),
      ),
    ).toBe(true);
  });
});

describe("matchPosting: location", () => {
  it("no locations set = no location filter", () => {
    expect(
      matchPosting(presetRules("swe"), posting({ locations: ["London, UK"] })),
    ).toBe(true);
  });

  it("matches cities, states, and common short forms", () => {
    const r = presetRules("swe", { locations: ["New York", "Seattle", "TX"] });
    expect(matchPosting(r, posting({ locations: ["NYC"] }))).toBe(true);
    expect(matchPosting(r, posting({ locations: ["Seattle, WA"] }))).toBe(true);
    expect(matchPosting(r, posting({ locations: ["Austin, TX"] }))).toBe(true);
    expect(matchPosting(r, posting({ locations: ["Chicago, IL"] }))).toBe(
      false,
    );
  });

  it("short forms don't match inside other words", () => {
    const r = presetRules("swe", { locations: ["LA", "CA"] });
    expect(matchPosting(r, posting({ locations: ["Laurel, MD"] }))).toBe(false);
    expect(
      matchPosting(r, posting({ locations: ["Toronto, ON, Canada"] })),
    ).toBe(false);
    expect(matchPosting(r, posting({ locations: ["LA"] }))).toBe(true);
    expect(matchPosting(r, posting({ locations: ["San Jose, CA"] }))).toBe(
      true,
    );
  });

  it("Bay Area covers its cities", () => {
    const r = presetRules("swe", { locations: ["Bay Area"] });
    expect(matchPosting(r, posting({ locations: ["SF"] }))).toBe(true);
    expect(matchPosting(r, posting({ locations: ["Palo Alto, CA"] }))).toBe(
      true,
    );
    expect(matchPosting(r, posting({ locations: ["Austin, TX"] }))).toBe(false);
  });

  it("remote postings depend on remote OK", () => {
    const r = presetRules("swe", { locations: ["Seattle"] });
    const remote = posting({ locations: ["Remote in USA"] });
    expect(matchPosting(r, remote)).toBe(true);
    expect(matchPosting({ ...r, remoteOk: false }, remote)).toBe(false);
  });

  it("vague or missing locations pass (bias loose)", () => {
    const r = presetRules("swe", { locations: ["Seattle"], remoteOk: false });
    expect(matchPosting(r, posting({ locations: [] }))).toBe(true);
    expect(matchPosting(r, posting({ locations: ["United States"] }))).toBe(
      true,
    );
  });

  it("any one of several posting locations is enough", () => {
    const r = presetRules("swe", { locations: ["Seattle"] });
    expect(
      matchPosting(r, posting({ locations: ["NYC", "Seattle, WA", "LA"] })),
    ).toBe(true);
  });
});

describe("firstMatch", () => {
  it("returns the first matching profile, or null", () => {
    const swe = { id: "a", ...presetRules("swe") };
    const quant = { id: "b", ...presetRules("quant") };
    expect(
      firstMatch(
        [swe, quant],
        posting({ title: "Quant Trader Intern", category: "Quant" }),
      )?.id,
    ).toBe("b");
    expect(
      firstMatch(
        [swe, quant],
        posting({ title: "Nurse Intern", category: null }),
      ),
    ).toBeNull();
  });
});
