import { describe, expect, it } from "vitest";

import type { AiProvider } from "@/lib/ai/types";
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

/*
 * M8 §0: the keyword step's "variants" are the model's own word that two
 * spellings are one skill, and nothing checks it. A posting that asks for
 * "C++" can come back as { term: "C++", variants: ["C"] }; if the resume
 * lists "C", a "rename this to the posting's spelling" edit would turn a
 * true skill into a false one. That edit (rename_list_value) no longer
 * exists. These fixtures are near-miss siblings a model could plausibly
 * group, each tried through every edit that could carry the new spelling,
 * with the grouping in the keywords the checks are given.
 */
const SIBLINGS = [
  { has: "C", claims: "C++" },
  { has: "Java", claims: "JavaScript" },
  { has: "SQL", claims: "NoSQL" },
] as const;

/** Mentions every sibling's claimed skill, so each grouping passes verifyKeywords. */
const siblingPosting = {
  title: "Software Engineer Intern",
  company: "Tidewater",
  text: `${backendPostingText()}
Also useful: C++, JavaScript, and NoSQL databases such as MongoDB.
`,
};

function backendPostingText() {
  return PEOPLE[0].posting.text;
}

/** The SWE fixture's Languages line (s4.l1) lists Python, TypeScript, Java, C, SQL. */
const LANGUAGES = listId(3, 0);

function siblingEdits(has: string, claims: string) {
  return {
    edits: [
      edit("rename_list_value", LANGUAGES, {
        text: claims,
        order: [has],
        keyword: claims,
      }),
      edit("add_list_value", LANGUAGES, { text: claims, keyword: claims }),
      edit("reword_bullet", bulletId(1, 0, 0), {
        text: `Built a caching layer in ${claims} for the pricing API that cut p95 latency by 40%`,
        keyword: claims,
      }),
      edit("reword_text", sectionId(3), { text: claims, keyword: claims }),
    ],
  };
}

const languagesOf = (content: ResumeContent) => {
  const section = content.sections[3];
  return section.layout === "list" ? section.items[0].values : [];
};

describe("never fabricates: a different skill passed off as another spelling", () => {
  const person = PEOPLE[0];

  it("rename_list_value is not an edit the model can ask for", () => {
    expect(EDIT_OPS).not.toContain("rename_list_value");
  });

  const siblingKeywords = (has: string, claims: string) => () => ({
    keywords: [
      {
        term: claims,
        importance: "required",
        kind: "hard_skill",
        variants: [has],
      },
      ...["Python", "REST APIs", "Redis", "Docker"].map((term) => ({
        term,
        importance: "required",
        kind: "hard_skill",
        variants: [],
      })),
    ],
  });
  const run = (provider: AiProvider) =>
    tailor(
      {
        master: person.resume,
        facts: [...person.facts],
        posting: siblingPosting,
        research: null,
      },
      { provider, measure: lineMeasure(40).measure },
    );

  it.each(SIBLINGS)(
    "a model asking to rename $has to $claims is refused by the output schema itself",
    async ({ has, claims }) => {
      const { provider } = scriptedProvider({
        posting_keywords: siblingKeywords(has, claims),
        resume_edits: () => siblingEdits(has, claims),
      });
      await expect(run(provider)).rejects.toThrow(/rename_list_value|Invalid/);
    },
  );

  it.each(SIBLINGS)(
    "a resume listing $has never comes out listing $claims",
    async ({ has, claims }) => {
      expect(languagesOf(person.resume)).toContain(has);
      const withoutRename = () => ({
        edits: siblingEdits(has, claims).edits.filter(
          (e) => e.op !== "rename_list_value",
        ),
      });
      const { provider } = scriptedProvider({
        posting_keywords: siblingKeywords(has, claims),
        resume_edits: withoutRename,
        resume_cuts: withoutRename,
      });
      const result = await run(provider);
      expect(result.blocked).toEqual([]);
      expect(languagesOf(result.content)).toContain(has);
      expect(languagesOf(result.content)).not.toContain(claims);
      for (const change of result.changes) {
        expect(`${change.what} ${change.after ?? ""}`).not.toContain(claims);
      }
      assertNothingInvented(
        { ...person, posting: siblingPosting },
        result.content,
      );
    },
  );

  it.each(SIBLINGS)(
    "applyEdits drops a rename of $has to $claims even with the grouping in its keywords",
    ({ has, claims }) => {
      const result = applyEdits({
        base: person.resume,
        master: person.resume,
        facts: [...person.facts],
        keywords: [{ term: claims, variants: [has] }],
        edits: [
          edit("rename_list_value", LANGUAGES, { text: claims, order: [has] }),
        ],
      });
      expect(result.changes).toEqual([]);
      expect(result.content).toEqual(person.resume);
      expect(result.dropped).toEqual([
        {
          op: "rename_list_value",
          target: LANGUAGES,
          reason: "unknown kind of edit",
        },
      ]);
    },
  );

  it.each(SIBLINGS)(
    "the whole-copy check refuses $claims in place of $has, whatever the keywords say",
    ({ has, claims }) => {
      const renamed = structuredClone(person.resume);
      const languages = renamed.sections[3];
      if (languages.layout === "list") {
        languages.items[0].values = languages.items[0].values.map((v) =>
          v === has ? claims : v,
        );
      }
      // An extra argument (the old aliases list) must change nothing.
      const check = untraceable as (...args: unknown[]) => string[];
      expect(
        check(person.resume, person.facts, renamed, [
          { term: claims, variants: [has] },
        ]),
      ).toEqual([`value “${claims}” isn't on the master or a fact`]);
    },
  );

  it("under a seeded fuzzer: 500 edit lists of renames and additions against mismatched groupings", () => {
    const random = mulberry32(2026);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)];
    const keywords = SIBLINGS.map((s) => ({
      term: s.claims,
      variants: [s.has],
    }));
    const ops = [
      "rename_list_value",
      "add_list_value",
      "reword_bullet",
      "reword_text",
    ];
    const ids = idsOf(person.resume);
    for (let run = 0; run < 500; run += 1) {
      const edits = Array.from({ length: 1 + Math.floor(random() * 8) }, () => {
        const sibling = pick(SIBLINGS);
        return edit(pick(ops), pick([LANGUAGES, ...ids]), {
          text:
            random() < 0.5 ? sibling.claims : `Used ${sibling.claims} daily`,
          order: [random() < 0.8 ? sibling.has : pick(SIBLINGS).has],
          keyword: sibling.claims,
        });
      });
      const output = applyEdits({
        base: person.resume,
        master: person.resume,
        facts: [...person.facts],
        keywords,
        edits,
      }).content;
      for (const { claims } of SIBLINGS) {
        expect(languagesOf(output)).not.toContain(claims);
        expect(resumeText(output)).not.toContain(claims);
      }
      expect(untraceable(person.resume, [...person.facts], output)).toEqual([]);
    }
  });
});

function resumeText(content: ResumeContent) {
  return corpusLines(content, []).join("\n");
}

describe("never overstates: a sibling skill in the facts or the report (M8 §0a)", () => {
  const person = PEOPLE[0];

  it.each(SIBLINGS)(
    "with $has on the resume and in a fact, $claims is reported missing, not matched or IN FACTS",
    async ({ has, claims }) => {
      const facts = [
        ...person.facts,
        {
          id: "11111111-0000-4000-8000-0000000000aa",
          kind: "skill" as const,
          text: `Used ${has} in a course project`,
          detail: "",
          source: "manual" as const,
        },
      ];
      const { provider, calls } = scriptedProvider({
        posting_keywords: () => ({
          keywords: [
            {
              term: claims,
              importance: "required",
              kind: "hard_skill",
              variants: [has],
            },
            ...["Python", "REST APIs", "Redis", "Docker"].map((term) => ({
              term,
              importance: "required",
              kind: "hard_skill",
              variants: [],
            })),
          ],
        }),
        resume_edits: () => ({
          edits: [
            edit("reword_bullet", bulletId(1, 0, 1), {
              text: `Wrote integration tests for 12 endpoints with pytest and ${has}`,
              keyword: claims,
            }),
          ],
        }),
      });
      const result = await tailor(
        {
          master: person.resume,
          facts,
          posting: siblingPosting,
          research: null,
        },
        { provider, measure: lineMeasure(40).measure },
      );
      expect(result.matched).not.toContain(claims);
      expect(result.missing).toContain(claims);
      expect(
        result.warnings.find((w) => w.kind === "skills_gap")?.message,
      ).toContain(claims);
      // The edit step is told the truth: missing, not on the resume or in facts.
      const editInput = calls.find((c) => c.name === "resume_edits")!.input;
      expect(editInput).toContain(
        `- ${claims} — required, hard skill: MISSING`,
      );
      expect(editInput).not.toContain(`(also: ${has})`);
      // And no change claims the posting asked for it because of the sibling.
      for (const change of result.changes) {
        expect(change.why).not.toContain(`“${claims}”`);
      }
    },
  );
});
