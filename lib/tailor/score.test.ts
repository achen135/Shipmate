import { describe, expect, it } from "vitest";

import { backendPosting } from "./__fixtures__/people";
import { KEYWORDS_SYSTEM } from "./prompts";
import {
  type ExtractedKeywords,
  hasKeyword,
  keywordLabel,
  orList,
  scoreText,
  verifyKeywords,
} from "./score";

const k = (
  term: string,
  importance: "required" | "preferred" = "required",
  variants: string[] = [],
) => ({
  term,
  importance,
  kind: "hard_skill" as const,
  variants,
  alternatives: [] as string[],
});

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

/*
 * Fix handoff (2026-10-16): Flash-Lite turned "Bachelor's, Master's or PhD"
 * into three required keywords and kept "graduating in 2027" as one. An
 * "or" list is one requirement with options, checked against the posting's
 * own text; eligibility and timing aren't keywords at all.
 */
describe('keywords: an "or" list is one requirement', () => {
  const posting = `Software Engineering Intern, Summer 2027.
Requirements: currently pursuing a Bachelor's, Master's or PhD in Computer Science, Engineering, Mathematics, or a related field, graduating in 2027.
Experience with Python and Go. Familiarity with Java, Kotlin, or C++. High school diploma required.
We work with BS/MS students too.`;
  const opts = (
    term: string,
    alternatives: string[],
    importance: "required" | "preferred" = "required",
  ) => ({ ...k(term, importance), alternatives });

  it('reads the posting\'s own "or" lists, and nothing joined by "and"', () => {
    expect(orList(posting, ["Bachelor's", "Master's", "PhD"])).toBe(true);
    expect(orList(posting, ["PhD", "Bachelor's"])).toBe(false); // Master's sits between
    expect(
      orList(posting, ["Computer Science", "Engineering", "Mathematics"]),
    ).toBe(true); // ", or a related field" after the list
    expect(orList(posting, ["Java", "Kotlin", "C++"])).toBe(true);
    expect(orList(posting, ["BS", "MS"])).toBe(true); // a slash
    expect(orList(posting, ["Python", "Go"])).toBe(false); // "and"
    expect(orList(posting, ["Python", "Java"])).toBe(false); // different sentences
    expect(orList(posting, ["Java", "Rust"])).toBe(false); // not in the posting
    expect(orList(posting, ["Java"])).toBe(false);
  });

  it("keeps a checked list as one keyword, and the posting's spelling of each option", () => {
    const verified = verifyKeywords(
      {
        keywords: [
          { ...opts("Bachelor's", ["Master's", "PhD"]), kind: "qualification" },
          {
            ...opts("Computer Science", ["Engineering", "Mathematics"]),
            kind: "qualification",
          },
          opts("Java", ["Kotlin", "C++"], "preferred"),
        ],
      },
      posting,
    );
    expect(verified.map(keywordLabel)).toEqual([
      "Bachelor's or Master's or PhD",
      "Computer Science or Engineering or Mathematics",
      "Java or Kotlin or C++",
    ]);
  });

  it('splits a grouping the posting doesn\'t write as an "or" list back into separate keywords', () => {
    const verified = verifyKeywords(
      { keywords: [opts("Python", ["Go"]), opts("Java", ["Rust"])] },
      posting,
    );
    // Python and Go: the posting says "and", so it may want both. Rust: not
    // in the posting at all.
    expect(verified.map(keywordLabel)).toEqual(["Python", "Go", "Java"]);
  });

  it("merges a lone option into the list it belongs to, keeping required", () => {
    const verified = verifyKeywords(
      {
        keywords: [
          { ...k("PhD", "preferred"), kind: "qualification" },
          { ...opts("Bachelor's", ["Master's", "PhD"]), kind: "qualification" },
          { ...k("Master's"), kind: "qualification" },
        ],
      },
      posting,
    );
    expect(verified).toHaveLength(1);
    expect(keywordLabel(verified[0])).toBe("Bachelor's or Master's or PhD");
    expect(verified[0].importance).toBe("required");
  });

  it("drops eligibility and timing: graduation, class year, enrollment, high school", () => {
    const verified = verifyKeywords(
      {
        keywords: [
          { ...k("graduating in 2027"), kind: "qualification" },
          { ...k("Summer 2027"), kind: "qualification" },
          { ...k("currently pursuing"), kind: "qualification" },
          { ...k("High school diploma"), kind: "qualification" },
          k("Python"),
        ],
      },
      posting,
    );
    expect(verified.map((v) => v.term)).toEqual(["Python"]);
    // A tool may still have a year in its name.
    expect(
      verifyKeywords(
        { keywords: [{ ...k("SQL Server 2019"), kind: "tool" }] },
        "Experience with SQL Server 2019",
      ).map((v) => v.term),
    ).toEqual(["SQL Server 2019"]);
  });

  it("scores the list once, matched by any one option", () => {
    const keywords = verifyKeywords(
      {
        keywords: [
          { ...opts("Bachelor's", ["Master's", "PhD"]), kind: "qualification" },
          k("Python"),
        ],
      },
      posting,
    );
    // Before: three required degrees, two of them "missing" for anyone.
    const result = scoreText(keywords, "M.S. in CS; Master's thesis; Python");
    expect(result.score).toBe(100);
    expect(hasKeyword("PhD candidate", keywords[0])).toBe(true);
    expect(hasKeyword("Associate's degree", keywords[0])).toBe(false);
  });

  it('the prompt says an "or" list is one requirement and timing isn\'t a keyword', () => {
    expect(KEYWORDS_SYSTEM).toMatch(/"or" list is ONE requirement/);
    expect(KEYWORDS_SYSTEM).toMatch(/graduating in 2027/);
    expect(KEYWORDS_SYSTEM).not.toMatch(/class of 2029/);
  });
});
