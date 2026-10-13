import type { QuestionsStatus } from "./types";

/**
 * Is the cached form still good, or should the next visitor fetch it again?
 * Mirrors save_posting_questions(), which refuses to overwrite a fresh cache:
 * a failure is retried after 10 minutes, anything else after 7 days (forms
 * change, and a "login required" ATS may have changed too).
 */

const FAILED_RETRY_MS = 10 * 60 * 1000;
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

export function questionsAreFresh(
  status: QuestionsStatus | null,
  fetchedAt: string | null,
  now: number,
): boolean {
  if (status === null || fetchedAt === null) return false;
  const age = now - Date.parse(fetchedAt);
  if (Number.isNaN(age)) return false;
  return age < (status === "failed" ? FAILED_RETRY_MS : REFRESH_MS);
}
