import type { AnswerSheet } from "@/lib/questions/sheet";

import type { FillQuestion } from "./protocol";

/**
 * The answer sheet as the extension gets it: every question in one list,
 * with an answer only on standard ones (the rest are the user's).
 */
export function toFillQuestions(sheet: AnswerSheet): FillQuestion[] {
  return [
    ...sheet.standard,
    ...sheet.demographic,
    ...sheet.written,
    ...sheet.antibot,
    ...sheet.other,
  ].map(({ question, prefill }) => ({
    label: question.label,
    kind: question.kind,
    field: question.field ?? null,
    input: question.input,
    options: question.options,
    required: question.required,
    value: question.kind === "standard" ? (prefill?.value ?? null) : null,
    note: prefill?.note ?? null,
  }));
}
