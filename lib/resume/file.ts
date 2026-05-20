import mammoth from "mammoth";

import type { BoldSource } from "./bold";
import { MAX_RESUME_BYTES, readResumePdf } from "./pdf";

/**
 * Text from a resume file for the AI import: PDF (M5's unpdf reader) or
 * DOCX (mammoth's plain-text extraction). The file itself isn't kept; only
 * the structured result is.
 *
 * Also which characters of that text were bold in the file (`bold`), from
 * the PDF's fonts or the DOCX's own bold runs. Best effort: anything
 * unclear comes back as no bold, never a guess (lib/resume/bold.ts).
 */

export type FileText =
  | {
      ok: true;
      text: string;
      kind: "pdf" | "docx";
      bold: BoldSource["ranges"];
    }
  | { ok: false; message: string };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};
const decode = (html: string) =>
  html.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (whole, name: string) => {
    if (ENTITIES[name]) return ENTITIES[name];
    if (/^#x/i.test(name))
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (/^#/.test(name)) return String.fromCodePoint(Number(name.slice(1)));
    return whole;
  });

/**
 * A DOCX's bold, from mammoth's HTML (<strong>), placed on its raw text:
 * each paragraph's text is found in the raw text in order, and its bold
 * spans are offset into it. A paragraph that can't be found exactly gets
 * none.
 */
export function docxBold(html: string, raw: string): BoldSource["ranges"] {
  const ranges: BoldSource["ranges"] = [];
  let cursor = 0;
  for (const block of html.matchAll(
    /<(p|li|h[1-6]|td|th)\b[^>]*>([\s\S]*?)<\/\1>/g,
  )) {
    let text = "";
    const local: [number, number][] = [];
    let depth = 0;
    let start = 0;
    for (const part of block[2].split(/(<[^>]+>)/)) {
      if (part.startsWith("<")) {
        if (/^<strong\b/i.test(part)) {
          if (depth === 0) start = text.length;
          depth += 1;
        } else if (/^<\/strong>/i.test(part) && depth > 0) {
          depth -= 1;
          if (depth === 0 && text.length > start)
            local.push([start, text.length]);
        }
        continue;
      }
      text += decode(part);
    }
    if (!text.trim()) continue;
    const at = raw.indexOf(text, cursor);
    if (at === -1) continue;
    for (const [s, e] of local) {
      // Never a range that starts or ends on whitespace.
      let from = s;
      let to = e;
      while (from < to && /\s/.test(text[from])) from += 1;
      while (to > from && /\s/.test(text[to - 1])) to -= 1;
      if (to > from) ranges.push([at + from, at + to]);
    }
    cursor = at + text.length;
  }
  return ranges;
}

/** A DOCX is a ZIP: it starts with "PK\x03\x04". */
export function looksLikeDocx(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

export async function readResumeFile(bytes: Uint8Array): Promise<FileText> {
  if (bytes.length === 0) return { ok: false, message: "That file is empty." };
  if (bytes.length > MAX_RESUME_BYTES) {
    return { ok: false, message: "Keep the file under 4 MB." };
  }

  if (looksLikeDocx(bytes)) {
    try {
      const buffer = Buffer.from(bytes);
      const { value } = await mammoth.extractRawText({ buffer });
      const text = value
        .replace(/\u0000/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (!text) {
        return { ok: false, message: "That document has no text in it." };
      }
      let bold: BoldSource["ranges"] = [];
      try {
        bold = docxBold((await mammoth.convertToHtml({ buffer })).value, text);
      } catch {
        // No bold rather than no import.
      }
      return { ok: true, text, kind: "docx", bold };
    } catch (error) {
      console.error(
        "[resume] couldn't read DOCX:",
        error instanceof Error ? error.message : error,
      );
      return {
        ok: false,
        message: "Couldn't read that document. Try saving it again as .docx.",
      };
    }
  }

  const pdf = await readResumePdf(bytes, { bold: true });
  if (!pdf.ok) {
    return pdf.message === "That doesn't look like a PDF."
      ? { ok: false, message: "Upload a PDF or a Word (.docx) file." }
      : pdf;
  }
  if (!pdf.text) {
    return {
      ok: false,
      message:
        "There's no text in that PDF (it may be a scan). Try the Word file, or export the PDF again.",
    };
  }
  return { ok: true, text: pdf.text, kind: "pdf", bold: pdf.bold ?? [] };
}
