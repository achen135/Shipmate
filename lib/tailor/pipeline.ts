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
 *
 * The PDF and the database write happen in the worker (worker/tailor.ts).
 * Pure apart from the provider and the measure, which the caller passes in,
 * so tests run it end to end with fakes.
 */

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
import { EDIT_SYSTEM, KEYWORDS_SYSTEM } from "./prompts";
import {
  type Keyword,
  MIN_KEYWORDS,
  MIN_POSTING_CHARS,
  extractedKeywordsSchema,
  hasKeyword,
  scoreText,
  verifyKeywords,
} from "./score";
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
  /** skills_gap and low_score (the M5 rules are added by the caller). */
  warnings: Warning[];
  usage: {
    provider: AiUsage["provider"] | null;
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
  keywords
    .slice(0, max)
    .map((k) => k.term)
    .join(", ") +
  (keywords.length > max ? `, and ${keywords.length - max} more` : "");

export async function tailor(
  input: TailorInput,
  deps: { provider: AiProvider; measure: Measure },
): Promise<TailorResult> {
  const { master, facts, posting } = input;
  const { provider, measure } = deps;
  const calls: { usage: AiUsage; tier: Tier }[] = [];
  const notes: string[] = [];
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
      warnings: [],
      dropped: [],
      blocked: [],
      ...partial,
      notes,
      usage: {
        provider: last?.provider ?? null,
        model: last?.model ?? null,
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
  const text = (posting.text ?? "").trim();
  if (text.length < MIN_POSTING_CHARS) {
    notes.push(NOTES.noText);
    return result({ content: master });
  }
  const postingBlock = `<posting>\nCompany: ${posting.company}\nTitle: ${posting.title}\n\n${text.slice(0, MAX_POSTING_CHARS)}\n</posting>`;

  // 2. Baseline score.
  const extracted = await provider.generateStructured({
    tier: "fast",
    system: KEYWORDS_SYSTEM,
    input: postingBlock,
    schema: extractedKeywordsSchema,
    name: "posting_keywords",
    maxOutputTokens: 8_000,
  });
  calls.push({ usage: extracted.usage, tier: "fast" });
  const keywords = verifyKeywords(extracted.data, `${posting.title}\n${text}`);
  if (keywords.length < MIN_KEYWORDS) {
    notes.push(NOTES.fewKeywords);
    return result({ content: master });
  }
  const masterText = resumeToText(master);
  const before = scoreText(keywords, masterText);

  // 4. Gap check against the fact bank.
  const factFor = (k: Keyword) =>
    facts.findIndex((f) => hasKeyword(`${f.text}\n${f.detail}`, k));
  const missing = before.missing.filter((k) => factFor(k) === -1);
  const keywordLines = keywords.map((k) => {
    const status = hasKeyword(masterText, k)
      ? "ON RESUME"
      : factFor(k) !== -1
        ? `IN FACTS ${factId(factFor(k))}`
        : "MISSING";
    const variants = k.variants.length
      ? ` (also: ${k.variants.join(", ")})`
      : "";
    return `- ${k.term}${variants} — ${k.importance}, ${k.kind.replace("_", " ")}: ${status}`;
  });

  // 3. Company context, 5. edit from the master.
  const company = input.research
    ? [
        input.research.summary,
        input.research.values.length
          ? `Values: ${input.research.values.join("; ")}`
          : "",
        input.research.tech.length
          ? `Technologies: ${input.research.tech.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n") || "(nothing found)"
    : "(nothing found)";
  const plan = await provider.generateStructured({
    tier: "strong",
    system: EDIT_SYSTEM,
    input: [
      postingBlock,
      `<keywords>\n${keywordLines.join("\n")}\n</keywords>`,
      `<company>\n${company}\n</company>`,
      `<resume>\n${describeResume(master)}\n</resume>`,
      `<facts>\n${describeFacts(facts)}\n</facts>`,
    ].join("\n\n"),
    schema: editPlanSchema,
    name: "resume_edits",
    maxOutputTokens: 12_000,
  });
  calls.push({ usage: plan.usage, tier: "strong" });

  let content = master;
  let changes: Change[] = [];
  const dropped: Dropped[] = [];
  try {
    const applied = applyEdits({
      base: master,
      master,
      facts,
      keywords,
      edits: plan.data.edits,
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
  const blocked = untraceable(master, facts, content, keywords);
  if (blocked.length > 0) {
    content = master;
    changes = [];
    notes.splice(0, notes.length, NOTES.blocked);
  } else if (changes.length === 0 && notes.length === 0) {
    notes.push(NOTES.nothing);
  }

  // 8. Re-score and report.
  const after = scoreText(keywords, resumeToText(content));
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

  return result({
    content,
    scoreBefore: before.score,
    scoreAfter: after.score,
    matched: after.matched.map((k) => k.term),
    missing: missing.map((k) => k.term),
    changes,
    warnings,
    dropped,
    blocked,
  });
}
