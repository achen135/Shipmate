import { describe, expect, it } from "vitest";

import { addedTokens, containsPhrase, keySet, tokenize, wordKey } from "./text";

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
