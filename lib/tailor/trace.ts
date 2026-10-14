/**
 * The last line of defence for hard rules 2 and 8: a whole-resume check of
 * the finished tailored copy against the master resume and the fact bank,
 * independent of how the copy was made. The per-edit checks in edits.ts are
 * stricter; this one only asks "is anything here not the user's?", and the
 * pipeline ships the master resume untouched if it finds anything (a bug,
 * not a judgment call: tests treat it as a release blocker).
 *
 * - Header: identical.
 * - Sections: the same titles and layouts in the same order.
 * - Entries: each one's heading, subheading, dates and location are an
 *   entry of the same section on the master, or (an added entry) a fact's
 *   text word for word with nothing else.
 * - Bullets and paragraphs: a line from the master or a fact as it is, or
 *   every word in it (bar function words) is on the master or in a fact.
 * - List lines: the same labels in the same order; every value is written,
 *   as a phrase, on the master or in a fact.
 */

import type { ResumeContent } from "@/lib/resume/structured";
import type { Fact } from "@/lib/schemas/fact-bank";

import {
  containsPhrase,
  hasWord,
  isFunctionWord,
  keySet,
  tokenize,
} from "./text";
import { corpusLines } from "./view";

export function untraceable(
  master: ResumeContent,
  facts: Fact[],
  tailored: ResumeContent,
  /** Other spellings of one posting keyword (edits.ts rename_list_value). */
  aliases: { term: string; variants: string[] }[] = [],
): string[] {
  const problems: string[] = [];
  const lines = corpusLines(master, facts);
  const exact = new Set(lines.map((l) => l.trim()));
  const words = keySet(...lines);

  const lineTraces = (line: string) =>
    exact.has(line.trim()) ||
    tokenize(line).every((t) => isFunctionWord(t.key) || hasWord(words, t.key));

  if (JSON.stringify(master.header) !== JSON.stringify(tailored.header)) {
    problems.push("the header changed");
  }
  if (master.sections.length !== tailored.sections.length) {
    problems.push(
      `${master.sections.length} sections became ${tailored.sections.length}`,
    );
    return problems;
  }

  tailored.sections.forEach((section, s) => {
    const original = master.sections[s];
    if (
      section.title !== original.title ||
      section.layout !== original.layout
    ) {
      problems.push(
        `section ${s + 1} is “${section.title}” (${section.layout}), not “${original.title}” (${original.layout})`,
      );
      return;
    }
    if (section.layout === "entries" && original.layout === "entries") {
      for (const entry of section.items) {
        const known = original.items.some(
          (o) =>
            o.heading === entry.heading &&
            o.subheading === entry.subheading &&
            o.dates === entry.dates &&
            o.location === entry.location,
        );
        const fromFact = facts.some(
          (f) =>
            f.text === entry.heading &&
            !entry.subheading &&
            !entry.dates &&
            !entry.location,
        );
        if (!known && !fromFact) {
          problems.push(
            `entry “${entry.heading}” isn't on the master or a fact`,
          );
        }
        for (const bullet of entry.bullets) {
          if (!lineTraces(bullet)) {
            problems.push(
              `bullet “${bullet}” has words that aren't the user's`,
            );
          }
        }
      }
    } else if (section.layout === "list" && original.layout === "list") {
      const labels = (items: { label: string }[]) =>
        items.map((i) => i.label).join("\u0000");
      if (labels(section.items) !== labels(original.items)) {
        problems.push(`the lines of “${section.title}” changed`);
      }
      for (const item of section.items) {
        for (const value of item.values) {
          const spellings = aliases
            .map((k) => [k.term, ...k.variants])
            .find((group) =>
              group.some(
                (g) => containsPhrase(value, g) && containsPhrase(g, value),
              ),
            );
          const written = (v: string) =>
            lines.some((line) => containsPhrase(line, v));
          if (!written(value) && !(spellings && spellings.some(written))) {
            problems.push(`value “${value}” isn't on the master or a fact`);
          }
        }
      }
    } else if (section.layout === "text" && original.layout === "text") {
      if (!lineTraces(section.text)) {
        problems.push(`“${section.title}” has words that aren't the user's`);
      }
    }
  });
  return problems;
}
