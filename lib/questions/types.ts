import { z } from "zod";

/**
 * One question on an application form, as fetched (CLAUDE.md "Question
 * fetch"). Stored as-is in `postings.questions`; whether it is a standard,
 * written, or anti-bot question is worked out when it is read
 * (classify.ts), so better rules apply to forms already cached.
 */

export const INPUT_KINDS = [
  "text",
  "textarea",
  "select",
  "multiselect",
  "boolean",
  "file",
  "other",
] as const;

export type InputKind = (typeof INPUT_KINDS)[number];

export const rawQuestionSchema = z.object({
  label: z.string().trim().min(1).max(2000),
  description: z.string().trim().max(4000).optional(),
  required: z.boolean(),
  input: z.enum(INPUT_KINDS),
  options: z.array(z.string().max(300)).max(60),
  /** Greenhouse files its EEO questions apart from the rest. */
  group: z.literal("demographic").optional(),
});

export type RawQuestion = z.infer<typeof rawQuestionSchema>;

export type QuestionsStatus = "ok" | "unknown" | "failed";

/** What a fetch found. `unknown` = a form we can't see; `failed` = it errored. */
export type FetchedQuestions =
  | { status: "ok"; questions: RawQuestion[] }
  | { status: "unknown" }
  | { status: "failed" };

/** Cap on what one form may contribute (matches the database function). */
export const MAX_QUESTIONS = 150;

/**
 * jsonb from the database → the questions that are well-formed. Anything
 * else (a bad item, a changed shape) is dropped rather than shown.
 */
export function readStoredQuestions(value: unknown): RawQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: RawQuestion[] = [];
  for (const item of value.slice(0, MAX_QUESTIONS)) {
    const parsed = rawQuestionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
