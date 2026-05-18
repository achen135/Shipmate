import { describe, expect, it } from "vitest";

import { backendPosting } from "./__fixtures__/people";
import { KEYWORDS_SYSTEM } from "./prompts";
import {
  type ExtractedKeywords,
  hasKeyword,
  scoreText,
  verifyKeywords,
} from "./score";

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
      // The posting writes "PostgreSQL": that's the keyword, not the model's
      // spelling (M8 §0a).
      k("PostgreSQL", "preferred", ["Postgres"]),
    ]);
  });
});

describe("score: matched ÷ wanted, required counted twice", () => {
  it("weights required keywords double, and matches the term's own spelling only", () => {
    const keywords = [
      k("Python"),
      k("SQL"),
      k("Kafka", "preferred"),
      k("PostgreSQL", "preferred", ["Postgres"]),
    ];
    // "Postgres" is the model's variant, not proof (M8 §0a).
    expect(scoreText(keywords, "Python and Postgres").score).toBe(33);
    const result = scoreText(keywords, "Python and PostgreSQL");
    // (2 + 1) / (2 + 2 + 1 + 1)
    expect(result.score).toBe(50);
    expect(result.matched.map((m) => m.term)).toEqual(["Python", "PostgreSQL"]);
    expect(result.missing.map((m) => m.term)).toEqual(["SQL", "Kafka"]);
  });
});

/*
 * M8 §0a: a keyword's `variants` are the keyword model's own claim that two
 * spellings are one skill. Nothing checks that, so they never widen a
 * match: not on the resume, not in the facts, not in the posting, and not
 * when two keywords look like duplicates. Near-miss siblings a model could
 * plausibly group:
 */
const SIBLINGS = [
  { has: "C", claims: "C++" },
  { has: "Java", claims: "JavaScript" },
  { has: "SQL", claims: "NoSQL" },
] as const;

describe("score: a variant is never proof (M8 §0a)", () => {
  it.each(SIBLINGS)(
    "a resume with only $has scores $claims as missing",
    ({ has, claims }) => {
      const keyword = k(claims, "required", [has]);
      const result = scoreText([keyword], `Languages: Python, ${has}`);
      expect(result.score).toBe(0);
      expect(result.matched).toEqual([]);
      expect(result.missing.map((m) => m.term)).toEqual([claims]);
    },
  );

  it.each(SIBLINGS)(
    "hasKeyword: $has on the page is not $claims",
    ({ has, claims }) => {
      expect(hasKeyword(`I know ${has}.`, k(claims, "required", [has]))).toBe(
        false,
      );
      expect(
        hasKeyword(`I know ${claims}.`, k(claims, "required", [has])),
      ).toBe(true);
    },
  );

  it.each(SIBLINGS)(
    "a posting that only says $has doesn't ask for $claims",
    ({ has, claims }) => {
      const verified = verifyKeywords(
        { keywords: [k(claims, "required", [has])] },
        `Requirements: experience with ${has}.`,
      );
      // Kept as what the posting really writes, never as the model's term.
      expect(verified.map((v) => v.term)).toEqual([has]);
    },
  );

  it.each(SIBLINGS)(
    "$claims grouped with $has doesn't swallow a separate $has requirement",
    ({ has, claims }) => {
      const verified = verifyKeywords(
        { keywords: [k(claims, "required", [has]), k(has, "required")] },
        `Requirements: ${claims} and ${has}.`,
      );
      expect(verified.map((v) => v.term)).toEqual([claims, has]);
      const result = scoreText(verified, `Languages: ${has}`);
      expect(result.matched.map((m) => m.term)).toEqual([has]);
      expect(result.missing.map((m) => m.term)).toEqual([claims]);
    },
  );
});

/*
 * M8 §0d: the score reads like a person. A phrase with a word inserted
 * still counts ("AI editing agents" has "AI agents"), and phrases that are
 * interview criteria, not resume words ("communicate openly", "experience
 * building software"), aren't keywords at all. §0a stays: variants never
 * count, and single words are exact.
 */
describe("score: closer to how a person reads it (M8 §0d)", () => {
  it("AI agents is matched by AI editing agents", () => {
    const result = scoreText(
      [k("AI agents"), k("Python")],
      "Built AI editing agents in Python",
    );
    expect(result.score).toBe(100);
  });

  it("C still never counts as C++ through the looser phrase match", () => {
    const result = scoreText(
      [k("C++"), k("C++ tooling"), k("embedded C++")],
      "Wrote embedded C code and C tooling",
    );
    expect(result.matched).toEqual([]);
  });

  it("the keyword prompt asks for resume words, not interview criteria", () => {
    expect(KEYWORDS_SYSTEM).toMatch(/things an interview judges/);
    expect(KEYWORDS_SYSTEM).toMatch(/communicate openly/);
  });

  it("generic qualifying phrases aren't kept as keywords", () => {
    const posting = `You'll communicate openly, ask questions early, and have experience building software.
You show leadership and stakeholder management, an ability to learn quickly, and a passion for learning.
Requirements: Python.`;
    const verified = verifyKeywords(
      {
        keywords: [
          { ...k("communicate openly"), kind: "soft_skill" },
          { ...k("ask questions early"), kind: "soft_skill" },
          k("experience building software"),
          { ...k("ability to learn quickly"), kind: "soft_skill" },
          { ...k("passion for learning"), kind: "soft_skill" },
          { ...k("leadership"), kind: "soft_skill" },
          { ...k("stakeholder management"), kind: "soft_skill" },
          k("Python"),
        ],
      },
      posting,
    );
    expect(verified.map((v) => v.term)).toEqual([
      "leadership",
      "stakeholder management",
      "Python",
    ]);
    // A resume that clearly shows the substance isn't marked missing on them.
    const result = scoreText(
      verified,
      "Led a team of 6 as project leadership; stakeholder and vendor management; Python",
    );
    expect(result.missing).toEqual([]);
  });
});
