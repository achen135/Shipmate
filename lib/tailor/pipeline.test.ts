import { describe, expect, it } from "vitest";

import {
  backendPosting,
  opsFacts,
  opsResume,
  supplyPosting,
  sweFacts,
  sweResume,
} from "./__fixtures__/people";
import {
  lineMeasure,
  noEdits,
  scriptedProvider,
} from "./__fixtures__/fake-provider";
import { STILL_LONG_NOTE } from "./fit";
import { NOTES, tailor } from "./pipeline";

const k = (
  term: string,
  importance: "required" | "preferred" = "required",
  variants: string[] = [],
) => ({ term, importance, kind: "hard_skill", variants });

const backendKeywords = () => ({
  keywords: [
    k("Python"),
    k("SQL"),
    k("REST APIs", "required", ["REST API"]),
    k("Git"),
    k("Redis", "preferred"),
    k("Kafka", "preferred"),
    k("Kubernetes", "preferred"),
    k("Docker", "preferred"),
    k("AWS", "preferred"),
    k("PostgreSQL", "preferred"),
    k("Celery", "preferred"),
    k("Rust"), // not in the posting: dropped by verifyKeywords
  ],
});

const e = (
  op: string,
  target: string,
  extra: {
    text?: string;
    order?: string[];
    fact?: string;
    keyword?: string;
  } = {},
) => ({ op, target, text: "", order: [], fact: "", keyword: "", ...extra });

const honestEdits = () => ({
  edits: [
    e("reword_bullet", "s2.e1.b1", {
      text: "Built a Redis caching layer for the pricing API that cut p95 latency by 40%",
      keyword: "Redis",
    }),
    e("add_list_value", "s4.l2", { text: "Kubernetes", keyword: "Kubernetes" }),
    e("order_list_values", "s4.l1", { order: ["Python", "SQL"] }),
    e("add_bullet", "s2.e1", {
      text: "Ran background jobs with Celery workers at Harbor Labs",
      fact: "f2",
      keyword: "Celery",
    }),
  ],
});

const input = {
  master: sweResume,
  facts: sweFacts,
  posting: backendPosting,
  research: { summary: "Logistics software.", values: [], tech: ["Go"] },
};

describe("tailor: the pipeline end to end (fake model, fake page measure)", () => {
  it("scores, edits from the master, re-scores, and reports in plain English", async () => {
    const { provider, calls } = scriptedProvider({
      posting_keywords: backendKeywords,
      resume_edits: honestEdits,
    });
    const result = await tailor(input, {
      provider,
      measure: lineMeasure(40).measure,
    });

    expect(calls.map((c) => [c.name, c.tier])).toEqual([
      ["posting_keywords", "fast"],
      ["resume_edits", "strong"],
    ]);
    // The edit step sees the master resume with ids, the gap, and the facts.
    const editInput = calls[1].input;
    expect(editInput).toContain(
      "[s2.e1.b1] Built a caching layer for the pricing API that cut p95 latency by 40%",
    );
    expect(editInput).toContain("- Kafka — preferred, hard skill: MISSING");
    expect(editInput).toContain(
      "- Kubernetes — preferred, hard skill: IN FACTS f1",
    );
    expect(editInput).toContain("- Python — required, hard skill: ON RESUME");
    expect(editInput).toContain("Technologies: Go");
    expect(editInput).not.toContain("Rust");

    // Weighted: 11 of 15 before (Redis is in the Harbor Labs subheading), 13 after.
    expect(result.scoreBefore).toBe(73);
    expect(result.scoreAfter).toBe(87);
    expect(result.scoreAfter!).toBeGreaterThan(result.scoreBefore!);
    expect(result.matched).toEqual(
      expect.arrayContaining(["Python", "Redis", "Kubernetes", "Celery"]),
    );
    // In neither the resume nor the facts: a skills gap, never added.
    expect(result.missing).toEqual(["Kafka", "AWS"]);
    expect(result.warnings).toEqual([
      {
        kind: "skills_gap",
        message:
          "The posting asks for Kafka, AWS, which isn't on your resume or in your profile facts. Shipmate didn't add them. If you have any of them, add them to your profile facts.",
      },
    ]);
    expect(result.changes.map((c) => c.what)).toEqual([
      "Reworded a bullet under Harbor Labs to mention “Redis”",
      "Added “Kubernetes” to Tools",
      "Added a bullet under Harbor Labs: “Ran background jobs with Celery workers at Harbor Labs”",
      "Put Languages in a new order, starting with “Python”, “SQL”, “TypeScript”",
    ]);
    expect(result.notes).toEqual([]);
    expect(result.blocked).toEqual([]);
    expect(result.content.sections.map((s) => s.title)).toEqual(
      sweResume.sections.map((s) => s.title),
    );
  });

  it("counts tokens across calls; the shared free key costs nothing, an own key its list price", async () => {
    const script = { posting_keywords: backendKeywords, resume_edits: noEdits };
    const shared = await tailor(input, {
      provider: scriptedProvider(script, { shared: true }).provider,
      measure: lineMeasure(40).measure,
    });
    expect(shared.usage).toEqual({
      provider: "google",
      model: "gemini-3.8-flash",
      inputTokens: 2000,
      outputTokens: 1000,
      costUsd: 0,
    });
    const own = await tailor(input, {
      provider: scriptedProvider(script).provider,
      measure: lineMeasure(40).measure,
    });
    // 2 × (1000 × $0.75 + 500 × $3.75) / 1M
    expect(own.usage.costUsd).toBeCloseTo(0.00525, 6);
    expect(own.notes).toEqual([NOTES.nothing]);
  });

  it("too little posting text: no AI calls, no made-up score, a note", async () => {
    const { provider, calls } = scriptedProvider({});
    const result = await tailor(
      { ...input, posting: { ...backendPosting, text: "Apply on our site." } },
      { provider, measure: lineMeasure(40).measure },
    );
    expect(calls).toEqual([]);
    expect(result).toMatchObject({
      content: sweResume,
      scoreBefore: null,
      scoreAfter: null,
      notes: [NOTES.noText],
      usage: { inputTokens: 0, costUsd: 0 },
    });
  });

  it("over one page after two trims: still ships, with a note", async () => {
    const { provider } = scriptedProvider({
      posting_keywords: backendKeywords,
      resume_edits: noEdits,
      resume_cuts: (_input, call) => ({
        edits: [e("drop_bullet", call === 0 ? "s2.e2.b2" : "s2.e2.b1")],
      }),
    });
    const result = await tailor(input, {
      provider,
      measure: lineMeasure(10).measure,
    });
    expect(result.notes).toEqual([STILL_LONG_NOTE]);
    expect(result.changes).toHaveLength(2);
  });

  it("a weak match warns plainly and still ships the best version (hard rule 3)", async () => {
    const { provider } = scriptedProvider({
      posting_keywords: () => ({
        keywords: [
          k("SQL"),
          k("SAP"),
          k("demand forecasts"),
          k("stakeholder management"),
          k("Six Sigma", "preferred"),
          k("Excel"),
        ],
      }),
      resume_edits: () => ({
        edits: [e("add_list_value", "s4.l1", { text: "SQL", keyword: "SQL" })],
      }),
    });
    const result = await tailor(
      {
        master: opsResume,
        facts: opsFacts,
        posting: supplyPosting,
        research: null,
      },
      { provider, measure: lineMeasure(40).measure },
    );
    expect(result.scoreAfter).toBe(36);
    expect(result.warnings.map((w) => w.kind)).toEqual([
      "skills_gap",
      "low_score",
    ]);
    expect(result.warnings[1].message).toBe(
      "This doesn't look like a strong match: your resume has 36% of what the posting asks for, and not SAP, demand forecasts, stakeholder management. Shipmate still made the best version it could.",
    );
    expect(result.content).not.toEqual(opsResume);
  });
});
