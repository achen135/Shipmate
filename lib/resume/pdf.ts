import { extractText, getDocumentProxy } from "unpdf";

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
  { ok: true; text: string; pages: number } | { ok: false; message: string };

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
export async function readResumePdf(bytes: Uint8Array): Promise<PdfCheck> {
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
