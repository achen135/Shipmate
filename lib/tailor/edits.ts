/**
 * The edit step's output, and the code that applies it (hard rules 2 and 8).
 *
 * The model never rewrites the resume. It returns a list of operations on
 * the ids in lib/tailor/view.ts ("reword bullet s2.e1.b3 to …", "add the
 * value PyTorch to s4.l2"). This file applies them to a copy of the master
 * resume, one at a time, and checks each against what the user actually
 * wrote down. An operation that fails a check is dropped, with the reason;
 * nothing is "fixed up". What's applied becomes the "What changed" list,
 * written here from the operation itself, so the model can't invent a
 * reason any more than a fact.
 *
 * The checks, per operation:
 * - Reword a bullet / add a bullet: every word the new line adds must
 *   already be the user's. Words that make a claim (a number, a name or tech
 *   spelling, or a word from the posting's keywords) must come from the same
 *   entry (its heading, subheading, dates, location, bullets) or from a fact
 *   the edit cites (the user's profile facts may go into any entry: they
 *   said so, 2026-10-14). Other words must be
 *   somewhere on the resume or in the fact bank. So the skills list can't
 *   vouch for "used Kubernetes" in an unrelated job, and nothing comes from
 *   the posting at all. Adding a bullet always needs a cited fact.
 *   A reworded line also can't drop a word that sizes the user's role
 *   ("assisted", "helped", "contributed", …): that would make it sound
 *   bigger than it was.
 * - Add a list value: the value must be written, as a phrase, on the resume
 *   or in a fact.
 * - There is no "rewrite a value in the posting's spelling" operation (it
 *   was M7's rename_list_value). It trusted the keyword step's variants,
 *   which are the model's own claim that two spellings are one skill, so a
 *   listed "C" could become "C++". Removed in M8; a hand-curated synonym
 *   table would be the way back, not a heuristic.
 * - Add an entry: built in code, word for word, from one fact.
 * - Reword a paragraph section (a summary): every added word must be on the
 *   resume or in a fact.
 * - Drop and reorder: within one entry, list line or section only.
 *
 * - Bold (`**…**`, lib/resume/bold.ts): the model sees plain text; a
 *   reworded line keeps bold only on spans that were bold in it before,
 *   and nothing new is ever bolded.
 *
 * Sections are never renamed, merged, split, added, removed or reordered
 * (hard rule 8): there is no operation for it, and an edit list that asks
 * for one anyway (an unknown section-level op, or moving entries between
 * sections) is rejected whole, not just that op.
 */

import { z } from "zod";

import { carryBold, stripBold } from "@/lib/resume/bold";
import type { ResumeContent } from "@/lib/resume/structured";
import type { Fact } from "@/lib/schemas/fact-bank";

import {
  addedTokens,
  containsPhrase,
  hasWord,
  isFunctionWord,
  keySet,
  looksFactual,
  tokenize,
} from "./text";
import {
  bulletId,
  corpusLines,
  entryId,
  factId,
  listId,
  sectionId,
} from "./view";

// ---------------------------------------------------------------- schema

export const EDIT_OPS = [
  "reword_bullet",
  "add_bullet",
  "drop_bullet",
  "order_bullets",
  "drop_entry",
  "order_entries",
  "add_entry",
  "add_list_value",
  "drop_list_value",
  "order_list_values",
  "reword_text",
] as const;
export type EditOpName = (typeof EDIT_OPS)[number];

export const CUT_OPS: readonly EditOpName[] = [
  "drop_bullet",
  "drop_entry",
  "drop_list_value",
];

/** What the model returns. Every field required ("" or [] when unused). */
export const editSchema = z.object({
  op: z.enum(EDIT_OPS),
  /** The id it acts on: a bullet, entry, section or list line. */
  target: z.string(),
  /** The new line, or the list value, or "". */
  text: z.string(),
  /** order_*: ids (bullets, entries) or values (list), new order first. */
  order: z.array(z.string()),
  /** The fact id ("f3") the new words come from, or "". */
  fact: z.string(),
  /** The posting keyword this serves, or "". */
  keyword: z.string(),
});
export type Edit = z.infer<typeof editSchema>;

export const editPlanSchema = z.object({ edits: z.array(editSchema) });
export type EditPlan = z.infer<typeof editPlanSchema>;

/** Read leniently: a malformed op is dropped, an unknown one inspected. */
const looseEditSchema = z.object({
  op: z.string(),
  target: z.string().catch(""),
  text: z.string().catch(""),
  order: z.array(z.string()).catch([]),
  fact: z.string().catch(""),
  keyword: z.string().catch(""),
});

/** Section-level operations: none exists, and asking for one rejects all. */
const SECTION_LEVEL =
  /^(rename|retitle|merge|split|add|drop|remove|delete|move|order|reorder)_?(section|sections|heading|headings)$/i;

export class StructureChangeError extends Error {
  constructor(readonly detail: string) {
    super(`The edits tried to change the resume's sections (${detail}).`);
    this.name = "StructureChangeError";
  }
}

// ---------------------------------------------------------------- results

export type Change = {
  what: string;
  why: string;
  before?: string;
  after?: string;
};

export type Dropped = { op: string; target: string; reason: string };

export type ApplyResult = {
  content: ResumeContent;
  changes: Change[];
  dropped: Dropped[];
};

export type ApplyInput = {
  /** What the edits act on: the master resume (or, for cuts, the tailored copy). */
  base: ResumeContent;
  /** The user's master resume: where words may come from. */
  master: ResumeContent;
  facts: Fact[];
  /**
   * The posting's keywords (verified against its text). Their variants and
   * an "or" list's other options only add claim words (stricter checks);
   * variants never match anything (§0a).
   */
  keywords: { term: string; variants: string[]; alternatives?: string[] }[];
  edits: unknown[];
  /** Only these ops (the one-page step allows drops only). */
  allowed?: readonly EditOpName[];
  /** Why a drop happened, for the change list (one-page step). */
  dropReason?: string;
};

// ---------------------------------------------------------------- working copy

type WBullet = { id: string; text: string; original: string };
type WEntry = {
  id: string;
  heading: string;
  subheading: string;
  dates: string;
  location: string;
  bullets: WBullet[];
  /** Original bullets' text: this entry's own words. */
  own: string[];
  dropped: boolean;
  nextBullet: number;
};
type WList = {
  id: string;
  label: string;
  values: string[];
  separator?: ";";
};
type WSection =
  | {
      id: string;
      title: string;
      layout: "entries";
      entries: WEntry[];
      headingPairsWith?: "dates" | "location";
    }
  | { id: string; title: string; layout: "list"; lists: WList[] }
  | {
      id: string;
      title: string;
      layout: "text";
      text: string;
      original: string;
    };

function toWorking(content: ResumeContent): WSection[] {
  return content.sections.map((section, s): WSection => {
    if (section.layout === "entries") {
      return {
        id: sectionId(s),
        title: section.title,
        layout: "entries",
        ...(section.headingPairsWith
          ? { headingPairsWith: section.headingPairsWith }
          : {}),
        entries: section.items.map((e, i) => ({
          id: entryId(s, i),
          heading: e.heading,
          subheading: e.subheading,
          dates: e.dates,
          location: e.location,
          bullets: e.bullets.map((text, b) => ({
            id: bulletId(s, i, b),
            text,
            original: text,
          })),
          own: [...e.bullets],
          dropped: false,
          nextBullet: e.bullets.length,
        })),
      };
    }
    if (section.layout === "list") {
      return {
        id: sectionId(s),
        title: section.title,
        layout: "list",
        lists: section.items.map((item, l) => ({
          id: listId(s, l),
          label: item.label,
          values: [...item.values],
          ...(item.separator ? { separator: item.separator } : {}),
        })),
      };
    }
    return {
      id: sectionId(s),
      title: section.title,
      layout: "text",
      text: section.text,
      original: section.text,
    };
  });
}

function fromWorking(
  header: ResumeContent["header"],
  sections: WSection[],
): ResumeContent {
  return {
    header,
    sections: sections.map((section) => {
      if (section.layout === "entries") {
        return {
          title: section.title,
          layout: "entries" as const,
          ...(section.headingPairsWith
            ? { headingPairsWith: section.headingPairsWith }
            : {}),
          items: section.entries
            .filter((e) => !e.dropped)
            .map((e) => ({
              heading: e.heading,
              subheading: e.subheading,
              dates: e.dates,
              location: e.location,
              bullets: e.bullets.map((b) => b.text),
            })),
        };
      }
      if (section.layout === "list") {
        return {
          title: section.title,
          layout: "list" as const,
          items: section.lists.map((l) => ({
            label: l.label,
            values: [...l.values],
            ...(l.separator ? { separator: l.separator } : {}),
          })),
        };
      }
      return {
        title: section.title,
        layout: "text" as const,
        text: section.text,
      };
    }),
  };
}

// ---------------------------------------------------------------- checks

/** Words that size the user's part in something. Rewording keeps them. */
const SCOPE_WORDS = new Set(
  "assisted assist helped help contributed contribute supported support participated participate shadowed collaborated collaborate co-led co-founded co-authored coursework course class member alongside learning learned intro introductory"
    .split(" ")
    .map((w) => tokenize(w)[0]?.key ?? w),
);

const quote = (text: string) =>
  `“${text.length > 70 ? `${text.slice(0, 67)}…` : text}”`;

type Evidence = {
  /** Every word on the master resume and in the fact bank. */
  global: Set<string>;
  /** Words that make a claim about the posting's asks. */
  keywordWords: Set<string>;
};

/**
 * Is every word `after` adds over `before` allowed? Returns the problem, or
 * null. `local` is the entry's own words (plus a cited fact's).
 */
function lineProblem(
  before: string,
  after: string,
  local: Set<string> | null,
  evidence: Evidence,
): string | null {
  for (const token of addedTokens(before, after)) {
    if (isFunctionWord(token.key)) continue;
    const claim =
      looksFactual(token) || hasWord(evidence.keywordWords, token.key);
    if (claim && local && !hasWord(local, token.key)) {
      return `${quote(token.raw)} isn't in this entry or a fact about it`;
    }
    if (!hasWord(evidence.global, token.key)) {
      return `${quote(token.raw)} isn't on your resume or in your facts`;
    }
  }
  const kept = keySet(after);
  for (const token of tokenize(before)) {
    if (SCOPE_WORDS.has(token.key) && !hasWord(kept, token.key)) {
      return `it drops ${quote(token.raw)}, which would make your part sound bigger`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- apply

type Found =
  | { kind: "section"; section: WSection }
  | {
      kind: "entry";
      section: Extract<WSection, { layout: "entries" }>;
      entry: WEntry;
    }
  | {
      kind: "bullet";
      section: Extract<WSection, { layout: "entries" }>;
      entry: WEntry;
      bullet: WBullet;
    }
  | {
      kind: "list";
      section: Extract<WSection, { layout: "list" }>;
      list: WList;
    };

function find(sections: WSection[], id: string): Found | null {
  for (const section of sections) {
    if (section.id === id) return { kind: "section", section };
    if (section.layout === "entries") {
      for (const entry of section.entries) {
        if (entry.id === id) return { kind: "entry", section, entry };
        for (const bullet of entry.bullets) {
          if (bullet.id === id)
            return { kind: "bullet", section, entry, bullet };
        }
      }
    } else if (section.layout === "list") {
      for (const list of section.lists) {
        if (list.id === id) return { kind: "list", section, list };
      }
    }
  }
  return null;
}

/** Put the named items first, in that order; the rest keep their order. */
function reorder<T>(items: T[], key: (item: T) => string, order: string[]) {
  const named = order
    .map((k) => items.find((item) => key(item) === k))
    .filter((item): item is T => item !== undefined);
  const unique = [...new Set(named)];
  return [...unique, ...items.filter((item) => !unique.includes(item))];
}

const where = (entry: WEntry) => entry.heading || "an untitled entry";

export function applyEdits(input: ApplyInput): ApplyResult {
  const { base, master, facts, keywords } = input;
  const allowed = new Set(input.allowed ?? EDIT_OPS);
  const sections = toWorking(base);
  const changes: Change[] = [];
  const dropped: Dropped[] = [];

  const evidence: Evidence = {
    global: keySet(...corpusLines(master, facts)),
    keywordWords: new Set(
      [
        ...keySet(
          ...keywords.flatMap((k) => [
            k.term,
            ...k.variants,
            ...(k.alternatives ?? []),
          ]),
        ),
      ].filter((k) => !isFunctionWord(k)),
    ),
  };
  const lines = corpusLines(master, facts);
  const factById = new Map(facts.map((fact, f) => [factId(f), fact]));

  /** A keyword the posting really has, and that this change newly mentions. */
  const keywordFor = (edit: Edit, before: string, after: string) => {
    const wanted = edit.keyword.trim();
    if (!wanted) return null;
    // In the keyword's own spelling only: a variant isn't proof (§0a). An
    // "or" list may be named by any of its options, or all of them.
    const same = (a: string, b: string) =>
      containsPhrase(a, b) && containsPhrase(b, a);
    const options = (k: (typeof keywords)[number]) => [
      k.term,
      ...(k.alternatives ?? []),
    ];
    const known = keywords.find(
      (k) =>
        options(k).some((o) => same(o, wanted)) ||
        same(options(k).join(" or "), wanted),
    );
    if (!known) return null;
    return (
      options(known).find(
        (o) => containsPhrase(after, o) && !containsPhrase(before, o),
      ) ?? null
    );
  };
  const askedFor = (kw: string | null) =>
    kw ? `the posting asks for ${quote(kw)}` : null;
  const fromFact = (fact: Fact | undefined) =>
    fact ? `from your profile facts (${quote(fact.text)})` : null;
  const because = (...parts: (string | null)[]) =>
    parts.filter(Boolean).join("; ");

  // Parse; reject outright anything that reaches for the section structure.
  const parsed: Edit[] = [];
  for (const raw of input.edits) {
    const loose = looseEditSchema.safeParse(raw);
    if (!loose.success) {
      dropped.push({ op: "?", target: "", reason: "not an edit" });
      continue;
    }
    if (SECTION_LEVEL.test(loose.data.op)) {
      throw new StructureChangeError(loose.data.op);
    }
    const strict = editSchema.safeParse(loose.data);
    if (!strict.success) {
      dropped.push({
        op: loose.data.op,
        target: loose.data.target,
        reason: "unknown kind of edit",
      });
      continue;
    }
    parsed.push(strict.data);
  }
  for (const edit of parsed) {
    if (edit.op !== "order_entries") continue;
    const found = find(sections, edit.target);
    const home = found?.kind === "section" ? found.section.id : null;
    for (const id of edit.order) {
      const other = find(sections, id);
      if (other?.kind === "entry" && other.section.id !== home) {
        throw new StructureChangeError(`moving ${id} into ${edit.target}`);
      }
    }
  }

  const drop = (edit: Edit, reason: string) =>
    dropped.push({ op: edit.op, target: edit.target, reason });

  // Content first, then order: an order names the original ids.
  const ordered = [
    ...parsed.filter((e) => !e.op.startsWith("order_")),
    ...parsed.filter((e) => e.op.startsWith("order_")),
  ];

  for (const edit of ordered) {
    if (!allowed.has(edit.op)) {
      drop(edit, "not allowed at this step");
      continue;
    }
    const found = find(sections, edit.target);
    const fact = edit.fact.trim() ? factById.get(edit.fact.trim()) : undefined;
    if (edit.fact.trim() && !fact) {
      drop(edit, `no fact ${edit.fact}`);
      continue;
    }

    switch (edit.op) {
      case "reword_bullet": {
        if (found?.kind !== "bullet") {
          drop(edit, "no such bullet");
          break;
        }
        const { entry, bullet } = found;
        // The model sees and writes plain text; the line keeps only the
        // bold its own kept words had (never new bold).
        const text = carryBold(bullet.text, edit.text.trim());
        if (!stripBold(text) || text.length > 600) {
          drop(edit, "empty or too long");
          break;
        }
        if (text === bullet.text) {
          drop(edit, "no change");
          break;
        }
        const local = keySet(
          entry.heading,
          entry.subheading,
          entry.dates,
          entry.location,
          ...entry.own,
          ...(fact ? [fact.text, fact.detail] : []),
        );
        const problem = lineProblem(bullet.text, text, local, evidence);
        if (problem) {
          drop(edit, problem);
          break;
        }
        const kw = keywordFor(edit, bullet.text, text);
        changes.push({
          what: `Reworded a bullet under ${where(entry)}${kw ? ` to mention ${quote(kw)}` : ""}`,
          why:
            because(askedFor(kw), fromFact(fact)) ||
            "clearer for this posting, in words already on your resume",
          before: bullet.text,
          after: text,
        });
        bullet.text = text;
        break;
      }

      case "add_bullet": {
        if (found?.kind !== "entry" || found.entry.dropped) {
          drop(edit, "no such entry");
          break;
        }
        const { entry } = found;
        const text = stripBold(edit.text.trim());
        if (!fact) {
          drop(edit, "a new bullet needs a fact to come from");
          break;
        }
        if (!text || text.length > 600 || entry.bullets.length >= 20) {
          drop(edit, "empty, too long, or too many bullets");
          break;
        }
        if (entry.bullets.some((b) => containsPhrase(b.text, text))) {
          drop(edit, "already there");
          break;
        }
        const local = keySet(
          entry.heading,
          entry.subheading,
          entry.dates,
          entry.location,
          ...entry.own,
          fact.text,
          fact.detail,
        );
        const problem = lineProblem("", text, local, evidence);
        if (problem) {
          drop(edit, problem);
          break;
        }
        const kw = keywordFor(edit, "", text);
        entry.nextBullet += 1;
        entry.bullets.push({
          id: `${entry.id}.n${entry.nextBullet}`,
          text,
          original: "",
        });
        changes.push({
          what: `Added a bullet under ${where(entry)}: ${quote(text)}`,
          why: because(fromFact(fact), askedFor(kw)),
          after: text,
        });
        break;
      }

      case "drop_bullet": {
        if (found?.kind !== "bullet") {
          drop(edit, "no such bullet");
          break;
        }
        const { entry, bullet } = found;
        entry.bullets = entry.bullets.filter((b) => b !== bullet);
        changes.push({
          what: `Left out a bullet under ${where(entry)}: ${quote(bullet.text)}`,
          why:
            input.dropReason ??
            "it's less related to this posting than your other bullets",
          before: bullet.text,
        });
        break;
      }

      case "order_bullets": {
        if (found?.kind !== "entry" || found.entry.dropped) {
          drop(edit, "no such entry");
          break;
        }
        const { entry } = found;
        const next = reorder(entry.bullets, (b) => b.id, edit.order);
        if (next.every((b, i) => b === entry.bullets[i])) {
          drop(edit, "no change");
          break;
        }
        entry.bullets = next;
        const kw = keywordFor(edit, "", next[0]?.text ?? "");
        changes.push({
          what: `Put the bullets under ${where(entry)} in a new order, starting with ${quote(next[0].text)}`,
          why: askedFor(kw) ?? "the ones closest to this posting go first",
        });
        break;
      }

      case "drop_entry": {
        if (found?.kind !== "entry" || found.entry.dropped) {
          drop(edit, "no such entry");
          break;
        }
        found.entry.dropped = true;
        changes.push({
          what: `Left out ${quote(where(found.entry))} from ${found.section.title || "your resume"}`,
          why:
            input.dropReason ??
            "it's less related to this posting than the rest",
        });
        break;
      }

      case "order_entries": {
        if (found?.kind !== "section" || found.section.layout !== "entries") {
          drop(edit, "no such section of entries");
          break;
        }
        const section = found.section;
        const next = reorder(section.entries, (e) => e.id, edit.order);
        if (next.every((e, i) => e === section.entries[i])) {
          drop(edit, "no change");
          break;
        }
        section.entries = next;
        const first = next.find((e) => !e.dropped);
        changes.push({
          what: `Put ${section.title || "the entries"} in a new order, starting with ${quote(first ? where(first) : "")}`,
          why: "the ones closest to this posting go first",
        });
        break;
      }

      case "add_entry": {
        if (found?.kind !== "section" || found.section.layout !== "entries") {
          drop(edit, "no such section of entries");
          break;
        }
        if (!fact) {
          drop(edit, "a new entry needs a fact to come from");
          break;
        }
        const section = found.section;
        if (
          section.entries.length >= 30 ||
          section.entries.some(
            (e) => !e.dropped && containsPhrase(e.heading, fact.text),
          )
        ) {
          drop(edit, "already there, or too many entries");
          break;
        }
        // Built here, word for word from the fact: nothing for the model to
        // embellish.
        const id = `${section.id}.n${section.entries.length + 1}`;
        section.entries.push({
          id,
          heading: fact.text,
          subheading: "",
          dates: "",
          location: "",
          bullets: fact.detail
            ? [{ id: `${id}.b1`, text: fact.detail, original: fact.detail }]
            : [],
          own: fact.detail ? [fact.detail] : [],
          dropped: false,
          nextBullet: fact.detail ? 1 : 0,
        });
        const kw = keywordFor(edit, "", `${fact.text} ${fact.detail}`);
        changes.push({
          what: `Added ${quote(fact.text)} to ${section.title || "your resume"}`,
          why: because(fromFact(fact), askedFor(kw)),
        });
        break;
      }

      case "add_list_value": {
        if (found?.kind !== "list") {
          drop(edit, "no such list line");
          break;
        }
        const { list, section } = found;
        const value = stripBold(edit.text.trim());
        if (!value || value.length > 120 || list.values.length >= 60) {
          drop(edit, "empty, too long, or the line is full");
          break;
        }
        if (
          list.values.some(
            (v) => containsPhrase(v, value) && containsPhrase(value, v),
          )
        ) {
          drop(edit, "already there");
          break;
        }
        if (!lines.some((line) => containsPhrase(line, value))) {
          drop(edit, `${quote(value)} isn't on your resume or in your facts`);
          break;
        }
        list.values.push(value);
        const source =
          facts.find((f) => containsPhrase(`${f.text} ${f.detail}`, value)) &&
          !corpusLines(master, []).some((line) => containsPhrase(line, value))
            ? "from your profile facts"
            : "it's already elsewhere on your resume";
        const kw = keywordFor(edit, "", value);
        changes.push({
          what: `Added ${quote(value)} to ${list.label || section.title || "a list"}`,
          why: because(askedFor(kw), source),
        });
        break;
      }

      case "drop_list_value": {
        if (found?.kind !== "list") {
          drop(edit, "no such list line");
          break;
        }
        const { list, section } = found;
        const value = stripBold(edit.text.trim());
        const index = list.values.findIndex(
          (v) => stripBold(v).trim().toLowerCase() === value.toLowerCase(),
        );
        if (index === -1) {
          drop(edit, "no such value");
          break;
        }
        list.values.splice(index, 1);
        changes.push({
          what: `Left out ${quote(value)} from ${list.label || section.title || "a list"}`,
          why:
            input.dropReason ?? "to make room for what this posting asks for",
        });
        break;
      }

      case "order_list_values": {
        if (found?.kind !== "list") {
          drop(edit, "no such list line");
          break;
        }
        const { list, section } = found;
        const next = reorder(
          list.values,
          (v) => stripBold(v).trim().toLowerCase(),
          edit.order.map((v) => stripBold(v).trim().toLowerCase()),
        );
        if (next.every((v, i) => v === list.values[i])) {
          drop(edit, "no change");
          break;
        }
        list.values = next;
        changes.push({
          what: `Put ${list.label || section.title || "a list"} in a new order, starting with ${next
            .slice(0, 3)
            .map((v) => quote(v))
            .join(", ")}`,
          why: "what the posting asks for goes first",
        });
        break;
      }

      case "reword_text": {
        if (found?.kind !== "section" || found.section.layout !== "text") {
          drop(edit, "no such paragraph section");
          break;
        }
        const section = found.section;
        const text = carryBold(section.text, edit.text.trim());
        if (!stripBold(text) || text.length > 3000 || text === section.text) {
          drop(edit, "empty, too long, or no change");
          break;
        }
        // A summary speaks for the whole resume: anything on it may appear.
        const problem = lineProblem(section.original, text, null, evidence);
        if (problem) {
          drop(edit, problem);
          break;
        }
        const kw = keywordFor(edit, section.text, text);
        changes.push({
          what: `Reworded ${section.title ? quote(section.title) : "your summary"}${kw ? ` to mention ${quote(kw)}` : ""}`,
          why:
            askedFor(kw) ??
            "clearer for this posting, in words already on your resume",
          before: section.text,
          after: text,
        });
        section.text = text;
        break;
      }
    }
  }

  return {
    content: fromWorking(base.header, sections),
    changes,
    dropped,
  };
}
