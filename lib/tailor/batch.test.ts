import { describe, expect, it } from "vitest";

import { assertNothingInvented } from "./__fixtures__/invented";
import {
  backendPosting,
  dataPosting,
  supplyPosting,
  sweFacts,
  sweResume,
} from "./__fixtures__/people";
import { lineMeasure, scriptedProvider } from "./__fixtures__/fake-provider";
import { attribute, tailorBatch } from "./batch";
import { NOTES, tailor } from "./pipeline";
import {
  BATCH_EDIT_SYSTEM,
  BATCH_KEYWORDS_SYSTEM,
  EDIT_SYSTEM,
  KEYWORDS_SYSTEM,
} from "./prompts";

const k = (
  term: string,
  importance: "required" | "preferred" = "required",
  alternatives: string[] = [],
) => ({ term, importance, kind: "hard_skill", variants: [], alternatives });

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

// One person (Jordan, SWE) and three postings, each with its own answers.
const answers = {
  backend: {
    keywords: [
      k("Python"),
      k("SQL"),
      k("REST APIs"),
      k("Git"),
      k("Redis", "preferred"),
      k("Kubernetes", "preferred", ["Kafka", "Go", "C++"]),
      k("Celery", "preferred"),
    ],
    edits: [
      e("reword_bullet", "s2.e1.b1", {
        text: "Built a Redis caching layer for the pricing API that cut p95 latency by 40%",
        keyword: "Redis",
      }),
      e("add_list_value", "s4.l2", { text: "Kubernetes", fact: "f1" }),
      e("add_bullet", "s2.e1", {
        text: "Ran background jobs with Celery workers at Harbor Labs",
        fact: "f2",
        keyword: "Celery",
      }),
    ],
  },
  data: {
    keywords: [
      k("Python"),
      k("pandas"),
      k("SQL"),
      k("statistics"),
      k("LightGBM", "preferred", ["XGBoost", "scikit-learn"]),
    ],
    edits: [e("order_list_values", "s4.l1", { order: ["Python", "SQL"] })],
  },
  supply: {
    keywords: [k("Excel"), k("SQL"), k("SAP", "preferred"), k("Tableau")],
    edits: [e("order_list_values", "s4.l1", { order: ["SQL", "Python"] })],
  },
};

const postings = [
  { id: "row-backend", posting: backendPosting, research: null },
  { id: "row-data", posting: dataPosting, research: null },
  { id: "row-supply", posting: supplyPosting, research: null },
];
const order = ["backend", "data", "supply"] as const;
const batchInput = { master: sweResume, facts: sweFacts, postings };
const jordan = (posting: { title: string; text: string }) => ({
  resume: sweResume,
  facts: sweFacts,
  posting,
});

/** Which of the three postings a one-posting request is about. */
const about = (input: string) =>
  order[postings.findIndex((p) => input.includes(`Title: ${p.posting.title}`))];

/**
 * The answers: one keyword request per posting, or one for the batch (items
 * in the given order and under the given ids), and the batch's edits.
 */
const batchScript = (
  ids: string[] = ["p1", "p2", "p3"],
  edit: (name: (typeof order)[number]) => unknown[] = (n) => answers[n].edits,
) => ({
  posting_keywords: (input: string) => ({
    keywords: answers[about(input)].keywords,
  }),
  batch_posting_keywords: () => ({
    postings: ids.map((id) => ({
      id,
      keywords: answers[order[Number(id.slice(1)) - 1]].keywords,
    })),
  }),
  batch_resume_edits: () => ({
    postings: ids.map((id) => ({
      id,
      edits: edit(order[Number(id.slice(1)) - 1]),
    })),
  }),
});

const SAME = [
  "content",
  "changes",
  "dropped",
  "blocked",
  "scoreBefore",
  "scoreAfter",
  "matched",
  "missing",
  "warnings",
  "notes",
] as const;

describe("tailorBatch: several postings, one edit request", () => {
  it("asks for each posting's keywords as one-posting tailoring does, then once for all the edits, and each result is what one-posting tailoring makes of the same answers", async () => {
    const batch = scriptedProvider(batchScript());
    const run = await tailorBatch(batchInput, {
      provider: batch.provider,
      measure: lineMeasure(40).measure,
    });

    expect(batch.calls.map((c) => [c.name, c.tier])).toEqual([
      ["posting_keywords", "strong"],
      ["posting_keywords", "strong"],
      ["posting_keywords", "strong"],
      ["batch_resume_edits", "strong"],
    ]);
    // Exactly the one-posting keyword request.
    const one = scriptedProvider({
      posting_keywords: () => answers.backend,
      resume_edits: () => ({ edits: [] }),
    });
    await tailor(
      { ...batchInput, posting: backendPosting, research: null },
      { provider: one.provider, measure: lineMeasure(40).measure },
    );
    expect(batch.calls[0].input).toBe(one.calls[0].input);
    expect(batch.calls[0].system).toBe(one.calls[0].system);
    // The resume and facts once; each posting's tags under its own id.
    const editInput = batch.calls[3].input;
    expect(editInput.match(/<resume>/g)).toHaveLength(1);
    expect(editInput.match(/<facts>/g)).toHaveLength(1);
    for (const id of ["p1", "p2", "p3"]) {
      expect(editInput).toContain(`<posting id="${id}">`);
      expect(editInput).toContain(`<keywords id="${id}">`);
      expect(editInput).toContain(`<company id="${id}">`);
    }
    expect(run.problems).toEqual([]);
    expect(run.usage).toHaveLength(4);
    expect(run.outcomes.map((o) => [o.id, o.status])).toEqual(
      postings.map((p) => [p.id, "done"]),
    );

    for (const [i, name] of order.entries()) {
      const one = scriptedProvider({
        posting_keywords: () => ({ keywords: answers[name].keywords }),
        resume_edits: () => ({ edits: answers[name].edits }),
      });
      const alone = await tailor(
        { ...batchInput, posting: postings[i].posting, research: null },
        { provider: one.provider, measure: lineMeasure(40).measure },
      );
      const outcome = run.outcomes[i];
      if (outcome.status !== "done") throw new Error("not done");
      for (const key of SAME) expect(outcome.result[key]).toEqual(alone[key]);
      expect(outcome.result.changes.length).toBeGreaterThan(0);
      assertNothingInvented(
        jordan(postings[i].posting),
        outcome.result.content,
      );
    }
  });

  it("matches answers by id, not by order", async () => {
    const shuffled = scriptedProvider(batchScript(["p3", "p1", "p2"]));
    const inOrder = scriptedProvider(batchScript());
    const a = await tailorBatch(batchInput, {
      provider: shuffled.provider,
      measure: lineMeasure(40).measure,
    });
    const b = await tailorBatch(batchInput, {
      provider: inOrder.provider,
      measure: lineMeasure(40).measure,
    });
    expect(a.problems).toEqual([]);
    expect(a.outcomes).toEqual(b.outcomes);
  });

  it('keywords: "batch" asks twice in all, and gives the same results for the same answers', async () => {
    const twice = scriptedProvider(batchScript());
    const each = scriptedProvider(batchScript());
    const a = await tailorBatch(batchInput, {
      provider: twice.provider,
      measure: lineMeasure(40).measure,
      keywords: "batch",
    });
    const b = await tailorBatch(batchInput, {
      provider: each.provider,
      measure: lineMeasure(40).measure,
    });
    expect(twice.calls.map((c) => c.name)).toEqual([
      "batch_posting_keywords",
      "batch_resume_edits",
    ]);
    expect(a.outcomes).toEqual(b.outcomes);
  });

  it("a posting the edit answer leaves out, or answers twice, is left to tailor alone", async () => {
    const { provider } = scriptedProvider({
      ...batchScript(),
      batch_resume_edits: () => ({
        postings: [
          { id: "p1", edits: answers.backend.edits },
          { id: "p3", edits: answers.supply.edits },
          { id: "p3", edits: answers.data.edits },
        ],
      }),
    });
    const run = await tailorBatch(batchInput, {
      provider,
      measure: lineMeasure(40).measure,
    });
    expect(run.outcomes.map((o) => o.status)).toEqual([
      "done",
      "alone",
      "alone",
    ]);
    expect(run.problems).toEqual([
      "posting p2 not answered",
      "posting p3 answered 2 times",
    ]);
  });

  it("a posting answered twice or not at all is left to tailor alone; an unknown id is ignored", async () => {
    const { provider } = scriptedProvider({
      batch_posting_keywords: () => ({
        postings: [
          { id: "p1", keywords: answers.backend.keywords },
          { id: "p1", keywords: answers.data.keywords },
          { id: "p3", keywords: answers.supply.keywords },
          { id: "p9", keywords: answers.data.keywords },
        ],
      }),
      batch_resume_edits: () => ({
        postings: [{ id: "p3", edits: answers.supply.edits }],
      }),
    });
    const run = await tailorBatch(batchInput, {
      provider,
      measure: lineMeasure(40).measure,
      keywords: "batch",
    });
    expect(run.outcomes.map((o) => o.status)).toEqual([
      "alone",
      "alone",
      "done",
    ]);
    expect(run.problems).toEqual([
      'an answer for unknown posting "p9"',
      "posting p1 answered 2 times",
      "posting p2 not answered",
    ]);
  });

  it("an edit carried over from another posting can't add what the person doesn't have", async () => {
    // The data posting's edits come back with the backend posting's, plus a
    // skill from a third posting that Jordan doesn't have (Tableau).
    const { provider } = scriptedProvider(
      batchScript(undefined, (name) =>
        name === "data"
          ? [
              ...answers.backend.edits,
              e("add_list_value", "s4.l2", {
                text: "Tableau",
                keyword: "Tableau",
              }),
            ]
          : answers[name].edits,
      ),
    );
    const run = await tailorBatch(batchInput, {
      provider,
      measure: lineMeasure(40).measure,
    });
    const data = run.outcomes[1];
    if (data.status !== "done") throw new Error("not done");
    expect(JSON.stringify(data.result.content)).not.toContain("Tableau");
    expect(data.result.dropped.map((d) => d.op)).toContain("add_list_value");
    // Jordan's own Redis and Celery are true, so the checks keep them; the
    // change list then says no posting keyword asked for them.
    for (const change of data.result.changes) {
      expect(change.why).not.toMatch(/asks for “(Redis|Celery)”/);
    }
    for (const [i, outcome] of run.outcomes.entries()) {
      if (outcome.status !== "done") throw new Error("not done");
      assertNothingInvented(
        jordan(postings[i].posting),
        outcome.result.content,
      );
    }
  });

  it("a posting with too little text is tailored with no request, as alone", async () => {
    const { provider, calls } = scriptedProvider(batchScript(["p1", "p2"]));
    const run = await tailorBatch(
      {
        ...batchInput,
        postings: [
          postings[0],
          postings[1],
          {
            id: "row-short",
            posting: { title: "Intern", company: "X", text: "Apply now." },
            research: null,
          },
        ],
      },
      { provider, measure: lineMeasure(40).measure },
    );
    expect(calls.map((c) => c.name)).toEqual([
      "posting_keywords",
      "posting_keywords",
      "batch_resume_edits",
    ]);
    expect(calls[2].input).not.toContain('id="p3"');
    const short = run.outcomes[2];
    if (short.status !== "done") throw new Error("not done");
    expect(short.result.notes).toEqual([NOTES.noText]);
    expect(short.result.content).toEqual(sweResume);
  });
});

describe("attribute", () => {
  it("trims ids, and reports each problem once", () => {
    const { byId, problems } = attribute(
      ["p1", "p2"],
      [{ id: " p1 " }, { id: "p2" }, { id: "p2" }, { id: "x" }, { id: "x" }],
    );
    expect([...byId.keys()]).toEqual(["p1"]);
    expect(problems).toEqual([
      'an answer for unknown posting "x"',
      "posting p2 answered 2 times",
    ]);
  });
});

describe("batch prompts: the one-posting rules, word for word", () => {
  it("carry the keyword rules and the edit operations unchanged", () => {
    const keywordRules = KEYWORDS_SYSTEM.slice(
      KEYWORDS_SYSTEM.indexOf("Three kinds of keyword"),
    ).trim();
    const operations = EDIT_SYSTEM.slice(
      EDIT_SYSTEM.indexOf("   - order_list_values"),
      EDIT_SYSTEM.indexOf("5. Keep it one page"),
    ).trim();
    const never = EDIT_SYSTEM.slice(EDIT_SYSTEM.indexOf("Never: rename"));
    expect(BATCH_KEYWORDS_SYSTEM).toContain(keywordRules);
    expect(BATCH_EDIT_SYSTEM).toContain(operations);
    expect(BATCH_EDIT_SYSTEM).toContain(never.slice(0, never.indexOf("\n\n")));
    // And each tells the model to keep postings apart.
    expect(BATCH_KEYWORDS_SYSTEM).toMatch(/never from another posting/);
    expect(BATCH_EDIT_SYSTEM).toMatch(
      /never carry a keyword, an edit or a reason from one posting to another/,
    );
  });
});
