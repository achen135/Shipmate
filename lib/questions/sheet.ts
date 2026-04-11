import { type Classified, classifyQuestions } from "./classify";
import { type AnswerProfile, type Prefill, prefillAnswer } from "./prefill";
import type { RawQuestion } from "./types";

/**
 * The answer sheet: the form's questions, sorted into the groups the review
 * page shows. Standard questions carry their prefilled answer; the rest are
 * listed for the user to handle themselves.
 */

export type SheetItem = { question: Classified; prefill: Prefill | null };

export type AnswerSheet = {
  standard: SheetItem[];
  written: SheetItem[];
  antibot: SheetItem[];
  other: SheetItem[];
  demographic: SheetItem[];
  total: number;
};

export function buildSheet(
  questions: RawQuestion[],
  profile: AnswerProfile,
): AnswerSheet {
  const sheet: AnswerSheet = {
    standard: [],
    written: [],
    antibot: [],
    other: [],
    demographic: [],
    total: 0,
  };
  for (const question of classifyQuestions(questions)) {
    const item = { question, prefill: prefillAnswer(question, profile) };
    sheet.total += 1;
    if (question.kind === "standard") {
      (question.field === "demographic"
        ? sheet.demographic
        : sheet.standard
      ).push(item);
    } else {
      sheet[question.kind].push(item);
    }
  }
  return sheet;
}
