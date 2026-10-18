/**
 * Hard rule 2's independent check, shared by never-fabricates.test.ts (made-
 * up adversarial and fuzzed edits) and recorded-runs.test.ts (real model
 * answers, replayed). See never-fabricates.test.ts for what each of the four
 * parts means. Test-only: it asserts with Vitest's expect.
 */

import { expect } from "vitest";

import type { ResumeContent } from "@/lib/resume/structured";
import type { Fact } from "@/lib/schemas/fact-bank";

import {
  hasWord,
  isFunctionWord,
  keySet,
  looksFactual,
  tokenize,
} from "../text";
import { untraceable } from "../trace";
import { corpusLines } from "../view";

type Person = {
  resume: ResumeContent;
  facts: readonly Fact[];
  posting: { title: string; text: string };
};

function linesOf(content: ResumeContent): string[] {
  return corpusLines(content, []);
}

export function assertNothingInvented(person: Person, output: ResumeContent) {
  const { resume: master, facts, posting } = person;

  // 1.
  expect(untraceable(master, facts as Fact[], output)).toEqual([]);

  // 2.
  const own = keySet(...corpusLines(master, facts as Fact[]));
  const postingOnly = new Set(
    [...keySet(posting.title, posting.text)].filter(
      (k) => !isFunctionWord(k) && !hasWord(own, k),
    ),
  );
  for (const line of linesOf(output)) {
    for (const token of tokenize(line)) {
      expect(
        postingOnly.has(token.key),
        `“${token.raw}” in “${line}” comes from the posting, not the person`,
      ).toBe(false);
    }
  }

  // 3.
  const factWords = keySet(...facts.flatMap((f) => [f.text, f.detail]));
  output.sections.forEach((section, s) => {
    const original = master.sections[s];
    if (section.layout !== "entries" || original.layout !== "entries") return;
    for (const entry of section.items) {
      const source = original.items.find((o) => o.heading === entry.heading);
      const entryWords = source
        ? keySet(
            source.heading,
            source.subheading,
            source.dates,
            source.location,
            ...source.bullets,
          )
        : new Set<string>();
      for (const bullet of entry.bullets) {
        for (const token of tokenize(bullet)) {
          if (!looksFactual(token)) continue;
          expect(
            hasWord(entryWords, token.key) || hasWord(factWords, token.key),
            `“${token.raw}” in “${bullet}” isn't from ${entry.heading} or a fact`,
          ).toBe(true);
        }
      }
    }
  });

  // 4.
  expect(output.header).toEqual(master.header);
  expect(output.sections.map((s) => [s.title, s.layout])).toEqual(
    master.sections.map((s) => [s.title, s.layout]),
  );
}
