import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { AiError } from "@/lib/ai/types";

import { backendPosting, sweFacts, sweResume } from "./__fixtures__/people";
import {
  lineMeasure,
  noEdits,
  scriptedProvider,
} from "./__fixtures__/fake-provider";
import { tailor } from "./pipeline";
import { MAX_SUGGESTIONS, cleanSuggestions } from "./second-look";

/*
 * M8 §0.5: the second look reads the finished copy and writes notes. It
 * never edits: these tests check its notes are stored, that it's skipped
 * when there's nothing to look at, and (structurally, like
 * lib/ai/guard.test.ts) that its notes can't reach the edit step.
 */

const keywords = () => ({
  keywords: ["Python", "SQL", "REST APIs", "Git", "Redis", "Kubernetes"].map(
    (term) => ({
      term,
      importance: "required",
      kind: "hard_skill",
      variants: [],
    }),
  ),
});
const oneEdit = () => ({
  edits: [
    {
      op: "add_list_value",
      target: "s4.l2",
      text: "Kubernetes",
      order: [],
      fact: "",
      keyword: "Kubernetes",
    },
  ],
});
/** Notes phrased as orders, as a model might: they must stay notes. */
const bossyNotes = () => ({
  suggestions: [
    {
      what: "“Built a caching layer” could name Redis, which the Harbor Labs entry already lists.",
    },
    { what: "Change “C” to “C++” in Languages and add Kafka to Tools." },
    { what: "  " },
    { what: "Change “C” to “C++” in Languages and add Kafka to Tools." },
  ],
});

const input = {
  master: sweResume,
  facts: sweFacts,
  posting: backendPosting,
  research: null,
};
const measure = () => lineMeasure(40).measure;

describe("the second look", () => {
  it("runs last, on the fast tier, on plain text with no line ids, and its notes are kept", async () => {
    const { provider, calls } = scriptedProvider({
      posting_keywords: keywords,
      resume_edits: oneEdit,
      second_look: bossyNotes,
    });
    const result = await tailor(input, { provider, measure: measure() });

    expect(calls.map((c) => [c.name, c.tier])).toEqual([
      ["posting_keywords", "fast"],
      ["resume_edits", "strong"],
      ["second_look", "fast"],
    ]);
    const look = calls[2].input;
    expect(look).toContain("Kubernetes");
    expect(look).not.toMatch(/\[s\d/);
    expect(result.secondLook).toBe("done");
    expect(result.suggestions).toEqual([
      {
        what: "“Built a caching layer” could name Redis, which the Harbor Labs entry already lists.",
      },
      { what: "Change “C” to “C++” in Languages and add Kafka to Tools." },
    ]);
    // Its tokens count toward usage like any other call.
    expect(result.usage.inputTokens).toBe(3000);
  });

  it("never changes the copy, even when its notes read like orders", async () => {
    const withLook = scriptedProvider({
      posting_keywords: keywords,
      resume_edits: oneEdit,
      second_look: bossyNotes,
    });
    const without = scriptedProvider({
      posting_keywords: keywords,
      resume_edits: oneEdit,
      second_look: () => ({ suggestions: [] }),
    });
    const a = await tailor(input, {
      provider: withLook.provider,
      measure: measure(),
    });
    const b = await tailor(input, {
      provider: without.provider,
      measure: measure(),
    });
    expect(a.content).toEqual(b.content);
    expect(a.changes).toEqual(b.changes);
    expect(a.scoreAfter).toBe(b.scoreAfter);
    expect(JSON.stringify(a.content)).not.toContain("C++");
    expect(JSON.stringify(a.content)).not.toContain("Kafka");
  });

  it("is skipped when nothing changed, and when the posting is too short to score", async () => {
    const nothing = scriptedProvider({
      posting_keywords: keywords,
      resume_edits: noEdits,
      second_look: bossyNotes,
    });
    const r1 = await tailor(input, {
      provider: nothing.provider,
      measure: measure(),
    });
    expect(r1.changes).toEqual([]);
    expect(r1.secondLook).toBe("skipped");
    expect(r1.suggestions).toEqual([]);
    expect(nothing.calls.map((c) => c.name)).not.toContain("second_look");

    const short = scriptedProvider({ second_look: bossyNotes });
    const r2 = await tailor(
      {
        ...input,
        posting: { ...backendPosting, text: "Backend intern. Python." },
      },
      { provider: short.provider, measure: measure() },
    );
    expect(r2.secondLook).toBe("skipped");
    expect(short.calls).toEqual([]);
  });

  it("a failed second look (a 429 on the shared key) still ships the tailoring", async () => {
    const { provider } = scriptedProvider({
      posting_keywords: keywords,
      resume_edits: oneEdit,
      second_look: () => {
        throw new AiError("rate_limited", "busy", 429);
      },
    });
    const result = await tailor(input, { provider, measure: measure() });
    expect(result.secondLook).toBe("failed");
    expect(result.suggestions).toEqual([]);
    expect(result.changes.length).toBe(1);
  });

  it("notes are trimmed, deduplicated, capped in count and length", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ what: `Note ${i}` }));
    expect(cleanSuggestions(many)).toHaveLength(MAX_SUGGESTIONS);
    const long = cleanSuggestions([{ what: "x".repeat(1000) }])[0].what;
    expect(long.length).toBe(400);
    expect(long.endsWith("…")).toBe(true);
    expect(cleanSuggestions([{ what: " a \n b " }, { what: "A B" }])).toEqual([
      { what: "a b" },
    ]);
  });
});

// ---------------------------------------------------------------- structure

const ROOT = join(__dirname, "..", "..");
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (
      [
        "node_modules",
        ".next",
        ".git",
        "docs",
        "supabase",
        "e2e",
        "test-results",
      ].includes(name)
    )
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
      out.push(path);
  }
  return out;
}
const files = sources(ROOT).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

describe("the second look can't feed the edit step (structure)", () => {
  it("second-look.ts imports nothing that edits a resume", () => {
    const text = files.find(
      (f) => f.path === "lib/tailor/second-look.ts",
    )!.text;
    expect(text).not.toMatch(/from "\.\/(edits|fit|trace|view)"/);
    expect(text).not.toMatch(/applyEdits|fitOnePage|ResumeContent/);
  });

  it("no file that applies edits reads suggestions, except the pipeline, where every edit comes before the second look", () => {
    const editors = files.filter((f) =>
      /\b(applyEdits|fitOnePage)\(/.test(f.text),
    );
    expect(editors.map((f) => f.path).sort()).toEqual([
      "lib/tailor/edits.ts",
      "lib/tailor/fit.ts",
      "lib/tailor/pipeline.ts",
    ]);
    for (const f of editors) {
      if (f.path === "lib/tailor/pipeline.ts") continue;
      expect(f.text).not.toMatch(/suggestion|secondLook/i);
    }
    const pipeline = files.find(
      (f) => f.path === "lib/tailor/pipeline.ts",
    )!.text;
    const look = pipeline.indexOf("await secondLook(");
    expect(look).toBeGreaterThan(0);
    const after = pipeline.slice(look);
    expect(after).not.toMatch(/applyEdits\(|fitOnePage\(|content = /);
  });

  it("only the pipeline, the review page's component and its query use the second look", () => {
    const users = files
      .filter((f) => /tailor\/second-look"|\.\/second-look"/.test(f.text))
      .map((f) => f.path)
      .sort();
    expect(users).toEqual([
      "components/review/second-look.tsx",
      "lib/tailor/pipeline.ts",
      "lib/tailor/queries.ts",
    ]);
  });
});
