// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { AiProvider, StructuredRequest } from "@/lib/ai/types";

import { EXTRACT_SYSTEM, suggestFacts, traces } from "./extract";

const cv = `Priya Natarajan — Curriculum Vitae
Teaching: Undergraduate TA for Signals and Systems, Spring 2026.
Skills: MATLAB, Python, LabVIEW, KiCad, soldering.
Awards: Lakeshore Research Day best poster, 2026.`;

function provider(facts: { kind: string; text: string; detail: string }[]) {
  const seen: StructuredRequest<unknown>[] = [];
  const p: AiProvider = {
    name: "openai",
    testKey: async () => {},
    async generateStructured<T>(request: StructuredRequest<T>) {
      seen.push(request as StructuredRequest<unknown>);
      return {
        data: request.schema.parse({ facts }) as T,
        usage: {
          provider: "openai",
          model: "gpt-6.1-sol",
          inputTokens: 1,
          outputTokens: 1,
        },
      };
    },
  };
  return { p, seen };
}

describe("suggestFacts", () => {
  it("flags suggestions that aren't in the file, and drops duplicates", async () => {
    const { p, seen } = provider([
      { kind: "skill", text: "LabVIEW", detail: "" },
      { kind: "skill", text: "labview", detail: "" },
      {
        kind: "award",
        text: "Lakeshore Research Day best poster",
        detail: "2026",
      },
      { kind: "skill", text: "Kubernetes and Terraform", detail: "" },
    ]);
    const { suggestions } = await suggestFacts(p, "Resume: MATLAB, Python", cv);
    expect(suggestions.map((s) => [s.text, s.traced])).toEqual([
      ["LabVIEW", true],
      ["Lakeshore Research Day best poster", true],
      ["Kubernetes and Terraform", false],
    ]);
    expect(seen[0].system).toBe(EXTRACT_SYSTEM);
    expect(seen[0].input).toContain("<document>");
    expect(seen[0].tier).toBe("fast");
  });

  it("the instructions forbid inventing", () => {
    expect(EXTRACT_SYSTEM).toMatch(/Never infer, embellish, combine or guess/);
  });
});

describe("traces", () => {
  it("needs the words to be in the document", () => {
    expect(traces("Undergraduate TA for Signals and Systems", cv)).toBe(true);
    expect(traces("Head TA for Machine Learning", cv)).toBe(false);
    expect(traces("", cv)).toBe(false);
  });
});
