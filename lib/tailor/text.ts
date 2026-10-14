/**
 * Words, the way the no-fabrication check compares them (lib/tailor/
 * edits.ts, trace.ts). Tech spellings survive ("C++", "C#", "Node.js",
 * "CI/CD"), so "C" on a resume never vouches for "C++"; plurals,
 * possessives and verb endings fold ("APIs" = "API", "migrated" =
 * "migrating"); case doesn't matter.
 *
 * Deliberately not the import check's `normalize` (lib/resume/import.ts),
 * which drops punctuation and would make "C++" and "C" the same word.
 */

/** A word, with tech punctuation inside it kept: c++, c#, node.js, ci/cd, real-time. */
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}+#]*(?:[./\-'’][\p{L}\p{N}+#]+)*/gu;

/**
 * Words that carry no fact on their own, so a reworded line may add them
 * freely. Short on purpose: anything not here has to trace to the user's own
 * resume or fact bank. "not", "no" and "nor" are left out, because adding
 * one changes what a line claims.
 */
export const FUNCTION_WORDS = new Set(
  `a an the and or but of to in on at by for with from into onto over under via as than then that which who whose whom this these those it its their them they our we i my me his her he she be is are was were been being has have had do does did using use used while across through throughout within also such so each both all any per including include includes up out about after before during between among`
    .split(/\s+/)
    .filter(Boolean),
);

export type Token = {
  /** As written, lowercase. */
  raw: string;
  /** Compared form: lowercase, plural and possessive folded. */
  key: string;
  /** Starts with a capital and isn't the line's first word: a name. */
  named: boolean;
};

export function wordKey(raw: string): string {
  // Acronym plurals: APIs, GPUs, URLs.
  if (/^\p{Lu}{2,}s$/u.test(raw)) return raw.slice(0, -1).toLowerCase();
  let word = raw.toLowerCase().replace(/[’']s$/, "");
  // Only plain words fold; anything with tech punctuation stays as written.
  if (!/^[\p{L}]+$/u.test(word)) return word;
  if (
    word.length > 3 &&
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is")
  ) {
    word = word.slice(0, -1);
  }
  // Verb forms of one word match: migrating / migrated / migrate,
  // tested / testing / test. Only when a real stem is left ("string" and
  // "need" stay whole).
  for (const suffix of ["ing", "ed"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      word = word.slice(0, -suffix.length);
      break;
    }
  }
  if (word.length >= 5 && word.endsWith("e")) word = word.slice(0, -1);
  return word;
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let first = true;
  for (const match of text.matchAll(TOKEN)) {
    const raw = match[0];
    out.push({
      raw: raw.toLowerCase(),
      key: wordKey(raw),
      named: !first && /^\p{Lu}/u.test(raw),
    });
    first = false;
  }
  return out;
}

/** Parts of a compound word ("real-time" → real, time), for loose matches. */
function parts(key: string): string[] {
  return key
    .split(/[./\-'’]/)
    .filter(Boolean)
    .map(wordKey);
}

/** Every word key in these texts, with the parts of compound words too. */
export function keySet(...texts: string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      keys.add(token.key);
      for (const part of parts(token.key)) keys.add(part);
    }
  }
  return keys;
}

/** Does `keys` contain this word (or every part of a compound word)? */
export function hasWord(keys: Set<string>, key: string): boolean {
  if (keys.has(key)) return true;
  const split = parts(key);
  return split.length > 1 && split.every((p) => keys.has(p));
}

export const isFunctionWord = (key: string) => FUNCTION_WORDS.has(key);

/** Facts live in numbers and tech spellings as much as in names. */
export function looksFactual(token: Token): boolean {
  return token.named || /\d/.test(token.raw) || /[+#./]/.test(token.raw);
}

/** The line's words as one spaced string of keys, for phrase matching. */
function keyLine(text: string): string {
  return ` ${tokenize(text)
    .map((t) => t.key)
    .join(" ")} `;
}

/**
 * Is `phrase` written, as a run of whole words, somewhere in `text`?
 * "Machine Learning" is in "built machine learning models"; "Java" isn't in
 * "JavaScript"; "C" isn't in "C++".
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const needle = keyLine(phrase);
  if (needle.trim() === "") return false;
  return keyLine(text).includes(needle);
}

/** Words in `after` that `before` doesn't have (by key). */
export function addedTokens(before: string, after: string): Token[] {
  const had = keySet(before);
  return tokenize(after).filter((t) => !hasWord(had, t.key));
}
