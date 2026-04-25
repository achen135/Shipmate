import { describe, expect, it } from "vitest";

import type { ResumeContent } from "@/lib/resume/structured";
import type { Fact } from "@/lib/schemas/fact-bank";

import { PEOPLE } from "./__fixtures__/people";
import { lineMeasure, scriptedProvider } from "./__fixtures__/fake-provider";
import { EDIT_OPS, StructureChangeError, applyEdits } from "./edits";
import { tailor } from "./pipeline";
import { type Keyword, verifyKeywords } from "./score";
import {
  hasWord,
  isFunctionWord,
  keySet,
  looksFactual,
  tokenize,
} from "./text";
import { untraceable } from "./trace";
import {
  bulletId,
  corpusLines,
  entryId,
  factId,
  listId,
  sectionId,
} from "./view";

/*
 * Hard rule 2, over-tested on purpose (M7 handoff §2.4). For fixture people
 * whose every true fact is known, models that try every way of making
 * things up (and a seeded fuzzer that tries random ones) must never get a
 * fact into the tailored resume that isn't the person's own.
 *
 * A failure here is a release blocker, never a flaky test to retry.
 *
 * What "not the person's own" means, checked independently of the code
 * under test where possible:
 * 1. the whole-copy check (trace.ts) finds nothing;
 * 2. no word in the output appears only in the posting (the posting's words
 *    are what a model is tempted to borrow);
 * 3. every claim word (a number, a name, a tech spelling) in an entry's
 *    bullets is in that same entry on the master or in the fact bank, so a
 *    skill can't move into a job it wasn't used in;
 * 4. header, section titles, layouts and order are exactly the master's.
 */

type Person = (typeof PEOPLE)[number];

function linesOf(content: ResumeContent): string[] {
  return corpusLines(content, []);
}

function assertNothingInvented(
  person: Pick<Person, "resume" | "facts" | "posting">,
  output: ResumeContent,
) {
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

/** Every keyword-ish phrase in the posting: what a greedy model would add. */
function postingPhrases(posting: Person["posting"]): string[] {
  const phrases = new Set<string>();
  for (const line of posting.text.split("\n")) {
    for (const part of line.split(/[,()]|\band\b|\bor\b|\bwith\b/)) {
      const clean = part.replace(/^[-\s]+|[.\s]+$/g, "").trim();
      if (clean && clean.length <= 40) phrases.add(clean);
    }
  }
  return [...phrases];
}

const edit = (
  op: string,
  target: string,
  extra: {
    text?: string;
    order?: string[];
    fact?: string;
    keyword?: string;
  } = {},
) => ({ op, target, text: "", order: [], fact: "", keyword: "", ...extra });

/** A model trying every way to make things up, all at once. */
function adversarialEdits(person: Person) {
  const { resume, facts, posting } = person;
  const phrases = postingPhrases(posting);
  const edits: ReturnType<typeof edit>[] = [];
  resume.sections.forEach((section, s) => {
    if (section.layout === "entries") {
      section.items.forEach((entry, i) => {
        entry.bullets.forEach((bullet, b) => {
          const id = bulletId(s, i, b);
          for (const phrase of phrases.slice(0, 25)) {
            edits.push(
              edit("reword_bullet", id, {
                text: `${bullet} using ${phrase}`,
                keyword: phrase,
              }),
            );
          }
          // Inflate the role, change the numbers, borrow the posting's words.
          edits.push(
            edit("reword_bullet", id, {
              text: bullet.replace(
                /^(Assisted with|Helped|Contributed to|Co-authored)\s+/i,
                "Led ",
              ),
            }),
            edit("reword_bullet", id, {
              text: bullet.replace(/\d+/g, (n) => String(Number(n) * 3)),
            }),
            edit("reword_bullet", id, { text: `Led a team of 5 to ${bullet}` }),
          );
          // Every fact, cited for every bullet.
          facts.forEach((fact, f) =>
            edits.push(
              edit("reword_bullet", id, {
                text: `${bullet}, ${fact.text}`,
                fact: factId(f),
              }),
            ),
          );
        });
        facts.forEach((fact, f) =>
          edits.push(
            edit("add_bullet", entryId(s, i), {
              text: `${fact.text} for ${posting.company}`,
              fact: factId(f),
            }),
            edit("add_bullet", entryId(s, i), {
              text: fact.detail || fact.text,
              fact: factId(f),
            }),
          ),
        );
        for (const phrase of phrases.slice(0, 10)) {
          edits.push(edit("add_bullet", entryId(s, i), { text: phrase }));
        }
      });
      edits.push(edit("add_entry", sectionId(s), { fact: "f99" }));
      facts.forEach((_, f) =>
        edits.push(edit("add_entry", sectionId(s), { fact: factId(f) })),
      );
    } else if (section.layout === "list") {
      section.items.forEach((_, l) => {
        for (const phrase of phrases) {
          edits.push(edit("add_list_value", listId(s, l), { text: phrase }));
        }
      });
    } else {
      for (const phrase of phrases.slice(0, 15)) {
        edits.push(
          edit("reword_text", sectionId(s), {
            text: `${section.text} Skilled in ${phrase}.`,
          }),
        );
      }
    }
  });
  return { edits };
}

const keywordsFor = (person: Person) => () => ({
  keywords: postingPhrases(person.posting)
    .slice(0, 30)
    .map((term) => ({
      term,
      importance: "required",
      kind: "hard_skill",
      variants: [],
    })),
});

describe.each(PEOPLE.map((p) => [p.name, p] as const))(
  "never fabricates: %s",
  (_, person) => {
    it("against a model that tries every way of making things up", async () => {
      const { provider } = scriptedProvider({
        posting_keywords: keywordsFor(person),
        resume_edits: () => adversarialEdits(person),
        // The trim step tries to sneak additions in too.
        resume_cuts: () => adversarialEdits(person),
      });
      const result = await tailor(
        {
          master: person.resume,
          facts: [...person.facts],
          posting: person.posting,
          research: { summary: "", values: [], tech: ["Kafka", "Rust"] },
        },
        { provider, measure: lineMeasure(12).measure },
      );
      expect(result.blocked).toEqual([]);
      assertNothingInvented(person, result.content);
      // And the "why" of every change is code-written, from the posting's
      // own keywords or the person's facts, never the model's prose.
      for (const change of result.changes) {
        expect(change.why).toMatch(
          /^(the posting asks for “.+”|from your profile facts|it's already elsewhere on your resume|clearer for this posting|it's less related|the ones closest|what the posting asks for|to keep it to one page|to make room)/,
        );
      }
    });

    it("under a seeded fuzzer: 500 random edit lists", () => {
      const random = mulberry32(7 + person.name.length);
      const pick = <T>(items: readonly T[]): T =>
        items[Math.floor(random() * items.length)];
      const own = corpusLines(person.resume, [...person.facts]);
      const words = [
        ...postingPhrases(person.posting),
        ...own,
        ...own.flatMap((l) => l.split(/\s+/)),
        "42",
        "10,000",
        "Rust",
        "Led",
        "Kubernetes",
        "C++",
      ];
      const ids = idsOf(person.resume).concat(["s9", "s1.e9.b9", "f1", ""]);
      const keywords: Keyword[] = verifyKeywords(
        keywordsFor(person)() as never,
        person.posting.text,
      );

      for (let run = 0; run < 500; run += 1) {
        const edits = Array.from(
          { length: 1 + Math.floor(random() * 12) },
          () =>
            edit(pick(EDIT_OPS), pick(ids), {
              text: Array.from({ length: 1 + Math.floor(random() * 6) }, () =>
                pick(words),
              ).join(" "),
              order: Array.from({ length: Math.floor(random() * 3) }, () =>
                pick(ids),
              ),
              fact: random() < 0.5 ? factId(Math.floor(random() * 5)) : "",
              keyword: random() < 0.5 ? pick(words) : "",
            }),
        );
        let output = person.resume;
        try {
          output = applyEdits({
            base: person.resume,
            master: person.resume,
            facts: [...person.facts],
            keywords,
            edits,
          }).content;
        } catch (error) {
          expect(error).toBeInstanceOf(StructureChangeError);
        }
        assertNothingInvented(person, output);
      }
    });
  },
);

function idsOf(content: ResumeContent): string[] {
  const ids: string[] = [];
  content.sections.forEach((section, s) => {
    ids.push(sectionId(s));
    if (section.layout === "entries") {
      section.items.forEach((entry, i) => {
        ids.push(entryId(s, i));
        entry.bullets.forEach((_, b) => ids.push(bulletId(s, i, b)));
      });
    } else if (section.layout === "list") {
      section.items.forEach((_, l) => ids.push(listId(s, l)));
    }
  });
  return ids;
}

/** A small seeded PRNG, so a failure reproduces exactly. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
