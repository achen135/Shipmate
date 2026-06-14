/**
 * Tailoring several postings for one person with fewer strong-tier requests
 * than two per posting (M9 §0, Mass Apply). The shared Gemini key's limit is
 * requests a day (Flash: 20), not tokens, so asking once for a batch is what
 * lets a sit-down session tailor more than a handful.
 *
 * Measured before use (M9 §0, Design Decisions "Mass apply": measured and
 * decided): keywords one request per posting, the edit step batched, on
 * Gemini only, at most BATCH_SIZE postings per batch.
 *
 *   1. keywords: by default one request per posting, exactly the
 *      one-posting step (pipeline.ts askKeywords), because one request for
 *      the whole batch (BATCH_KEYWORDS_SYSTEM, `keywords: "batch"`) listed
 *      fewer keywords per posting than asking for each (M9 §0)
 *   2. edits: one request (BATCH_EDIT_SYSTEM) with the resume and facts once
 *      and, per posting, its <posting>, <keywords> (marked exactly as the
 *      one-posting edit step marks them) and <company>; one item back per id
 *   3. each posting through the one-posting pipeline (pipeline.ts tailor()),
 *      its two strong steps answered from the batch and everything else as
 *      usual. So every check is the same code as for one posting:
 *      verifyKeywords against that posting's own text, applyEdits, the one
 *      page, untraceable, the re-score, the second look.
 *
 * Attribution is by the id the model echoes, nothing else: an answer for an
 * id that wasn't asked about is ignored, and an id answered twice or not at
 * all is never guessed at: that posting's edit step is asked alone, with the
 * keywords already in hand (with `keywords: "batch"`, a posting the keyword
 * answer leaves out comes back "alone" for the caller). Each posting's
 * result carries its own keyword request's tokens and an even share of the
 * edit request's, so a tailoring's cost adds up. One
 * person per batch, always: the resume and facts are the same for every
 * posting, so a mixed-up answer can't put someone else's words on a resume,
 * and the checks still hold every item to that person's own words.
 */

import { z } from "zod";

import type { AiProvider, AiUsage } from "@/lib/ai/types";
import type { ResumeContent } from "@/lib/resume/structured";
import type { Fact } from "@/lib/schemas/fact-bank";

import { editPlanSchema } from "./edits";
import {
  type CompanyContext,
  type TailorDeps,
  type TailorInput,
  type TailorResult,
  askKeywords,
  companyBody,
  keywordLines,
  postingBody,
  tailor,
} from "./pipeline";
import { BATCH_EDIT_SYSTEM, BATCH_KEYWORDS_SYSTEM } from "./prompts";
import {
  type ExtractedKeywords,
  MIN_KEYWORDS,
  extractedKeywordsSchema,
  verifyKeywords,
} from "./score";
import { describeFacts, describeResume } from "./view";

export const batchKeywordsSchema = z.object({
  postings: z.array(
    z.object({
      id: z.string(),
      keywords: extractedKeywordsSchema.shape.keywords,
    }),
  ),
});

export const batchEditsSchema = z.object({
  postings: z.array(
    z.object({ id: z.string(), edits: editPlanSchema.shape.edits }),
  ),
});

/**
 * Gemini 3.8 Flash's own output ceiling, thinking included (models.get,
 * 2026-10-18). A batch is limited by where its answer gets cut off, so it
 * asks for all of it; how many postings fit is measured, not assumed.
 */
export const BATCH_MAX_OUTPUT_TOKENS = 65_536;

/**
 * At most this many postings per batched edit request. Measured with the
 * shipped prompt: it held its per-posting edits at 17 (4.0 each) and had
 * halved by 37 (2.0). On the shared key a day's 20 Flash requests cover at
 * most 19 postings anyway (one keyword request each, plus the edit one).
 */
export const BATCH_SIZE = 17;

export type BatchPosting = {
  /** The caller's id (a tailoring row, a posting): only used to report back. */
  id: string;
  posting: TailorInput["posting"];
  research: CompanyContext | null;
};

export type BatchInput = {
  master: ResumeContent;
  facts: Fact[];
  postings: BatchPosting[];
};

export type BatchOutcome =
  | { id: string; status: "done"; result: TailorResult }
  /** Not answered (cleanly) in the batch: tailor it on its own instead. */
  | { id: string; status: "alone"; reason: string };

export type BatchRun = {
  /** One per posting, in the order given. */
  outcomes: BatchOutcome[];
  /** The batch requests (keywords, then edits), for the log and the quota. */
  usage: AiUsage[];
  /** What attribution found wrong with the answers, for the log. */
  problems: string[];
};

/** The ids the model sees and echoes: p1, p2, … in the order given. */
export const batchKey = (index: number) => `p${index + 1}`;

/**
 * Each answer matched to the posting it names. Unknown ids are ignored; an
 * id answered more than once is matched to nothing (there's no telling which
 * copy is right), and so is one not answered.
 */
export function attribute<T extends { id: string }>(
  ids: string[],
  answers: T[],
): { byId: Map<string, T>; problems: string[] } {
  const count = new Map<string, number>();
  for (const answer of answers) {
    const id = answer.id.trim();
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  const byId = new Map<string, T>();
  const problems: string[] = [];
  for (const id of count.keys()) {
    if (!ids.includes(id))
      problems.push(`an answer for unknown posting "${id}"`);
  }
  for (const answer of answers) {
    const id = answer.id.trim();
    if (ids.includes(id) && count.get(id) === 1) byId.set(id, answer);
  }
  for (const id of ids) {
    const n = count.get(id) ?? 0;
    if (n === 0) problems.push(`posting ${id} not answered`);
    if (n > 1) problems.push(`posting ${id} answered ${n} times`);
  }
  return { byId, problems };
}

/**
 * The index-th of `ways` even shares of one request's tokens (the first
 * takes what doesn't divide evenly), so the shares add up to the request.
 */
function share(usage: AiUsage, ways: number, index: number): AiUsage {
  const part = (n: number) =>
    Math.floor(n / ways) + (index === 0 ? n % ways : 0);
  return {
    ...usage,
    inputTokens: part(usage.inputTokens),
    outputTokens: part(usage.outputTokens),
  };
}

/**
 * The real provider, except that the two strong steps of one posting are
 * answered from the batch, each with its share of what the batch's requests
 * used. The edit step's answer is given only if the pipeline marked that
 * posting's keywords exactly as the batch request did: otherwise the edits
 * were made against something else, and that's a bug. "ask": the batch's
 * edit answer left this posting out, so its edit step is asked alone.
 */
function answeredFromBatch(
  provider: AiProvider,
  answers: {
    keywords: { data: ExtractedKeywords; usage: AiUsage };
    edits: { lines: string[]; edits: unknown[]; usage: AiUsage } | "ask" | null;
  },
): AiProvider {
  const replay = <T>(data: T, usage: AiUsage) => ({ data, usage });
  return {
    name: provider.name,
    shared: provider.shared,
    backup: provider.backup,
    testKey: () => provider.testKey(),
    async generateStructured(request) {
      if (request.name === "posting_keywords") {
        return replay(
          request.schema.parse(answers.keywords.data),
          answers.keywords.usage,
        );
      }
      if (request.name === "resume_edits") {
        const edits = answers.edits;
        if (edits === "ask") return provider.generateStructured(request);
        const sent = /<keywords>\n([\s\S]*?)\n<\/keywords>/.exec(
          request.input,
        )?.[1];
        if (!edits || sent !== edits.lines.join("\n")) {
          throw new Error(
            "batch: the edit step's keywords aren't the ones the batch was asked about",
          );
        }
        return replay(
          request.schema.parse({ edits: edits.edits }),
          edits.usage,
        );
      }
      return provider.generateStructured(request);
    },
  };
}

export async function tailorBatch(
  input: BatchInput,
  deps: Pick<TailorDeps, "provider" | "measure"> & {
    maxOutputTokens?: number;
    /** "each" (default): a keyword request per posting; "batch": one in all. */
    keywords?: "each" | "batch";
  },
): Promise<BatchRun> {
  const { master, facts } = input;
  const { provider, measure } = deps;
  const maxOutputTokens = deps.maxOutputTokens ?? BATCH_MAX_OUTPUT_TOKENS;
  const usage: AiUsage[] = [];
  const problems: string[] = [];

  const items = input.postings.map((p, i) => ({
    ...p,
    key: batchKey(i),
    body: postingBody(p.posting),
  }));
  // Too little text: the pipeline stops before any request, as for one.
  const scored = items.filter((p) => p.body !== null);

  // 1. Keywords.
  const keywordsFor = new Map<
    string,
    { data: ExtractedKeywords; usage: AiUsage }
  >();
  if (deps.keywords !== "batch") {
    for (const p of scored) {
      const answer = await askKeywords(provider, p.body!);
      usage.push(answer.usage);
      keywordsFor.set(p.key, answer);
    }
  } else if (scored.length > 0) {
    const answer = await provider.generateStructured({
      tier: "strong",
      system: BATCH_KEYWORDS_SYSTEM,
      input: scored
        .map((p) => `<posting id="${p.key}">\n${p.body}\n</posting>`)
        .join("\n\n"),
      schema: batchKeywordsSchema,
      name: "batch_posting_keywords",
      maxOutputTokens,
    });
    usage.push(answer.usage);
    const found = attribute(
      scored.map((p) => p.key),
      answer.data.postings,
    );
    problems.push(...found.problems);
    for (const [key, item] of found.byId) {
      keywordsFor.set(key, {
        data: { keywords: item.keywords },
        usage: share(
          answer.usage,
          scored.length,
          scored.findIndex((p) => p.key === key),
        ),
      });
    }
  }

  // 2. Edits, one request, for the postings the one-posting pipeline would
  // edit: keywords that pass the same checks, enough of them.
  const linesFor = new Map<string, string[]>();
  for (const p of scored) {
    const extracted = keywordsFor.get(p.key)?.data;
    if (!extracted) continue;
    const text = (p.posting.text ?? "").trim();
    const keywords = verifyKeywords(extracted, `${p.posting.title}\n${text}`);
    if (keywords.length >= MIN_KEYWORDS) {
      linesFor.set(p.key, keywordLines(keywords, master, facts));
    }
  }
  const editsFor = new Map<string, unknown[]>();
  let editAnswer: AiUsage | null = null;
  const toEdit = scored.filter((p) => linesFor.has(p.key));
  if (toEdit.length > 0) {
    const answer = await provider.generateStructured({
      tier: "strong",
      system: BATCH_EDIT_SYSTEM,
      input: [
        `<resume>\n${describeResume(master)}\n</resume>`,
        `<facts>\n${describeFacts(facts)}\n</facts>`,
        ...toEdit.map((p) =>
          [
            `<posting id="${p.key}">\n${p.body}\n</posting>`,
            `<keywords id="${p.key}">\n${linesFor.get(p.key)!.join("\n")}\n</keywords>`,
            `<company id="${p.key}">\n${companyBody(p.research)}\n</company>`,
          ].join("\n\n"),
        ),
      ].join("\n\n"),
      schema: batchEditsSchema,
      name: "batch_resume_edits",
      maxOutputTokens,
    });
    usage.push(answer.usage);
    editAnswer = answer.usage;
    const found = attribute(
      toEdit.map((p) => p.key),
      answer.data.postings,
    );
    problems.push(...found.problems);
    for (const [key, item] of found.byId) editsFor.set(key, item.edits);
  }

  // 3. Each posting through the one-posting pipeline.
  const outcomes: BatchOutcome[] = [];
  for (const p of items) {
    const tailorInput = {
      master,
      facts,
      posting: p.posting,
      research: p.research,
    };
    if (p.body === null) {
      // No request: the pipeline returns the "not enough text" note.
      outcomes.push({
        id: p.id,
        status: "done",
        result: await tailor(tailorInput, { provider, measure }),
      });
      continue;
    }
    const keywords = keywordsFor.get(p.key);
    if (!keywords) {
      outcomes.push({
        id: p.id,
        status: "alone",
        reason: "not answered in the keyword request",
      });
      continue;
    }
    const lines = linesFor.get(p.key);
    const edits = editsFor.get(p.key);
    // Left out of (or answered twice in) the edit answer: its edit step is
    // asked alone, with the keywords already in hand.
    const result = await tailor(tailorInput, {
      provider: answeredFromBatch(provider, {
        keywords,
        edits:
          lines && edits && editAnswer
            ? {
                lines,
                edits,
                usage: share(
                  editAnswer,
                  toEdit.length,
                  toEdit.findIndex((t) => t.key === p.key),
                ),
              }
            : lines
              ? "ask"
              : null,
      }),
      measure,
    });
    outcomes.push({ id: p.id, status: "done", result });
  }

  return { outcomes, usage, problems };
}
