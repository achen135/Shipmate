import { describe, expect, it } from "vitest";

import {
  addedTokens,
  containsPhrase,
  keySet,
  mentionsPhrase,
  tokenize,
  wordKey,
} from "./text";

describe("words, as the no-fabrication check sees them", () => {
  it("keeps tech spellings whole", () => {
    expect(
      tokenize("C++, C#, Node.js and CI/CD on .NET").map((t) => t.raw),
    ).toEqual(["c++", "c#", "node.js", "and", "ci/cd", "on", "net"]);
  });

  it("folds plurals, possessives and verb endings, but not into another word", () => {
    expect(wordKey("APIs")).toBe(wordKey("API"));
    expect(wordKey("migrated")).toBe(wordKey("migrating"));
    expect(wordKey("migrate")).toBe(wordKey("migrated"));
    expect(wordKey("tests")).toBe(wordKey("testing"));
    expect(wordKey("Google's")).toBe(wordKey("Google"));
    expect(wordKey("string")).toBe("string");
    expect(wordKey("analysis")).toBe("analysis");
    expect(wordKey("process")).toBe("process");
  });

  it("phrases match whole words only", () => {
    expect(
      containsPhrase("Built machine learning models", "Machine Learning"),
    ).toBe(true);
    expect(containsPhrase("JavaScript, TypeScript", "Java")).toBe(false);
    expect(containsPhrase("Languages: C, Python", "C++")).toBe(false);
    expect(containsPhrase("Languages: C++, Python", "C++")).toBe(true);
    expect(containsPhrase("anything", "")).toBe(false);
  });

  it("names the words a new line adds", () => {
    expect(
      addedTokens("Built a caching layer", "Built a Redis caching layer").map(
        (t) => [t.raw, t.named],
      ),
    ).toEqual([["redis", true]]);
  });

  it("compound words also count their parts", () => {
    const keys = keySet("real-time dashboards");
    expect(keys.has("real-time")).toBe(true);
    expect(keys.has("real")).toBe(true);
  });
});

/*
 * M8 §0d: for scoring only, a phrase of two or more words may have a word
 * or two between its words ("AI agents" in "AI editing agents"), the way a
 * person reads it. The no-fabrication checks keep containsPhrase, which
 * stays exact.
 */
describe("mentionsPhrase: the score's looser reading (M8 §0d)", () => {
  it("finds a phrase with a word or two inserted", () => {
    expect(
      mentionsPhrase("Built AI editing agents for writers", "AI agents"),
    ).toBe(true);
    expect(
      mentionsPhrase(
        "Led cross-team stakeholder and vendor management",
        "stakeholder management",
      ),
    ).toBe(true);
    expect(
      mentionsPhrase("Built machine learning models", "machine learning"),
    ).toBe(true);
  });

  it("not with three words between, out of order, or across sentences and lines", () => {
    expect(
      mentionsPhrase(
        "AI tools that help editing teams build agents",
        "AI agents",
      ),
    ).toBe(false);
    expect(mentionsPhrase("agents built with AI", "AI agents")).toBe(false);
    expect(mentionsPhrase("Studied AI. Agents came later", "AI agents")).toBe(
      false,
    );
    expect(mentionsPhrase("Studied AI\nAgents came later", "AI agents")).toBe(
      false,
    );
    expect(mentionsPhrase("Studied AI; agents came later", "AI agents")).toBe(
      false,
    );
  });

  it("a single word or tech spelling is matched exactly, as before", () => {
    expect(mentionsPhrase("Languages: C, Python", "C++")).toBe(false);
    expect(mentionsPhrase("Languages: C++, Python", "C")).toBe(false);
    expect(mentionsPhrase("JavaScript and TypeScript", "Java")).toBe(false);
    expect(mentionsPhrase("Node.js, Express", "Node.js")).toBe(true);
    expect(mentionsPhrase("C and Python and C++ tooling", "C++ tooling")).toBe(
      true,
    );
    expect(mentionsPhrase("wrote C code for tooling", "C++ tooling")).toBe(
      false,
    );
  });

  it("containsPhrase itself is still exact (the fabrication checks use it)", () => {
    expect(containsPhrase("Built AI editing agents", "AI agents")).toBe(false);
  });
});
