import { extractText, getDocumentProxy } from "unpdf";

import type { BoldSource } from "./bold";

/**
 * Simple mode's "resume" is exactly the PDF the user gave us (CLAUDE.md M5):
 * no parsing into sections, no editing. The one thing read from it is plain
 * text, once, at upload, so the keyword match can compare words. No AI.
 */

/** Matches the `uploads` bucket's limit (Vercel's request cap is 4.5 MB). */
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;
export const MAX_RESUME_PAGES = 10;
/** Matches resumes.text_content's check constraint. */
const MAX_TEXT_CHARS = 100_000;

export type PdfCheck =
  | {
      ok: true;
      text: string;
      pages: number;
      /** With `{ bold: true }`: which characters of `text` were bold. */
      bold?: BoldSource["ranges"];
    }
  | { ok: false; message: string };

/** A real PDF starts with "%PDF-"; the browser's content type isn't proof. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/**
 * Validate and read a resume PDF. A PDF with no text layer (a scan) is fine
 * to keep and attach to applications: it just comes back with empty text and
 * the review page says the keyword match can't read it.
 */
export async function readResumePdf(
  bytes: Uint8Array,
  options: { bold?: boolean } = {},
): Promise<PdfCheck> {
  if (bytes.length === 0) return { ok: false, message: "That file is empty." };
  if (bytes.length > MAX_RESUME_BYTES) {
    return { ok: false, message: "Keep the PDF under 4 MB." };
  }
  if (!looksLikePdf(bytes)) {
    return { ok: false, message: "That doesn't look like a PDF." };
  }
  try {
    // unpdf transfers the buffer to its worker; give it its own copy.
    const document = await getDocumentProxy(new Uint8Array(bytes));
    if (document.numPages > MAX_RESUME_PAGES) {
      return {
        ok: false,
        message: `That PDF has ${document.numPages} pages. Resumes are ${MAX_RESUME_PAGES} or fewer.`,
      };
    }
    if (options.bold) {
      const marked = await textWithBold(document);
      return { ok: true, ...marked, pages: document.numPages };
    }
    const { text } = await extractText(document, { mergePages: true });
    return {
      ok: true,
      text: text
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, MAX_TEXT_CHARS),
      pages: document.numPages,
    };
  } catch (error) {
    console.error(
      "[resume] couldn't read PDF:",
      error instanceof Error ? error.message : error,
    );
    return {
      ok: false,
      message: "Couldn't read that PDF. Try exporting it again.",
    };
  }
}

// ---------------------------------------------------------------- bold

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/**
 * A font drawn as bold, by its own name ("LMRoman10-Bold", "CMBX10",
 * "Calibri-Bold", "Inter-SemiBold"). pdf.js's own `bold` flag is rarely
 * set, so the name is the signal. Synthetic bold (a regular font drawn
 * thicker) isn't detectable this way, and comes out plain: no bold rather
 * than a guess.
 */
export function isBoldFontName(name: string): boolean {
  const base = name.replace(/^[A-Z]{6}\+/, "");
  return /bold|black|heavy|semibold|demibold|extrabold|ultrabold|cmbx|(^|[^a-z])bx\d/i.test(
    base,
  );
}

/** If more of the text than this is bold, the font isn't telling us anything. */
const MAX_BOLD_SHARE = 0.5;

type Char = { c: string; b: boolean };

/**
 * The same text `readResumePdf` returns (unpdf's extractText, then the same
 * clean-up), with each character's font weight carried along. Whitespace
 * is never bold itself.
 */
async function textWithBold(
  document: PdfDocument,
): Promise<{ text: string; bold: BoldSource["ranges"] }> {
  let chars: Char[] = [];
  for (let n = 1; n <= document.numPages; n += 1) {
    if (n > 1) chars.push({ c: "\n", b: false });
    const page = await document.getPage(n);
    // Loads the page's fonts, so their real names can be read.
    await page.getOperatorList();
    const content = await page.getTextContent();
    const bold = new Map<string, boolean>();
    for (const item of content.items) {
      if (!("str" in item) || item.str == null) continue;
      if (!bold.has(item.fontName)) {
        let name = "";
        try {
          name =
            (page.commonObjs.get(item.fontName) as { name?: string })?.name ??
            "";
        } catch {
          // Not loaded: treat as regular.
        }
        bold.set(item.fontName, isBoldFontName(name));
      }
      const b = bold.get(item.fontName) ?? false;
      for (const c of item.str) chars.push({ c, b: b && !/\s/.test(c) });
      if (item.hasEOL) chars.push({ c: "\n", b: false });
    }
  }

  // unpdf: [^\S\n]+ → " ", " ?\n ?" → "\n", \n{3,} → "\n\n".
  const collapsed: Char[] = [];
  for (const ch of chars) {
    const space = /[^\S\n]/.test(ch.c);
    const last = collapsed.at(-1);
    if (space && last && /[^\S\n]/.test(last.c)) continue;
    collapsed.push(space ? { c: " ", b: false } : ch);
  }
  chars = collapsed.filter(
    (ch, i, all) =>
      !(ch.c === " " && (all[i - 1]?.c === "\n" || all[i + 1]?.c === "\n")),
  );
  chars = chars.filter(
    (ch, i, all) =>
      !(ch.c === "\n" && all[i - 1]?.c === "\n" && all[i - 2]?.c === "\n"),
  );
  // readResumePdf: drop NULs, trim, cap.
  chars = chars.filter((ch) => ch.c !== "\u0000");
  let start = 0;
  let end = chars.length;
  while (start < end && /\s/.test(chars[start].c)) start += 1;
  while (end > start && /\s/.test(chars[end - 1].c)) end -= 1;
  chars = chars.slice(start, end);

  // Characters, not UTF-16 units: rebuild the string and the offsets
  // together, then cap.
  let text = "";
  const flags: boolean[] = [];
  for (const ch of chars) {
    text += ch.c;
    for (let i = 0; i < ch.c.length; i += 1) flags.push(ch.b);
  }
  text = text.slice(0, MAX_TEXT_CHARS);
  flags.length = text.length;

  return { text, bold: boldRanges(text, flags) };
}

/**
 * Per-character bold flags → [start, end) ranges. None at all if most of
 * the text is "bold": then the font name says nothing (a heavy face used
 * for everything), and no bold beats a wrong one.
 */
export function boldRanges(
  text: string,
  flags: boolean[],
): BoldSource["ranges"] {
  const visible = [...text].filter((c) => !/\s/.test(c)).length;
  const boldCount = flags.filter(Boolean).length;
  if (visible === 0 || boldCount / visible > MAX_BOLD_SHARE) return [];
  const ranges: BoldSource["ranges"] = [];
  for (let i = 0; i < flags.length; i += 1) {
    if (!flags[i]) continue;
    const from = i;
    while (i < flags.length && flags[i]) i += 1;
    ranges.push([from, i]);
  }
  return ranges;
}
