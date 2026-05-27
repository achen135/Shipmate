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
 * An "or" list in the posting ("Bachelor's, Master's or PhD") is one
 * requirement with options, not one requirement per option: the model
 * returns it as one keyword with `alternatives`, and the resume has it if it
 * has any one of them. Unlike variants, alternatives are checked: code keeps
 * them only if the posting really writes them as one "or" list (orList),
 * else each option is scored as its own keyword, as the posting may want
 * them all.
 *
 * Weighting: a required keyword counts twice, a preferred one once.
 */

import { z } from "zod";

import { containsPhrase, mentionsPhrase, wordKey } from "./text";

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
      /** The other options of an "or" list: "Master's", "PhD" for "Bachelor's". */
      alternatives: z.array(z.string()),
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
  /**
   * The posting's other options for this one requirement, each as the
   * posting writes it, checked to be one "or" list with `term` (see above).
   * Having any one of them counts.
   */
  alternatives: string[];
};

/** "Bachelor's or Master's or PhD": how a keyword is shown and listed. */
export const keywordLabel = (keyword: Pick<Keyword, "term" | "alternatives">) =>
  [keyword.term, ...keyword.alternatives].join(" or ");

/** Every spelling that satisfies the keyword: its term and the posting's other options. */
export const keywordOptions = (
  keyword: Pick<Keyword, "term" | "alternatives">,
) => [keyword.term, ...keyword.alternatives];

/** Fewer keywords than this and a score would mean nothing. */
export const MIN_KEYWORDS = 4;
/** Shorter posting text than this isn't enough to score (characters). */
export const MIN_POSTING_CHARS = 400;
const MAX_KEYWORDS = 30;

/** "experience building software", "ability to learn", "passion for …". */
const FRAMING =
  /^(experience|ability|able|comfort|comfortable|passion|passionate|willingness|willing|eagerness|eager|desire|interest|interested|enthusiasm|curiosity|aptitude|track record|proven)\b/i;

/** A soft skill phrased as something you do: "communicate openly", "ask questions early". */
const DOING =
  /^(communicate|communicating|ask|asking|build|building|work|working|thrive|thriving|learn|learning|take|taking|be|being|have|having|get|getting|move|moving|own|owning|care|caring|love|enjoy|seek|seeking|deliver|delivering|think|thinking|solve|solving|stay|staying|adapt|adapting|wear|embrace|embracing|bring|bringing|share|sharing|speak|speaking|give|giving|raise|raising|hold|holding)\b/i;

/**
 * Who may apply and when, not what they can do: "graduating in 2027",
 * "class of 2028", "currently enrolled", "pursuing a degree", "high school", "work
 * authorization". Shipmate's rule-based warnings check grad year and
 * sponsorship against the profile; as keywords they'd read as missing.
 */
const ELIGIBILITY =
  /\b(graduat\w*|class of|enroll\w*|currently|pursuing|high school|work authori[sz]\w*|authori[sz]ed to work|sponsorship|start date|starting in|returning to school)\b/i;

/** A year: "Summer 2027", "2027 graduates". */
const YEAR = /\b(19|20)\d{2}\b/;

/**
 * Interview criteria, not resume words (M8 §0d): a person shows them, an
 * ATS can't find them as written, so they'd only ever read as "missing".
 * Real named skills stay ("leadership", "stakeholder management"). Same for
 * eligibility and timing: a qualification with a year in it is the
 * posting's timeline ("class of 2029"), while a tool may have one ("SQL
 * Server 2019").
 */
function qualifying(term: string, kind: Keyword["kind"]): boolean {
  return (
    FRAMING.test(term) ||
    (kind === "soft_skill" && DOING.test(term)) ||
    ELIGIBILITY.test(term) ||
    (kind === "qualification" && YEAR.test(term))
  );
}

/**
 * Words and the punctuation lists are written with, for orList. Unlike
 * text.ts's tokens, "/" always splits ("BS/MS" is two options); a word's
 * dots and dashes stay ("Node.js", "C++").
 */
const LIST_TOKEN =
  /[\p{L}\p{N}][\p{L}\p{N}+#]*(?:[.\-'’][\p{L}\p{N}+#]+)*|[,/;:()]|\n|\.(?=\s|$)/gu;

function listTokens(text: string): string[] {
  return [...text.matchAll(LIST_TOKEN)].map((m) =>
    /^[\p{L}\p{N}]/u.test(m[0]) ? wordKey(m[0]) : m[0],
  );
}

/** What may sit between two options of one list, and which of those say "or". */
const SEPARATORS = [
  [","],
  ["/"],
  ["or"],
  [",", "or"],
  ["and", "/", "or"],
  [",", "and", "/", "or"],
];
const SAYS_OR = (sep: string[]) => sep.includes("or") || sep.includes("/");

const startsWith = (tokens: string[], at: number, run: string[]) =>
  run.length > 0 && run.every((t, i) => tokens[at + i] === t);

/**
 * Does the posting write all these options as one "or" list? They must sit
 * next to each other, separated only by commas, slashes, "or" or "and/or",
 * with an "or" (or a slash) among the separators or right after the list
 * ("Computer Science, Engineering, or a related field"). A list joined by
 * "and" is not options. Strict on purpose: when this says no, each option is
 * scored as its own keyword, which is never kinder than the posting.
 */
export function orList(postingText: string, options: string[]): boolean {
  const tokens = listTokens(postingText);
  const wanted = options.map(listTokens).filter((o) => o.length > 0);
  if (wanted.length < 2 || wanted.length !== options.length) return false;
  for (let start = 0; start < tokens.length; start += 1) {
    const used = new Set<number>();
    let at = start;
    let saysOr = false;
    let separator: string[] | null = null;
    for (;;) {
      // The longest unused option written here.
      let best = -1;
      wanted.forEach((option, i) => {
        if (used.has(i) || !startsWith(tokens, at, option)) return;
        if (best === -1 || option.length > wanted[best].length) best = i;
      });
      if (best === -1) break;
      used.add(best);
      at += wanted[best].length;
      if (separator && SAYS_OR(separator)) saysOr = true;
      if (used.size === wanted.length) break;
      separator =
        [...SEPARATORS].reverse().find((sep) => startsWith(tokens, at, sep)) ??
        null;
      if (!separator) break;
      at += separator.length;
    }
    if (used.size !== wanted.length) continue;
    const tail = [...SEPARATORS]
      .reverse()
      .find((sep) => startsWith(tokens, at, sep));
    if (saysOr || (tail && SAYS_OR(tail))) return true;
  }
  return false;
}

/**
 * Keep the keywords the posting actually contains, in the posting's own
 * spelling: the model's term if the posting writes it, else the first of
 * its variants that the posting writes (never a term the posting doesn't
 * say). Cleaned, and deduplicated by spelling only: two keywords the model
 * grouped stay two. An "or" list keeps its options together only if the
 * posting writes them as one (orList); otherwise each option is a keyword
 * of its own.
 */
export function verifyKeywords(
  extracted: ExtractedKeywords,
  postingText: string,
): Keyword[] {
  const clean = (values: string[]) => [
    ...new Set(values.map((v) => v.trim().slice(0, 80)).filter(Boolean)),
  ];
  const same = (a: string, b: string) =>
    containsPhrase(a, b) && containsPhrase(b, a);

  type Raw = ExtractedKeywords["keywords"][number];
  const candidates: (Raw & { grouped: boolean })[] = [];
  for (const k of extracted.keywords) {
    const options = clean([k.term, ...k.alternatives]).filter((o) =>
      containsPhrase(postingText, o),
    );
    if (options.length > 1 && orList(postingText, options)) {
      candidates.push({
        ...k,
        term: options[0],
        alternatives: options.slice(1, 6),
        grouped: true,
      });
      continue;
    }
    // Not checked as one list: each option on its own, the model's variants
    // only on the term they came with.
    candidates.push({ ...k, alternatives: [], grouped: false });
    for (const alternative of clean(k.alternatives)) {
      if (same(alternative, k.term)) continue;
      candidates.push({
        ...k,
        term: alternative,
        variants: [],
        alternatives: [],
        grouped: false,
      });
    }
  }

  const seen: Keyword[] = [];
  for (const k of candidates) {
    const term = k.grouped
      ? k.term
      : clean([k.term, ...k.variants]).find((s) =>
          containsPhrase(postingText, s),
        );
    if (!term || qualifying(term, k.kind)) continue;
    const alternatives = k.alternatives.filter((a) => !qualifying(a, k.kind));
    const variants = clean([k.term, ...k.variants])
      .filter((v) => !same(term, v))
      .slice(0, 5);
    const keyword = {
      term,
      importance: k.importance,
      kind: k.kind,
      variants,
      alternatives,
    };
    // One requirement once: the same spelling, or an option of a list
    // already kept (and a list swallows a lone option kept before it).
    const duplicate = seen.find((s) =>
      keywordOptions(s).some((a) =>
        keywordOptions(keyword).some((b) => same(a, b)),
      ),
    );
    if (duplicate) {
      if (k.importance === "required") duplicate.importance = "required";
      if (alternatives.length > 0 && duplicate.alternatives.length === 0) {
        duplicate.term = term;
        duplicate.alternatives = alternatives;
        duplicate.variants = variants;
      }
      continue;
    }
    seen.push(keyword);
    if (seen.length >= MAX_KEYWORDS) break;
  }
  return seen;
}

/**
 * In its own spelling only: a variant is the model's word, not proof (§0a).
 * Read the way a person would: a word or two may sit inside a phrase
 * ("AI editing agents" has "AI agents"; §0d), never inside one word. Any one
 * option of an "or" list counts: the posting itself accepts it.
 */
export const hasKeyword = (
  text: string,
  keyword: Pick<Keyword, "term"> & { alternatives?: string[] },
) =>
  [keyword.term, ...(keyword.alternatives ?? [])].some((option) =>
    mentionsPhrase(text, option),
  );

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
