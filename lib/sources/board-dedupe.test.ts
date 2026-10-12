// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildState, planSource } from "@/lib/postings/plan";

import fixture from "./__fixtures__/greenhouse-stripe.json";
import ashbyFixture from "./__fixtures__/ashby-ramp.json";
import { parseAshbyJobs } from "./ashby";
import { greenhouseConfigSchema, parseGreenhouseJobs } from "./greenhouse";
import { parseSimplifyListings, simplifyConfigSchema } from "./simplify";

/*
 * A job that Simplify lists AND the company's own board lists must be one
 * posting with two links, keeping the board's fuller description. Nothing in
 * dedupe knows about boards; this proves the adapters' output is enough.
 */

const NOW = "2026-10-12T20:00:00.000Z";
let ids = 0;
const newId = () => `id-${(ids += 1)}`;

const boardRows = parseGreenhouseJobs(
  fixture,
  greenhouseConfigSchema.parse({ slug: "stripe", company: "Stripe" }),
).rows;

// Simplify's row for the first Stripe job: same Greenhouse job, a different
// id and URL spelling, and no description (Simplify never has one).
const simplifyRows = parseSimplifyListings(
  [
    {
      id: "0b6c1f1e-2b6e-4f3c-9d0a-7a4a3c1d9e11",
      company_name: "Stripe, Inc.",
      title: "Data Analyst, Intern",
      url: "https://job-boards.greenhouse.io/stripe/jobs/8194287?utm_source=Simplify&ref=Simplify",
      active: true,
      is_visible: true,
      locations: ["Toronto, ON"],
      terms: ["Summer 2027"],
      category: "AI/ML/Data",
      sponsorship: "Other",
      degrees: ["Bachelor's"],
      date_posted: 1_759_330_000,
    },
  ],
  simplifyConfigSchema.parse({ repo: "SimplifyJobs/Summer2027-Internships" }),
).rows;

const sources = [
  { id: "simplify", name: "Simplify Summer 2027" },
  { id: "stripe", name: "Stripe (Greenhouse)" },
];

describe("a job on both Simplify and the company board", () => {
  it("board arrives second: merged, one posting, two links, board's description", () => {
    const state = buildState({
      postings: [],
      links: [],
      companies: [],
      sources,
    });
    const first = planSource(
      state,
      "simplify",
      { kind: "fresh", rows: simplifyRows },
      { now: NOW, newId },
    );
    expect(first.stats).toMatchObject({ new: 1, merged: 0 });

    const second = planSource(
      state,
      "stripe",
      { kind: "fresh", rows: boardRows },
      { now: NOW, newId },
    );
    // Two Stripe jobs on the board: the Simplify one merges, the other is new.
    expect(second.stats).toMatchObject({ new: 1, merged: 1 });
    expect(second.insertLinks).toHaveLength(2);

    const merged = second.insertLinks.find(
      (l) => l.source_job_id === "8194287",
    )!;
    const simplifyPostingId = first.insertPostings[0].id;
    expect(merged.posting_id).toBe(simplifyPostingId);

    const updated = second.updatePostings.find(
      (p) => p.id === simplifyPostingId,
    )!;
    expect(updated.source_names).toEqual([
      "Simplify Summer 2027",
      "Stripe (Greenhouse)",
    ]);
    expect(updated.description).toContain("About Stripe");
    // The board adds no term and no category; Simplify's survive the merge.
    expect(updated.terms).toEqual(["Summer 2027"]);
    expect(updated.category).toBe("AI/ML/Data");
    expect(updated.ats_job_id).toBe("8194287");
  });

  it("board arrives first (a followed company): Simplify merges into it", () => {
    const state = buildState({
      postings: [],
      links: [],
      companies: [],
      sources,
    });
    const first = planSource(
      state,
      "stripe",
      { kind: "fresh", rows: boardRows },
      { now: NOW, newId },
    );
    expect(first.stats).toMatchObject({ new: 2, merged: 0 });

    const second = planSource(
      state,
      "simplify",
      { kind: "fresh", rows: simplifyRows },
      { now: NOW, newId },
    );
    expect(second.stats).toMatchObject({ new: 0, merged: 1 });
    expect(second.insertPostings).toHaveLength(0);
    expect(second.updatePostings[0].description).toContain("About Stripe");
    expect(second.updatePostings[0].terms).toEqual(["Summer 2027"]);
  });

  it("the posting stays open while either source lists it", () => {
    const state = buildState({
      postings: [],
      links: [],
      companies: [],
      sources,
    });
    planSource(
      state,
      "simplify",
      { kind: "fresh", rows: simplifyRows },
      { now: NOW, newId },
    );
    planSource(
      state,
      "stripe",
      { kind: "fresh", rows: boardRows },
      { now: NOW, newId },
    );
    // The board drops everything twice; Simplify still lists the Toronto job.
    planSource(
      state,
      "stripe",
      { kind: "fresh", rows: [] },
      { now: NOW, newId },
    );
    const closing = planSource(
      state,
      "stripe",
      { kind: "fresh", rows: [] },
      { now: NOW, newId },
    );
    const closedIds = closing.updatePostings
      .filter((p) => p.status === "closed")
      .map((p) => p.ats_job_id);
    // Only the job Simplify doesn't list closes.
    expect(closedIds).toHaveLength(1);
    expect(closedIds).not.toContain("8194287");
  });
});

describe("boards that give no ATS id in the URL still dedupe by title", () => {
  it("an Ashby job matches the same job from an aggregator on company + title + place", () => {
    const [ashbyRow] = parseAshbyJobs(ashbyFixture, {
      slug: "ramp",
      company: "Ramp",
    }).rows;
    const state = buildState({
      postings: [],
      links: [],
      companies: [],
      sources: [
        { id: "simplify", name: "Simplify Summer 2027" },
        { id: "ramp", name: "Ramp (Ashby)" },
      ],
    });
    planSource(
      state,
      "simplify",
      {
        kind: "fresh",
        rows: [
          {
            active: true,
            raw: {},
            posting: {
              ...ashbyRow.posting,
              sourceJobId: "simplify-1",
              // An aggregator's own redirect link: no ATS id to match on.
              url: "https://ramp.com/careers/applied-scientist-intern",
              description: null,
            },
          },
        ],
      },
      { now: NOW, newId },
    );
    const second = planSource(
      state,
      "ramp",
      { kind: "fresh", rows: [ashbyRow] },
      { now: NOW, newId },
    );
    expect(second.stats).toMatchObject({ new: 0, merged: 1 });
  });
});
