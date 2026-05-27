import { MODELS } from "@/lib/ai/models";
import type { AiProvider, StructuredRequest, Tier } from "@/lib/ai/types";
import type { ResumeContent } from "@/lib/resume/structured";

/**
 * A stand-in AI provider for tailoring tests: each step (by schema name:
 * posting_keywords, resume_edits, resume_cuts) answers from a script. The
 * answer is parsed with the request's own schema, as real structured output
 * would be, so a script can't hand the pipeline something a real model
 * couldn't. Each answer names the model Gemini's tier really uses (Flash-Lite
 * for the fast tier, Flash for edits).
 */
export type Script = Partial<
  Record<string, (input: string, call: number) => unknown>
>;

export function scriptedProvider(
  script: Script,
  options: { shared?: boolean } = {},
) {
  const calls: { name: string; tier: Tier; input: string; system: string }[] =
    [];
  const provider: AiProvider = {
    name: "google",
    shared: options.shared ?? false,
    async testKey() {},
    async generateStructured<T>(request: StructuredRequest<T>) {
      const step = script[request.name];
      if (!step) throw new Error(`no script for ${request.name}`);
      const count = calls.filter((c) => c.name === request.name).length;
      calls.push({
        name: request.name,
        tier: request.tier,
        input: request.input,
        system: request.system,
      });
      const data = request.schema.parse(step(request.input, count));
      return {
        data,
        usage: {
          provider: "google" as const,
          model: MODELS.google[request.tier].id,
          inputTokens: 1000,
          outputTokens: 500,
        },
      };
    },
  };
  return { provider, calls };
}

/** Pages by line count: every section, entry, bullet and list line is a line. */
export function lineMeasure(linesPerPage: number) {
  const measured: number[] = [];
  const measure = async (content: ResumeContent) => {
    let lines = 0;
    for (const section of content.sections) {
      lines += 1;
      if (section.layout === "entries") {
        for (const e of section.items) lines += 1 + e.bullets.length;
      } else if (section.layout === "list") {
        lines += section.items.length;
      } else {
        lines += 2;
      }
    }
    measured.push(lines);
    return {
      pages: Math.ceil(lines / linesPerPage),
      overflow: Math.max(0, lines / linesPerPage - 1),
    };
  };
  return { measure, measured };
}

export const noEdits = () => ({ edits: [] });
