import { describe, expect, it } from "vitest";

import { backendPosting } from "./__fixtures__/people";
import { type ExtractedKeywords, scoreText, verifyKeywords } from "./score";

const k = (
  term: string,
  importance: "required" | "preferred" = "required",
  variants: string[] = [],
) => ({ term, importance, kind: "hard_skill" as const, variants });

describe("keywords: only what the posting says", () => {
  it("drops a keyword the posting never mentions, and duplicates", () => {
    const extracted: ExtractedKeywords = {
      keywords: [
        k("Python"),
        k("Rust"),
        k("python"),
        k("REST APIs", "required", ["REST API", "REST APIs"]),
        k("Postgres", "preferred", ["PostgreSQL"]),
      ],
    };
    expect(verifyKeywords(extracted, backendPosting.text)).toEqual([
      k("Python"),
      // "REST API" is the same phrase as "REST APIs" (plurals fold).
      k("REST APIs", "required", []),
      k("Postgres", "preferred", ["PostgreSQL"]),
    ]);
  });
});

describe("score: matched ÷ wanted, required counted twice", () => {
  it("weights required keywords double and matches variants", () => {
    const keywords = [
      k("Python"),
      k("SQL"),
      k("Kafka", "preferred"),
      k("PostgreSQL", "preferred", ["Postgres"]),
    ];
    const result = scoreText(keywords, "Python and Postgres");
    // (2 + 1) / (2 + 2 + 1 + 1)
    expect(result.score).toBe(50);
    expect(result.matched.map((m) => m.term)).toEqual(["Python", "PostgreSQL"]);
    expect(result.missing.map((m) => m.term)).toEqual(["SQL", "Kafka"]);
  });
});
