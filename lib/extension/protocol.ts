/**
 * What the Shipmate API and the extension say to each other. Types only
 * (plus the label normaliser both sides share), so the extension's bundle
 * pulls in nothing else from the app.
 */

import type { QuestionKind, StandardField } from "@/lib/questions/classify";
import type { InputKind } from "@/lib/questions/types";

/** One question on the form, from the answer sheet (lib/questions/sheet.ts). */
export type FillQuestion = {
  label: string;
  /** standard (incl. demographic) / written / antibot / other */
  kind: QuestionKind;
  field: StandardField | null;
  input: InputKind;
  options: string[];
  required: boolean;
  /** For a standard question: the answer, or null if the profile lacks it. */
  value: string | null;
  /** Where the answer came from, or what to add in Profile. */
  note: string | null;
};

export type FillResponse =
  | {
      ok: true;
      /** An unused Apply marker for this page: fill without a click. */
      auto: boolean;
      userPostingId: string;
      posting: { title: string; company: string };
      /** ok: the form's questions are known; otherwise fill nothing. */
      questionsStatus: "ok" | "unknown" | "failed";
      questions: FillQuestion[];
      /** The resume to attach, if there's one. */
      pdf: { kind: "tailored" | "uploaded"; name: string } | null;
    }
  | {
      ok: false;
      reason:
        | "not_connected"
        | "not_found"
        | "not_supported"
        | "bad_request"
        | "error";
      message: string;
    };

export type SubmittedResponse =
  { ok: true; recorded: boolean } | { ok: false; message: string };

/**
 * Label text as compared: lower case, no required-marks ("*", "(required)",
 * "✱"), no punctuation, single spaces. ATS pages wrap labels in slightly
 * different markup than their APIs return; this is the common ground.
 */
export function normalizeLabel(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\(\s*(required|optional)\s*\)/g, " ")
    .replace(/[*✱∗]/g, " ")
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
