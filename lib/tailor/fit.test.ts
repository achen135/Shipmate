import { describe, expect, it } from "vitest";

import { sweFacts, sweResume } from "./__fixtures__/people";
import { lineMeasure, scriptedProvider } from "./__fixtures__/fake-provider";
import { fitOnePage } from "./fit";

/*
 * sweResume is 18 lines by lineMeasure: 4 sections, 4 entries, 8 bullets,
 * 2 list lines.
 */
const drop = (target: string) => ({
  op: "drop_bullet",
  target,
  text: "",
  order: [],
  fact: "",
  keyword: "",
});

const base = {
  content: sweResume,
  master: sweResume,
  facts: sweFacts,
  keywords: [],
};

describe("the one-page loop", () => {
  it("fits already: no model call", async () => {
    const { provider, calls } = scriptedProvider({});
    const result = await fitOnePage({
      ...base,
      provider,
      measure: lineMeasure(18).measure,
    });
    expect(result).toMatchObject({ pages: 1, loops: 0, changes: [] });
    expect(calls).toEqual([]);
  });

  it("overflows once, fits after one cut", async () => {
    const { provider, calls } = scriptedProvider({
      resume_cuts: () => ({ edits: [drop("s2.e2.b2")] }),
    });
    const { measure, measured } = lineMeasure(17);
    const result = await fitOnePage({ ...base, provider, measure });
    expect(result.pages).toBe(1);
    expect(result.loops).toBe(1);
    expect(measured).toEqual([18, 17]);
    expect(calls.map((c) => c.name)).toEqual(["resume_cuts"]);
    expect(calls[0].input).toContain("<overflow>");
    expect(result.changes[0].why).toBe("to keep it to one page");
  });

  it("still over after two cuts: stops there and ships it (the pipeline adds a note)", async () => {
    const { provider, calls } = scriptedProvider({
      resume_cuts: (_input, call) => ({
        edits: [drop(call === 0 ? "s2.e2.b2" : "s2.e2.b1")],
      }),
    });
    const { measure, measured } = lineMeasure(10);
    const result = await fitOnePage({ ...base, provider, measure });
    expect(result.pages).toBe(2);
    expect(result.loops).toBe(2);
    expect(calls).toHaveLength(2);
    expect(measured).toEqual([18, 17, 16]);
  });

  it("a cut round that adds instead of drops changes nothing and stops", async () => {
    const { provider, calls } = scriptedProvider({
      resume_cuts: () => ({
        edits: [
          {
            ...drop("s4.l2"),
            op: "add_list_value",
            text: "Kubernetes",
          },
        ],
      }),
    });
    const result = await fitOnePage({
      ...base,
      provider,
      measure: lineMeasure(10).measure,
    });
    expect(calls).toHaveLength(1);
    expect(result.content).toEqual(sweResume);
    expect(result.dropped[0].reason).toBe("not allowed at this step");
  });
});
