/**
 * Step 9: a second look (the Resume Fitting Guide's last step, "rerun the
 * ATS optimizer with new eyes and report back"). The re-score in step 8 is
 * mechanical; this is one more fast-tier call that reads the finished copy
 * the way a second reviewer would and writes notes for the user.
 *
 * Read-only by construction, so none of the fabrication checks apply:
 * - it gets the resume as plain text, with no line ids, so nothing it says
 *   can name a line for an edit to act on;
 * - it returns notes only (`{ what }[]`), never an edit or a resume;
 * - the pipeline calls it after the copy is final, and nothing reads the
 *   notes except the review page. second-look.test.ts checks all three.
 * If a note is worth taking, the user acts on it with "Edit this copy".
 *
 * Optional: if the call fails (a 429, a refusal, a bad answer), the
 * tailoring still ships, just without notes.
 */

import { z } from "zod";

import { AiError, type AiProvider, type AiUsage } from "@/lib/ai/types";

import { SECOND_LOOK_SYSTEM } from "./prompts";

export const secondLookSchema = z.object({
  suggestions: z.array(z.object({ what: z.string() })),
});

export type Suggestion = { what: string };

export const MAX_SUGGESTIONS = 8;
const MAX_SUGGESTION_CHARS = 400;

export type SecondLookInput = {
  /** The <posting> block the earlier steps sent. */
  postingBlock: string;
  /** One line per keyword: "- term — required: ON RESUME" or "…: MISSING". */
  keywordLines: string[];
  /** The finished tailored copy, as plain text. */
  resumeText: string;
};

export type SecondLook =
  | { status: "done"; suggestions: Suggestion[]; usage: AiUsage }
  | { status: "failed"; reason: string };

/** Trimmed, non-empty, deduplicated, at most MAX_SUGGESTIONS. */
export function cleanSuggestions(raw: { what: string }[]): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const item of raw) {
    let what = item.what.replace(/\s+/g, " ").trim();
    if (!what) continue;
    if (what.length > MAX_SUGGESTION_CHARS) {
      what = `${what.slice(0, MAX_SUGGESTION_CHARS - 1).trimEnd()}…`;
    }
    const key = what.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ what });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

export async function secondLook(
  provider: AiProvider,
  input: SecondLookInput,
): Promise<SecondLook> {
  try {
    const answer = await provider.generateStructured({
      tier: "fast",
      system: SECOND_LOOK_SYSTEM,
      input: [
        input.postingBlock,
        `<keywords>\n${input.keywordLines.join("\n")}\n</keywords>`,
        `<resume>\n${input.resumeText}\n</resume>`,
      ].join("\n\n"),
      schema: secondLookSchema,
      name: "second_look",
      maxOutputTokens: 4_000,
    });
    return {
      status: "done",
      suggestions: cleanSuggestions(answer.data.suggestions),
      usage: answer.usage,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof AiError ? error.code : "error",
    };
  }
}
