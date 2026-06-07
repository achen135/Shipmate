import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { lineMeasure, scriptedProvider } from "./__fixtures__/fake-provider";
import { assertNothingInvented } from "./__fixtures__/invented";
import { PEOPLE } from "./__fixtures__/people";
import { tailor } from "./pipeline";

/*
 * Hard rule 2 against real model answers, not only made-up ones (Fix
 * Handoff "merge-with-facts retest"). Each recording is what Gemini Flash
 * actually returned for one of the fictional PEOPLE, through the two-call
 * flow (keywords, then edits) or the one-call flow (both at once). Replayed
 * through the same pipeline, every one must pass never-fabricates.test.ts's
 * own independent check, and the code must still make the same changes and
 * drop the same edits it did on the day.
 */

type Recording = {
  person: string;
  approach: "two-call" | "one-call";
  rep: number;
  outputs: Record<string, unknown>;
  expected: {
    changes: unknown[];
    dropped: unknown[];
    scoreBefore: number | null;
    scoreAfter: number | null;
  };
};

const recorded = JSON.parse(
  readFileSync(
    join(__dirname, "__fixtures__/recorded/merge-with-facts.json"),
    "utf8",
  ),
) as { runs: Recording[] };

describe("recorded real answers: nothing invented, either approach", () => {
  it("has recordings for every person and both approaches", () => {
    for (const person of PEOPLE) {
      for (const approach of ["two-call", "one-call"]) {
        expect(
          recorded.runs.some(
            (r) => r.person === person.name && r.approach === approach,
          ),
          `${person.name} ${approach}`,
        ).toBe(true);
      }
    }
  });

  it.each(recorded.runs.map((r) => [`${r.person} #${r.rep} ${r.approach}`, r]))(
    "%s",
    async (_, run) => {
      const person = PEOPLE.find((p) => p.name === run.person)!;
      const { provider } = scriptedProvider(
        Object.fromEntries(
          Object.entries({
            second_look: { suggestions: [] },
            ...run.outputs,
          }).map(([name, answer]) => [name, () => answer]),
        ),
      );
      const result = await tailor(
        {
          master: person.resume,
          facts: [...person.facts],
          posting: person.posting,
          research: null,
        },
        {
          provider,
          measure: lineMeasure(40).measure,
          mergeScoreAndEdit: run.approach === "one-call",
        },
      );
      expect(result.blocked).toEqual([]);
      assertNothingInvented(person, result.content);
      expect(result.changes).toEqual(run.expected.changes);
      expect(result.dropped).toEqual(run.expected.dropped);
      expect(result.scoreBefore).toBe(run.expected.scoreBefore);
      expect(result.scoreAfter).toBe(run.expected.scoreAfter);
    },
  );
});
