import mammoth from "mammoth";

import { MAX_RESUME_BYTES, readResumePdf } from "./pdf";

/**
 * Text from a resume file for the AI import: PDF (M5's unpdf reader) or
 * DOCX (mammoth's plain-text extraction). The file itself isn't kept; only
 * the structured result is.
 */

export type FileText =
  | { ok: true; text: string; kind: "pdf" | "docx" }
  | { ok: false; message: string };

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
      const { value } = await mammoth.extractRawText({
        buffer: Buffer.from(bytes),
      });
      const text = value
        .replace(/\u0000/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return text
        ? { ok: true, text, kind: "docx" }
        : { ok: false, message: "That document has no text in it." };
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

  const pdf = await readResumePdf(bytes);
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
  return { ok: true, text: pdf.text, kind: "pdf" };
}
