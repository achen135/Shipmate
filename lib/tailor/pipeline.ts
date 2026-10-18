/**
 * The tailoring pipeline for one (user, posting): Spec "Tailoring pipeline",
 * the Resume Fitting Guide in order.
 *
 *   1. posting text (fetched by the caller; too little → a note, no score)
 *   2. baseline score: keywords from the posting (fast tier), checked
 *      against its text, then matched against the master resume in code
 *   3. company research (cached by the caller; context only)
 *   4. gap: each missing keyword is in the fact bank (usable) or not (a
 *      "missing skill", never added)
 *   5. edit, always from the master resume, never an earlier tailored copy:
 *      the model proposes operations, edits.ts applies and checks them
 *   6. one page: measure, cut (drops only), at most twice
 *   7. the whole-copy check (trace.ts); anything untraceable → the master
 *      ships unchanged
 *   8. re-score, report (changes, warnings, notes) and usage
 *   9. a second look (second-look.ts): one read-only call on the finished
 *      copy, whose notes are shown to the user and never applied. Skipped
 *      when nothing changed (step 1's too-little-text exit skips it too)
 *
 * The PDF and the database write happen in the worker (worker/tailor.ts).
 * Pure apart from the provider and the measure, which the caller passes in,
 * so tests run it end to end with fakes.
 */

import { z } from "zod";

import { callCostUsd } from "@/lib/ai/models";
import type { AiProvider, AiUsage, Tier } from "@/lib/ai/types";
import { type ResumeContent, resumeToText } from "@/lib/resume/structured";
import type { Fact } from "@/lib/schemas/fact-bank";
import type { Warning } from "@/lib/review/warnings";

import {
  type Change,
  type Dropped,
  StructureChangeError,
  applyEdits,
  editPlanSchema,
} from "./edits";
import { type Measure, STILL_LONG_NOTE, fitOnePage } from "./fit";
import { EDIT_SYSTEM, KEYWORDS_SYSTEM, SCORE_AND_EDIT_SYSTEM } from "./prompts";
import {
  type Keyword,
  MIN_KEYWORDS,
  MIN_POSTING_CHARS,
  type ExtractedKeywords,
  extractedKeywordsSchema,
  hasKeyword,
  keywordLabel,
  scoreText,
  verifyKeywords,
} from "./score";
import { type Suggestion, secondLook } from "./second-look";
import { untraceable } from "./trace";
import { describeFacts, describeResume, factId } from "./view";

export type CompanyContext = {
  summary: string;
  values: string[];
  tech: string[];
};

export type TailorInput = {
  master: ResumeContent;
  facts: Fact[];
  posting: { title: string; company: string; text: string | null };
  research: CompanyContext | null;
};

export type TailorResult = {
  content: ResumeContent;
  scoreBefore: number | null;
  scoreAfter: number | null;
  matched: string[];
  missing: string[];
  changes: Change[];
  notes: string[];
  /** Step 9's notes: what a second read noticed, never applied. */
  suggestions: Suggestion[];
  /** For the worker's log: whether step 9 ran. */
  secondLook: "done" | "skipped" | "failed";
  /** skills_gap and low_score (the M5 rules are added by the caller). */
  warnings: Warning[];
  usage: {
    provider: AiUsage["provider"] | null;
    /**
     * The model the edit step ran on, null if it never ran. Not simply the
     * last call's: on Gemini the second look runs on Flash-Lite, which is
     * also the shared key's backup, and the review page reads this to say a
     * tailoring ran on the backup.
     */
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  /** For the worker's log only: what the checks threw away, and why. */
  dropped: Dropped[];
  /** Non-empty only if the final check failed (a bug: see trace.ts). */
  blocked: string[];
};

/** Posting text sent to the model: plenty for any real posting. */
const MAX_POSTING_CHARS = 15_000;

/**
 * The posting as the model reads it (inside a <posting> tag the caller
 * writes), or null when there's too little text to tailor against.
 */
export function postingBody(posting: TailorInput["posting"]): string | null {
  const text = (posting.text ?? "").trim();
  if (text.length < MIN_POSTING_CHARS) return null;
  return `Company: ${posting.company}\nTitle: ${posting.title}\n\n${text.slice(0, MAX_POSTING_CHARS)}`;
}

/** What the company's own pages say, as the model reads it (<company>). */
export function companyBody(research: CompanyContext | null): string {
  if (!research) return "(nothing found)";
  return (
    [
      research.summary,
      research.values.length ? `Values: ${research.values.join("; ")}` : "",
      research.tech.length ? `Technologies: ${research.tech.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n") || "(nothing found)"
  );
}

/**
 * Each verified keyword marked ON RESUME, IN FACTS (with the fact's id) or
 * MISSING: the edit step's <keywords>. Matched on the resume's own spelling
 * only, never the model's variants (§0a).
 */
export function keywordLines(
  keywords: Keyword[],
  master: ResumeContent,
  facts: Fact[],
): string[] {
  const masterText = resumeToText(master);
  return keywords.map((k) => {
    const fact = factFor(facts, k);
    const status = hasKeyword(masterText, k)
      ? "ON RESUME"
      : fact !== -1
        ? `IN FACTS ${factId(fact)}`
        : "MISSING";
    // An "or" list: "Bachelor's or Master's or PhD", any one of them counts.
    return `- ${keywordLabel(k)} — ${k.importance}, ${k.kind.replace("_", " ")}: ${status}`;
  });
}

/**
 * Step 2's request: one posting's keywords, on the strong tier. On Gemini,
 * Flash-Lite's keyword lists didn't hold up (Design Decisions "Which Gemini
 * model runs which step"), and asking for several postings' at once listed
 * fewer of each (M9 §0), so it's always one posting per request.
 */
export function askKeywords(provider: AiProvider, body: string) {
  return provider.generateStructured({
    tier: "strong",
    system: KEYWORDS_SYSTEM,
    input: `<posting>\n${body}\n</posting>`,
    schema: extractedKeywordsSchema,
    name: "posting_keywords",
    maxOutputTokens: 8_000,
  });
}

/** The first fact that writes this keyword, or -1. */
const factFor = (facts: Fact[], k: Keyword) =>
  facts.findIndex((f) => hasKeyword(`${f.text}\n${f.detail}`, k));
/** Below this after tailoring, the report says it's not a strong match. */
export const LOW_SCORE = 50;

export const NOTES = {
  noText:
    "This posting doesn't include enough text to score or tailor against, so your master resume is used as it is.",
  fewKeywords:
    "Shipmate couldn't find enough skills or requirements in this posting to score against, so your master resume is used as it is.",
  structure:
    "Shipmate's AI suggested changing your resume's sections, which Shipmate never does, so none of its edits were used.",
  blocked:
    "Shipmate's final check found something in the tailored copy it couldn't trace to your resume or your facts, so your master resume is used instead.",
  nothing:
    "No changes: your resume already covers what this posting asks for as well as your own resume and facts allow.",
} as const;

const list = (keywords: Keyword[], max = 5) =>
  keywords.slice(0, max).map(keywordLabel).join(", ") +
  (keywords.length > max ? `, and ${keywords.length - max} more` : "");

/**
 * Keyword scoring and the edit in one answer (SCORE_AND_EDIT_SYSTEM): the
 * two schemas side by side, each checked by the same code as when they come
 * from separate calls.
 */
export const scoreAndEditSchema = z.object({
  keywords: extractedKeywordsSchema.shape.keywords,
  edits: editPlanSchema.shape.edits,
});

export type TailorDeps = {
  provider: AiProvider;
  measure: Measure;
  /**
   * Ask for the keywords and the edits in one strong-tier call instead of
   * two (Fix Handoff "merge scoring+edit", built to be measured). Off unless
   * a caller asks: nothing in the app does yet. Every check is the same
   * either way: verifyKeywords on the keywords, applyEdits on the edits.
   */
  mergeScoreAndEdit?: boolean;
};

export async function tailor(
  input: TailorInput,
  deps: TailorDeps,
): Promise<TailorResult> {
  const { master, facts, posting } = input;
  const { provider, measure } = deps;
  const calls: { usage: AiUsage; tier: Tier }[] = [];
  const notes: string[] = [];
  /** The edit step's model, once it has run (see TailorResult.usage.model). */
  let editModel: string | null = null;
  const result = (
    partial: Partial<TailorResult> & { content: ResumeContent },
  ): TailorResult => {
    const last = calls.at(-1)?.usage;
    return {
      scoreBefore: null,
      scoreAfter: null,
      matched: [],
      missing: [],
      changes: [],
      suggestions: [],
      secondLook: "skipped",
      warnings: [],
      dropped: [],
      blocked: [],
      ...partial,
      notes,
      usage: {
        provider: last?.provider ?? null,
        model: editModel,
        inputTokens: calls.reduce((n, c) => n + c.usage.inputTokens, 0),
        outputTokens: calls.reduce((n, c) => n + c.usage.outputTokens, 0),
        costUsd: calls.reduce(
          (n, c) => n + callCostUsd(c.usage, c.tier, provider.shared),
          0,
        ),
      },
    };
  };

  // 1. Posting text.
  const body = postingBody(posting);
  if (body === null) {
    notes.push(NOTES.noText);
    return result({ content: master });
  }
  const text = (posting.text ?? "").trim();
  const postingBlock = `<posting>\n${body}\n</posting>`;

  // 3. Company context.
  const contextBlocks = [
    `<company>\n${companyBody(input.research)}\n</company>`,
    `<resume>\n${describeResume(master)}\n</resume>`,
    `<facts>\n${describeFacts(facts)}\n</facts>`,
  ];

  // 2. Baseline score. On the strong tier, not the fast one: on Gemini,
  // Flash-Lite's keyword lists didn't hold up (Design Decisions "Which
  // Gemini model runs which step"). Merged: the edits come back in the
  // same answer, and wait below for the same checks.
  let extracted: ExtractedKeywords;
  let mergedEdits: unknown[] | null = null;
  if (deps.mergeScoreAndEdit) {
    const both = await provider.generateStructured({
      tier: "strong",
      system: SCORE_AND_EDIT_SYSTEM,
      input: [postingBlock, ...contextBlocks].join("\n\n"),
      schema: scoreAndEditSchema,
      name: "keywords_and_edits",
      maxOutputTokens: 20_000,
    });
    calls.push({ usage: both.usage, tier: "strong" });
    editModel = both.usage.model;
    extracted = { keywords: both.data.keywords };
    mergedEdits = both.data.edits;
  } else {
    const answer = await askKeywords(provider, body);
    calls.push({ usage: answer.usage, tier: "strong" });
    extracted = answer.data;
  }
  const keywords = verifyKeywords(extracted, `${posting.title}\n${text}`);
  if (keywords.length < MIN_KEYWORDS) {
    notes.push(NOTES.fewKeywords);
    return result({ content: master });
  }
  const masterText = resumeToText(master);
  const before = scoreText(keywords, masterText);

  // 4. Gap check against the fact bank.
  const missing = before.missing.filter((k) => factFor(facts, k) === -1);

  // 5. Edit from the master (two-call flow: told each keyword's status).
  let edits = mergedEdits;
  if (edits === null) {
    const plan = await provider.generateStructured({
      tier: "strong",
      system: EDIT_SYSTEM,
      input: [
        postingBlock,
        `<keywords>\n${keywordLines(keywords, master, facts).join("\n")}\n</keywords>`,
        ...contextBlocks,
      ].join("\n\n"),
      schema: editPlanSchema,
      name: "resume_edits",
      maxOutputTokens: 12_000,
    });
    calls.push({ usage: plan.usage, tier: "strong" });
    editModel = plan.usage.model;
    edits = plan.data.edits;
  }

  let content = master;
  let changes: Change[] = [];
  const dropped: Dropped[] = [];
  try {
    const applied = applyEdits({
      base: master,
      master,
      facts,
      keywords,
      edits,
    });
    content = applied.content;
    changes = applied.changes;
    dropped.push(...applied.dropped);
  } catch (error) {
    if (!(error instanceof StructureChangeError)) throw error;
    notes.push(NOTES.structure);
    dropped.push({ op: "*", target: "", reason: error.message });
  }

  // 6. One page.
  const fit = await fitOnePage({
    provider,
    measure,
    content,
    master,
    facts,
    keywords,
  });
  for (const usage of fit.usages) calls.push({ usage, tier: "strong" });
  content = fit.content;
  changes = [...changes, ...fit.changes];
  dropped.push(...fit.dropped);
  if (fit.pages > 1) notes.push(STILL_LONG_NOTE);

  // 7. The whole-copy check.
  const blocked = untraceable(master, facts, content);
  if (blocked.length > 0) {
    content = master;
    changes = [];
    notes.splice(0, notes.length, NOTES.blocked);
  } else if (changes.length === 0 && notes.length === 0) {
    notes.push(NOTES.nothing);
  }

  // 8. Re-score and report.
  const finalText = resumeToText(content);
  const after = scoreText(keywords, finalText);
  const warnings: Warning[] = [];
  if (missing.length > 0) {
    warnings.push({
      kind: "skills_gap",
      message: `The posting asks for ${list(missing)}, which isn't on your resume or in your profile facts. Shipmate didn't add ${missing.length === 1 ? "it" : "them"}. If you have ${missing.length === 1 ? "it" : "any of them"}, add ${missing.length === 1 ? "it" : "them"} to your profile facts.`,
    });
  }
  if (after.score < LOW_SCORE) {
    const requiredMissing = after.missing.filter(
      (k) => k.importance === "required",
    );
    warnings.push({
      kind: "low_score",
      message: `This doesn't look like a strong match: your resume has ${after.score}% of what the posting asks for${requiredMissing.length ? `, and not ${list(requiredMissing, 3)}` : ""}. Shipmate still made the best version it could.`,
    });
  }

  // 9. A second look at the finished copy. It gets plain text and returns
  // notes; `content` is final above this line and nothing below edits it.
  // On the resume in its own spelling only, as everywhere (M8 §0a).
  let suggestions: Suggestion[] = [];
  let looked: TailorResult["secondLook"] = "skipped";
  if (changes.length > 0) {
    const look = await secondLook(provider, {
      postingBlock,
      keywordLines: keywords.map(
        (k) =>
          `- ${keywordLabel(k)} — ${k.importance}: ${hasKeyword(finalText, k) ? "ON RESUME" : "MISSING"}`,
      ),
      resumeText: finalText,
    });
    looked = look.status;
    if (look.status === "done") {
      suggestions = look.suggestions;
      calls.push({ usage: look.usage, tier: "fast" });
    }
  }

  return result({
    content,
    suggestions,
    secondLook: looked,
    scoreBefore: before.score,
    scoreAfter: after.score,
    matched: after.matched.map(keywordLabel),
    missing: missing.map(keywordLabel),
    changes,
    warnings,
    dropped,
    blocked,
  });
}
