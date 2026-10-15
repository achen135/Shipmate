/**
 * The AI-mode fit score (Spec "Tailoring pipeline" steps 1 and 6), the
 * resume-ats-optimizer skill's method: extract the posting's keywords, then
 * Match Score = keywords matched / keywords wanted × 100.
 *
 * The model only extracts (fast tier): the terms, how much they matter, and
 * the other spellings it thinks an ATS would accept. Code keeps a keyword
 * only if the posting really says it (no invented requirements), then does
 * the matching itself, so the before and after scores are measured the same
 * way, are repeatable, and the "after" costs nothing.
 *
 * The model's `variants` never widen a match (M8 §0a): they're its own
 * claim that two spellings are one skill, and nothing checks that ("C" is
 * not "C++"). A keyword matches only in its own spelling, with text.ts's
 * mechanical folding (plurals, verb endings, possessives). Variants are
 * kept only where they make the edit checks stricter (edits.ts claim
 * words). A hand-made synonym table would be the way back, for scoring and
 * editing alike.
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
  /** The model's other spellings: never used to match (see above). */
  variants: string[];
};

/** Fewer keywords than this and a score would mean nothing. */
export const MIN_KEYWORDS = 4;
/** Shorter posting text than this isn't enough to score (characters). */
export const MIN_POSTING_CHARS = 400;
const MAX_KEYWORDS = 30;

/**
 * Keep the keywords the posting actually contains, in the posting's own
 * spelling: the model's term if the posting writes it, else the first of
 * its variants that the posting writes (never a term the posting doesn't
 * say). Cleaned, and deduplicated by spelling only: two keywords the model
 * grouped stay two.
 */
export function verifyKeywords(
  extracted: ExtractedKeywords,
  postingText: string,
): Keyword[] {
  const seen: Keyword[] = [];
  for (const k of extracted.keywords) {
    const spellings = [
      ...new Set(
        [k.term, ...k.variants]
          .map((v) => v.trim().slice(0, 80))
          .filter(Boolean),
      ),
    ];
    const term = spellings.find((s) => containsPhrase(postingText, s));
    if (!term) continue;
    const variants = spellings
      .filter((v) => !containsPhrase(term, v) || !containsPhrase(v, term))
      .slice(0, 5);
    const duplicate = seen.find(
      (s) => containsPhrase(s.term, term) && containsPhrase(term, s.term),
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

/** In its own spelling only: a variant is the model's word, not proof. */
export const hasKeyword = (text: string, keyword: Pick<Keyword, "term">) =>
  containsPhrase(text, keyword.term);

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
