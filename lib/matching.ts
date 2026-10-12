import { simplifyText } from "@/lib/postings/normalize";

/**
 * Deterministic matching of a posting to a watch profile (no AI, no cost).
 * Used by the worker for newly listed postings and by the 7-day backfill.
 * Biased loose: when unsure, match, because a skipped posting costs a tap and
 * a missed one can cost an application.
 *
 * A posting matches when all of these hold:
 *   1. term: the posting's term is one the profile watches, or the posting's
 *      term is unknown;
 *   2. role: its category is one the profile watches, or an include keyword
 *      appears in the title;
 *   3. no exclude keyword appears in the title;
 *   4. location (only if the profile lists any): a posting location matches
 *      one of them, or the posting is remote and remote is OK, or it doesn't
 *      say where, or it says just "United States".
 * Sponsorship never filters; it becomes a warning on the review page (M5).
 */

export type MatchRules = {
  categories: readonly string[];
  includeKeywords: readonly string[];
  excludeKeywords: readonly string[];
  terms: readonly string[];
  locations: readonly string[];
  remoteOk: boolean;
};

export type MatchablePosting = {
  title: string;
  category: string | null;
  terms: readonly string[];
  locations: readonly string[];
};

/** Lowercase, hyphens/slashes/underscores as spaces, single spaces. */
function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\-_/,.()]+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does `keyword` appear in `title`? Whole words for short keywords ("ML"
 * doesn't hit "HTML", "AI" doesn't hit "Air"); keywords of 4+ characters also
 * hit longer words that start with them ("quant" → "Quantitative",
 * "engineer" → "Engineering").
 */
export function keywordHits(title: string, keyword: string): boolean {
  const k = normalizePhrase(keyword);
  if (!k) return false;
  const tail = k.length >= 4 ? "" : "(?![a-z0-9])";
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(k)}${tail}`).test(
    normalizePhrase(title),
  );
}

/** Common short forms people type for places Simplify spells differently. */
const LOCATION_ALIASES: Record<string, string[]> = {
  nyc: ["new york"],
  "new york": ["nyc"],
  "new york city": ["nyc", "new york"],
  sf: ["san francisco"],
  "san francisco": ["sf"],
  la: ["los angeles"],
  "los angeles": ["la"],
  dc: ["washington dc", "washington d c"],
  "washington dc": ["dc"],
  "bay area": [
    "sf",
    "san francisco",
    "san jose",
    "palo alto",
    "mountain view",
    "sunnyvale",
    "santa clara",
    "menlo park",
    "redwood city",
    "cupertino",
    "fremont",
    "oakland",
    "berkeley",
    "san mateo",
    "foster city",
    "san carlos",
  ],
};

/** Posting locations that don't narrow anything down. */
const ANYWHERE = new Set([
  "united states",
  "usa",
  "us",
  "u s",
  "multiple locations",
  "various locations",
]);

function containsPhrase(haystack: string, phrase: string): boolean {
  return ` ${haystack} `.includes(` ${phrase} `);
}

function locationOk(rules: MatchRules, locations: readonly string[]): boolean {
  if (rules.locations.length === 0) return true;
  if (locations.length === 0) return true;

  const wanted = rules.locations.flatMap((place) => {
    const p = simplifyText(place);
    return p ? [p, ...(LOCATION_ALIASES[p] ?? [])] : [];
  });
  return locations.some((raw) => {
    const location = simplifyText(raw);
    if (ANYWHERE.has(location)) return true;
    if (containsPhrase(location, "remote")) {
      return rules.remoteOk || wanted.includes("remote");
    }
    return wanted.some((place) => containsPhrase(location, place));
  });
}

export function matchPosting(
  rules: MatchRules,
  posting: MatchablePosting,
): boolean {
  if (posting.terms.length > 0 && rules.terms.length > 0) {
    const watched = new Set(rules.terms.map((t) => t.toLowerCase()));
    if (!posting.terms.some((t) => watched.has(t.toLowerCase()))) return false;
  }

  const hasRoleRules =
    rules.categories.length > 0 || rules.includeKeywords.length > 0;
  if (hasRoleRules) {
    const byCategory =
      posting.category !== null && rules.categories.includes(posting.category);
    const byKeyword = rules.includeKeywords.some((k) =>
      keywordHits(posting.title, k),
    );
    if (!byCategory && !byKeyword) return false;
  }

  if (rules.excludeKeywords.some((k) => keywordHits(posting.title, k))) {
    return false;
  }

  return locationOk(rules, posting.locations);
}

/** The first of a user's profiles that matches, or null. */
export function firstMatch<P extends MatchRules>(
  profiles: readonly P[],
  posting: MatchablePosting,
): P | null {
  return profiles.find((profile) => matchPosting(profile, posting)) ?? null;
}
