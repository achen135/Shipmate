/**
 * The AI-mode fit score (Spec "Tailoring pipeline" steps 1 and 6), the
 * resume-ats-optimizer skill's method: extract the posting's keywords, then
 * Match Score = keywords matched / keywords wanted × 100.
 *
 * The model only extracts (fast tier): the terms, how much they matter, and
 * the other spellings an ATS would accept. Code keeps a keyword only if the
 * posting really says it (no invented requirements), then does the matching
 * itself, so the before and after scores are measured the same way, are
 * repeatable, and the "after" costs nothing.
 *
 * Weighting: a required keyword counts twice, a preferred one once.
 */

import { z } from "zod";

import { containsPhrase } from "./text";

export const KEYWORD_KINDS = [
  "hard_skill",
  "tool",
  "soft_skill",
  "industry",
  "qualification",
] as const;

export const extractedKeywordsSchema = z.object({
  keywords: z.array(
    z.object({
      term: z.string(),
      importance: z.enum(["required", "preferred"]),
      kind: z.enum(KEYWORD_KINDS),
      /** Other spellings an ATS would match: "JS" for "JavaScript". */
      variants: z.array(z.string()),
    }),
  ),
});
export type ExtractedKeywords = z.infer<typeof extractedKeywordsSchema>;

export type Keyword = {
  term: string;
  importance: "required" | "preferred";
  kind: (typeof KEYWORD_KINDS)[number];
  variants: string[];
};

/** Fewer keywords than this and a score would mean nothing. */
export const MIN_KEYWORDS = 4;
/** Shorter posting text than this isn't enough to score (characters). */
export const MIN_POSTING_CHARS = 400;
const MAX_KEYWORDS = 30;

/**
 * Keep the keywords the posting actually contains (as a phrase, in the
 * term or one of its variants), cleaned and deduplicated.
 */
export function verifyKeywords(
  extracted: ExtractedKeywords,
  postingText: string,
): Keyword[] {
  const seen: Keyword[] = [];
  for (const k of extracted.keywords) {
    const term = k.term.trim().slice(0, 80);
    if (!term) continue;
    const variants = [
      ...new Set(
        k.variants
          .map((v) => v.trim().slice(0, 80))
          .filter((v) => v && !containsPhrase(term, v)),
      ),
    ].slice(0, 5);
    const spellings = [term, ...variants];
    if (!spellings.some((s) => containsPhrase(postingText, s))) continue;
    const duplicate = seen.find((s) =>
      [s.term, ...s.variants].some((x) =>
        spellings.some((y) => containsPhrase(x, y) && containsPhrase(y, x)),
      ),
    );
    if (duplicate) {
      if (k.importance === "required") duplicate.importance = "required";
      continue;
    }
    seen.push({ term, importance: k.importance, kind: k.kind, variants });
    if (seen.length >= MAX_KEYWORDS) break;
  }
  return seen;
}

export const hasKeyword = (text: string, keyword: Keyword) =>
  [keyword.term, ...keyword.variants].some((s) => containsPhrase(text, s));

export type Score = { score: number; matched: Keyword[]; missing: Keyword[] };

export function scoreText(keywords: Keyword[], text: string): Score {
  let total = 0;
  let hit = 0;
  const matched: Keyword[] = [];
  const missing: Keyword[] = [];
  for (const keyword of keywords) {
    const weight = keyword.importance === "required" ? 2 : 1;
    total += weight;
    if (hasKeyword(text, keyword)) {
      hit += weight;
      matched.push(keyword);
    } else {
      missing.push(keyword);
    }
  }
  return {
    score: total === 0 ? 0 : Math.round((hit / total) * 100),
    matched,
    missing,
  };
}
