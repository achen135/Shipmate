/**
 * Bold inside a line (fix handoff "bold text and preview font", Finding 1).
 *
 * Bullets, list values and paragraphs may hold `**bold**` spans: the
 * strings stay strings, with this one bit of markup. Headings, labels and
 * titles never do (the template bolds those by layout).
 *
 * Where bold comes from: only the user's own file. At import, the reader
 * reports which characters of the text were drawn in a bold font
 * (`BoldSource`); after the model has structured the resume (from plain
 * text: it never sees or writes markers), `markBold` finds each stored line
 * back in the file and wraps exactly the characters that were bold there.
 * A line that can't be found word for word gets none. Nothing is ever
 * bolded because it "looks like a metric".
 *
 * Tailoring never adds bold: `carryBold` puts back, on a reworded line,
 * only spans that were bold in the line it came from.
 */

/** The import text and which of its characters were bold, as [start, end). */
export type BoldSource = { text: string; ranges: [number, number][] };

const SPAN = /\*\*(.+?)\*\*/g;

/** The line without its markers. */
export function stripBold(text: string): string {
  return text.replace(SPAN, "$1");
}

/** The bold spans' own text, in order. */
export function boldSpans(text: string): string[] {
  return [...text.matchAll(SPAN)].map((m) => m[1]);
}

/** Wrap [start, end) ranges of plain `text` in markers. */
function wrap(text: string, ranges: [number, number][]): string {
  let out = "";
  let at = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start < at || end <= start) continue;
    out += `${text.slice(at, start)}**${text.slice(start, end)}**`;
    at = end;
  }
  return out + text.slice(at);
}

/** Maximal runs of true flags, never starting or ending on a space. */
function runs(text: string, bold: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= text.length; i += 1) {
    const on =
      i < text.length &&
      (bold[i] ||
        // A space inside a bold run (bold on both sides) stays in it.
        (/\s/.test(text[i]) && start !== -1 && (bold[i + 1] ?? false)));
    if (on && start === -1) start = i;
    if (!on && start !== -1) {
      let end = i;
      while (end > start && /\s/.test(text[end - 1])) end -= 1;
      if (end > start) out.push([start, end]);
      start = -1;
    }
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Per-character bold flags for the source text. */
function flagsOf(source: BoldSource): boolean[] {
  const flags = new Array<boolean>(source.text.length).fill(false);
  for (const [start, end] of source.ranges) {
    for (let i = Math.max(0, start); i < Math.min(end, flags.length); i += 1) {
      flags[i] = true;
    }
  }
  return flags;
}

/**
 * `line` (plain, single-spaced) with the bold it has in the source file.
 * Found by its words, with any spacing or line break between them. If the
 * line isn't in the file, or is in it more than once with different bold,
 * it comes back plain.
 */
export function markBold(line: string, source: BoldSource): string {
  const plain = stripBold(line);
  if (source.ranges.length === 0) return plain;
  const words = plain.split(/\s+/).filter(Boolean);
  if (words.length === 0) return plain;
  const flags = flagsOf(source);
  const pattern = new RegExp(words.map(escape).join("\\s+"), "g");

  let result: string | null = null;
  for (const match of source.text.matchAll(pattern)) {
    // Each word's characters' flags, then the single spaces between them.
    const bold: boolean[] = [];
    let cursor = match.index;
    words.forEach((word, w) => {
      const at = source.text.indexOf(word, cursor);
      for (let i = 0; i < word.length; i += 1) bold.push(flags[at + i]);
      cursor = at + word.length;
      if (w < words.length - 1) bold.push(false);
    });
    const joined = words.join(" ");
    const marked = wrap(joined, runs(joined, bold));
    if (result !== null && result !== marked) return plain;
    result = marked;
  }
  return result ?? plain;
}

/** Is text[start, end) a whole run of words (not part of a longer word)? */
function wholeWords(text: string, start: number, end: number): boolean {
  const word = /[\p{L}\p{N}]/u;
  return (
    !(start > 0 && word.test(text[start - 1]) && word.test(text[start])) &&
    !(end < text.length && word.test(text[end]) && word.test(text[end - 1]))
  );
}

/**
 * A reworded line keeps the bold of words it kept: each span that was bold
 * in `before` is bolded again where `after` still has it word for word.
 * Words `after` adds are never bolded.
 */
export function carryBold(before: string, after: string): string {
  const plain = stripBold(after);
  const ranges: [number, number][] = [];
  for (const span of boldSpans(before)) {
    let from = 0;
    while (from <= plain.length) {
      const at = plain.indexOf(span, from);
      if (at === -1) break;
      const end = at + span.length;
      const taken = ranges.some(([s, e]) => at < e && end > s);
      if (!taken && wholeWords(plain, at, end)) {
        ranges.push([at, end]);
        break;
      }
      from = at + 1;
    }
  }
  return wrap(plain, ranges);
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** HTML for a line: escaped, with `**…**` as <strong>. */
export function renderBold(text: string): string {
  return text
    .split(SPAN)
    .map((part, i) =>
      i % 2 === 1 ? `<strong>${escapeHtml(part)}</strong>` : escapeHtml(part),
    )
    .join("");
}
