/**
 * Tailoring several postings for one person with fewer strong-tier requests
 * than two per posting (M9 §0, Mass Apply). The shared Gemini key's limit is
 * requests a day (Flash: 20), not tokens, so asking once for a batch is what
 * lets a sit-down session tailor more than a handful.
 *
 * Built to be measured before anything uses it: nothing in the app or the
 * worker calls this yet.
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
 * all is left for a one-posting tailoring ("alone"), never guessed at. One
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
 * The real provider, except that the two strong steps of one posting are
 * answered from the batch. The edit step's answer is given only if the
 * pipeline marked that posting's keywords exactly as the batch request did:
 * otherwise the edits were made against something else, and that's a bug.
 */
function answeredFromBatch(
  provider: AiProvider,
  answers: {
    keywords: ExtractedKeywords;
    edits: { lines: string[]; edits: unknown[]; model: string } | null;
    keywordModel: string;
  },
): AiProvider {
  const replay = <T>(data: T, model: string) => ({
    data,
    usage: { provider: provider.name, model, inputTokens: 0, outputTokens: 0 },
  });
  return {
    name: provider.name,
    shared: provider.shared,
    backup: provider.backup,
    testKey: () => provider.testKey(),
    async generateStructured(request) {
      if (request.name === "posting_keywords") {
        return replay(
          request.schema.parse(answers.keywords),
          answers.keywordModel,
        );
      }
      if (request.name === "resume_edits") {
        const sent = /<keywords>\n([\s\S]*?)\n<\/keywords>/.exec(
          request.input,
        )?.[1];
        if (!answers.edits || sent !== answers.edits.lines.join("\n")) {
          throw new Error(
            "batch: the edit step's keywords aren't the ones the batch was asked about",
          );
        }
        return replay(
          request.schema.parse({ edits: answers.edits.edits }),
          answers.edits.model,
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
  const keywordsFor = new Map<string, ExtractedKeywords>();
  const keywordModel = new Map<string, string>();
  if (deps.keywords !== "batch") {
    for (const p of scored) {
      const answer = await askKeywords(provider, p.body!);
      usage.push(answer.usage);
      keywordsFor.set(p.key, answer.data);
      keywordModel.set(p.key, answer.usage.model);
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
      keywordsFor.set(key, { keywords: item.keywords });
      keywordModel.set(key, answer.usage.model);
    }
  }

  // 2. Edits, one request, for the postings the one-posting pipeline would
  // edit: keywords that pass the same checks, enough of them.
  const linesFor = new Map<string, string[]>();
  for (const p of scored) {
    const extracted = keywordsFor.get(p.key);
    if (!extracted) continue;
    const text = (p.posting.text ?? "").trim();
    const keywords = verifyKeywords(extracted, `${p.posting.title}\n${text}`);
    if (keywords.length >= MIN_KEYWORDS) {
      linesFor.set(p.key, keywordLines(keywords, master, facts));
    }
  }
  const editsFor = new Map<string, unknown[]>();
  let editModel = "";
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
    editModel = answer.usage.model;
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
    if (lines && !edits) {
      outcomes.push({
        id: p.id,
        status: "alone",
        reason: "not answered in the edit request",
      });
      continue;
    }
    const result = await tailor(tailorInput, {
      provider: answeredFromBatch(provider, {
        keywords,
        keywordModel: keywordModel.get(p.key)!,
        edits: lines && edits ? { lines, edits, model: editModel } : null,
      }),
      measure,
    });
    outcomes.push({ id: p.id, status: "done", result });
  }

  return { outcomes, usage, problems };
}
