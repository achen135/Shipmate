import { describe, expect, it } from "vitest";

import { EFFORT, MODELS, SHARED_BACKUP_MODEL, estimateStep } from "./models";

describe("model tiers (Alex, 2026-10-14: edits on the cheaper model)", () => {
  it("strong uses the same models and effort as fast on Anthropic and OpenAI", () => {
    expect(MODELS.anthropic.strong.id).toBe(MODELS.anthropic.fast.id);
    expect(MODELS.openai.strong.id).toBe(MODELS.openai.fast.id);
    expect(EFFORT.strong).toBe(EFFORT.fast);
  });

  it("Google: Flash scores and edits, Flash-Lite does the rest, and is the backup (Alex, 2026-10-17)", () => {
    expect(MODELS.google.strong.id).toBe("gemini-3.8-flash");
    expect(MODELS.google.fast.id).toBe("gemini-3.5-flash-lite");
    expect(SHARED_BACKUP_MODEL.id).toBe(MODELS.google.fast.id);
  });

  it("one tailored posting costs about $0.13-0.25 on either paid provider, second look included", () => {
    for (const provider of ["anthropic", "openai"] as const) {
      const { low, high } = estimateStep(provider, "tailor");
      expect(low).toBeCloseTo(0.121, 3);
      expect(high).toBeCloseTo(0.242, 3);
    }
  });
});
