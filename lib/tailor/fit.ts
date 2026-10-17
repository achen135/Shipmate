/**
 * Step 5: keep the tailored resume to one page. Measure it (headless
 * Chromium in the worker, a fake in tests); if it runs over, ask the model
 * what to leave out and apply only drops (lib/tailor/edits.ts CUT_OPS: a cut
 * can't add a word). At most two rounds; if it still runs over, ship it
 * with a note rather than cutting blindly.
 */

import type { AiProvider, AiUsage } from "@/lib/ai/types";
import type { ResumeContent } from "@/lib/resume/structured";
import type { Fact } from "@/lib/schemas/fact-bank";

import {
  CUT_OPS,
  type Change,
  type Dropped,
  applyEdits,
  editPlanSchema,
} from "./edits";
import { CUT_SYSTEM } from "./prompts";
import { type Keyword, keywordLabel } from "./score";
import { describeResume } from "./view";

export const MAX_FIT_LOOPS = 2;

export type Measure = (
  content: ResumeContent,
) => Promise<{ pages: number; overflow: number }>;

export type FitResult = {
  content: ResumeContent;
  changes: Change[];
  dropped: Dropped[];
  usages: AiUsage[];
  /** Pages at the end (1 when it fits). */
  pages: number;
  loops: number;
};

export const STILL_LONG_NOTE =
  "It's still longer than one page after two tries to trim it. Check it before you send it.";

export async function fitOnePage(input: {
  provider: AiProvider;
  measure: Measure;
  content: ResumeContent;
  master: ResumeContent;
  facts: Fact[];
  keywords: Keyword[];
}): Promise<FitResult> {
  let content = input.content;
  const changes: Change[] = [];
  const dropped: Dropped[] = [];
  const usages: AiUsage[] = [];
  let measured = await input.measure(content);
  let loops = 0;

  while (measured.pages > 1 && loops < MAX_FIT_LOOPS) {
    loops += 1;
    const { data, usage } = await input.provider.generateStructured({
      tier: "strong",
      system: CUT_SYSTEM,
      input: [
        `<keywords>\n${input.keywords
          .map((k) => `- ${keywordLabel(k)} (${k.importance})`)
          .join("\n")}\n</keywords>`,
        `<overflow>\nAbout ${Math.max(5, Math.round(measured.overflow * 100))}% of a page too long.\n</overflow>`,
        `<resume>\n${describeResume(content)}\n</resume>`,
      ].join("\n\n"),
      schema: editPlanSchema,
      name: "resume_cuts",
      maxOutputTokens: 8_000,
    });
    usages.push(usage);
    const applied = applyEdits({
      base: content,
      master: input.master,
      facts: input.facts,
      keywords: input.keywords,
      edits: data.edits,
      allowed: CUT_OPS,
      dropReason: "to keep it to one page",
    });
    dropped.push(...applied.dropped);
    if (applied.changes.length === 0) break;
    changes.push(...applied.changes);
    content = applied.content;
    measured = await input.measure(content);
  }

  return { content, changes, dropped, usages, pages: measured.pages, loops };
}
