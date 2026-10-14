import { describe, expect, it, vi } from "vitest";

import { backendPosting, sweFacts, sweResume } from "./__fixtures__/people";
import {
  lineMeasure,
  noEdits,
  scriptedProvider,
} from "./__fixtures__/fake-provider";
import { NOTES, tailor } from "./pipeline";

/*
 * If the edit applier ever had a bug that let an invented line through, the
 * pipeline's whole-copy check must catch it and ship the master resume. A
 * broken applier is simulated here; the real one is tested in
 * edits.test.ts and never-fabricates.test.ts.
 */
vi.mock("./edits", async (importOriginal) => {
  const real = await importOriginal<typeof import("./edits")>();
  return {
    ...real,
    applyEdits: (input: Parameters<typeof real.applyEdits>[0]) => {
      const result = real.applyEdits(input);
      const content = structuredClone(result.content);
      const projects = content.sections[2];
      if (projects.layout === "entries") {
        projects.items[0].bullets.push("Scaled it to 10,000 users on AWS");
      }
      return {
        ...result,
        content,
        changes: [
          { what: "Added a bullet", why: "the posting asks for “AWS”" },
        ],
      };
    },
  };
});

describe("tailor: the final check", () => {
  it("anything untraceable in the finished copy → the master ships, with a note", async () => {
    const { provider } = scriptedProvider({
      posting_keywords: () => ({
        keywords: ["Python", "SQL", "AWS", "Git", "Redis"].map((term) => ({
          term,
          importance: "required",
          kind: "hard_skill",
          variants: [],
        })),
      }),
      resume_edits: noEdits,
    });
    const result = await tailor(
      {
        master: sweResume,
        facts: sweFacts,
        posting: backendPosting,
        research: null,
      },
      { provider, measure: lineMeasure(40).measure },
    );
    expect(result.content).toEqual(sweResume);
    expect(result.changes).toEqual([]);
    expect(result.notes).toEqual([NOTES.blocked]);
    expect(result.blocked).toEqual([
      "bullet “Scaled it to 10,000 users on AWS” has words that aren't the user's",
    ]);
  });
});
