/**
 * How a resume and the fact bank are shown to the model: every section,
 * entry, bullet and list line gets a short id ("s2.e1.b3"), so an edit can
 * name exactly what it changes, and code can check it (lib/tailor/edits.ts).
 */

import { type ResumeContent, joinValues } from "@/lib/resume/structured";
import type { Fact } from "@/lib/schemas/fact-bank";

export const sectionId = (s: number) => `s${s + 1}`;
export const entryId = (s: number, e: number) => `s${s + 1}.e${e + 1}`;
export const bulletId = (s: number, e: number, b: number) =>
  `s${s + 1}.e${e + 1}.b${b + 1}`;
export const listId = (s: number, l: number) => `s${s + 1}.l${l + 1}`;
export const factId = (f: number) => `f${f + 1}`;

export function describeResume(content: ResumeContent): string {
  const lines: string[] = [];
  content.sections.forEach((section, s) => {
    lines.push(
      `[${sectionId(s)}] Section "${section.title}" (${section.layout})`,
    );
    if (section.layout === "entries") {
      section.items.forEach((entry, e) => {
        const head = [
          entry.heading,
          entry.subheading,
          entry.dates,
          entry.location,
        ]
          .filter(Boolean)
          .join(" | ");
        lines.push(`  [${entryId(s, e)}] ${head}`);
        entry.bullets.forEach((bullet, b) => {
          lines.push(`    [${bulletId(s, e, b)}] ${bullet}`);
        });
      });
    } else if (section.layout === "list") {
      section.items.forEach((item, l) => {
        lines.push(
          `  [${listId(s, l)}] ${item.label ? `${item.label}: ` : ""}${joinValues(item)}`,
        );
      });
    } else {
      lines.push(`  ${section.text}`);
    }
  });
  return lines.join("\n");
}

export function describeFacts(facts: Fact[]): string {
  if (facts.length === 0) return "(none)";
  return facts
    .map(
      (fact, f) =>
        `[${factId(f)}] (${fact.kind}) ${fact.text}${fact.detail ? ` — ${fact.detail}` : ""}`,
    )
    .join("\n");
}

/**
 * Everything the user has written down, line by line: what edits may draw
 * words from.
 */
export function corpusLines(content: ResumeContent, facts: Fact[]): string[] {
  const out: string[] = [];
  for (const section of content.sections) {
    out.push(section.title);
    if (section.layout === "entries") {
      for (const e of section.items) {
        out.push(e.heading, e.subheading, e.dates, e.location, ...e.bullets);
      }
    } else if (section.layout === "list") {
      for (const item of section.items) out.push(item.label, ...item.values);
    } else {
      out.push(section.text);
    }
  }
  for (const fact of facts) out.push(fact.text, fact.detail);
  return out.filter(Boolean);
}
