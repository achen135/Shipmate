// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import fixture from "./__fixtures__/ashby-ramp.json";
import { ashbyAdapter, ashbyConfigSchema, parseAshbyJobs } from "./ashby";
import type { SourceRecord } from "./types";

// Fixture: Ramp's board on 2026-10-12: one internship, one unlisted draft
// internship (added by hand, isListed false), one other job.

const config = ashbyConfigSchema.parse({ slug: "ramp", company: "Ramp" });
const source = (): SourceRecord => ({
  id: "s1",
  kind: "ashby",
  name: "Ramp (Ashby)",
  config,
  lastVersion: null,
});

describe("parseAshbyJobs", () => {
  const { rows, invalid } = parseAshbyJobs(fixture, config);

  it("keeps listed internships only", () => {
    expect(invalid).toBe(0);
    expect(rows.map((r) => r.posting.title)).toEqual([
      "Applied Scientist Intern",
    ]);
  });

  it("normalizes a job, preferring jobUrl and the plain description", () => {
    expect(rows[0].posting).toMatchObject({
      sourceJobId: "b39ceb08-a0a7-4f8b-a760-2fb88e209956",
      company: "Ramp",
      url: "https://jobs.ashbyhq.com/ramp/b39ceb08-a0a7-4f8b-a760-2fb88e209956",
      locations: ["New York, NY (HQ)"],
      postedAt: "2026-09-15T01:44:04.643Z",
      terms: [],
    });
    expect(rows[0].posting.description).toMatch(/^ABOUT RAMP/);
  });

  it("falls back to stripping the HTML description", () => {
    const job = {
      ...fixture.jobs[0],
      descriptionPlain: null,
      descriptionHtml: "<h1>About</h1><p>Build &amp; ship</p>",
      secondaryLocations: [{ location: "Remote" }, { location: "Remote" }],
    };
    const parsed = parseAshbyJobs({ jobs: [job] }, config).rows[0].posting;
    expect(parsed.description).toBe("About\nBuild & ship");
    expect(parsed.locations).toEqual(["New York, NY (HQ)", "Remote"]);
  });
});

describe("ashbyAdapter", () => {
  it("is always a fresh snapshot with no version", async () => {
    const fetch = vi.fn(async () => Response.json(fixture));
    expect(await ashbyAdapter.fetch(source(), { fetch })).toMatchObject({
      kind: "fresh",
      version: null,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.ashbyhq.com/posting-api/job-board/ramp",
      expect.anything(),
    );
  });

  it("treats a 404 as a board with no jobs, not an error", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    expect(await ashbyAdapter.fetch(source(), { fetch })).toEqual({
      kind: "fresh",
      version: null,
      rows: [],
      invalid: 0,
    });
  });

  it("throws on other HTTP errors", async () => {
    const fetch = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(ashbyAdapter.fetch(source(), { fetch })).rejects.toThrow(
      /HTTP 503/,
    );
  });
});
