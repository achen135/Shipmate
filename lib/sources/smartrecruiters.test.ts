// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import fixture from "./__fixtures__/smartrecruiters-abbvie.json";
import {
  MAX_PAGES,
  PAGE_SIZE,
  parseSmartRecruitersJobs,
  smartrecruitersAdapter,
  smartrecruitersConfigSchema,
} from "./smartrecruiters";
import type { SourceRecord } from "./types";

// Fixture: AbbVie's list on 2026-10-12 (two internships and one other job,
// taken from offset 700; AbbVie lists ~1,900 jobs and its interns are spread
// through them).

const config = smartrecruitersConfigSchema.parse({
  slug: "AbbVie",
  company: "AbbVie",
});
const source = (): SourceRecord => ({
  id: "s1",
  kind: "smartrecruiters",
  name: "AbbVie (SmartRecruiters)",
  config,
  lastVersion: null,
});

describe("parseSmartRecruitersJobs", () => {
  const { rows, invalid } = parseSmartRecruitersJobs(fixture.content, config);

  it("keeps the internships", () => {
    expect(invalid).toBe(0);
    expect(rows.map((r) => r.posting.title)).toEqual([
      "2027 Business Technology Solutions Intern - Cloud Engineering (Undergraduate)",
      "2027 Global Supply Chain Intern (Undergraduate)",
    ]);
  });

  it("builds the public apply link and leaves the description empty", () => {
    const { posting } = rows[0];
    expect(posting.url).toBe(
      `https://jobs.smartrecruiters.com/AbbVie/${posting.sourceJobId}`,
    );
    expect(posting).toMatchObject({
      company: "AbbVie",
      terms: [],
      description: null,
    });
    expect(posting.locations).toHaveLength(1);
    expect(posting.postedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});

/** A fake API holding `jobs`, answering limit/offset like the real one. */
function fakeApi(jobs: unknown[]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset"));
    return Response.json({
      offset,
      limit,
      totalFound: jobs.length,
      content: jobs.slice(offset, offset + limit),
    });
  });
}

const job = (i: number, name = `Engineer ${i}`) => ({
  ...fixture.content[2],
  id: String(1_000_000 + i),
  name,
});

describe("smartrecruitersAdapter", () => {
  it("reads every page until totalFound", async () => {
    // 250 jobs = 3 pages of 100; interns on the first, second, and last page.
    const jobs = Array.from({ length: 250 }, (_, i) => job(i));
    jobs[5] = job(5, "Software Intern");
    jobs[150] = job(150, "Data Intern");
    jobs[249] = job(249, "Co-op Engineer");
    const fetch = fakeApi(jobs);

    const result = await smartrecruitersAdapter.fetch(source(), { fetch });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.kind).toBe("fresh");
    if (result.kind !== "fresh") return;
    expect(result.version).toBeNull();
    expect(result.rows.map((r) => r.posting.title)).toEqual([
      "Software Intern",
      "Data Intern",
      "Co-op Engineer",
    ]);
    const urls = fetch.mock.calls.map(([u]) => String(u));
    expect(urls[1]).toContain(`offset=${PAGE_SIZE}`);
    expect(urls[2]).toContain(`offset=${2 * PAGE_SIZE}`);
  });

  it("stops on an empty page even if totalFound overstates", async () => {
    const real = fakeApi([job(1), job(2)]);
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const res = await real(input);
      const body = await res.json();
      return Response.json({ ...body, totalFound: 9999 });
    });
    const result = await smartrecruitersAdapter.fetch(source(), { fetch });
    expect(result.kind).toBe("fresh");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refuses a board bigger than the page cap rather than return a partial list", async () => {
    const jobs = Array.from({ length: MAX_PAGES * PAGE_SIZE + 1 }, (_, i) =>
      job(i),
    );
    await expect(
      smartrecruitersAdapter.fetch(source(), { fetch: fakeApi(jobs) }),
    ).rejects.toThrow(/not reading a partial list/);
  });

  it("treats a 404 as a board with no jobs, not an error", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    expect(await smartrecruitersAdapter.fetch(source(), { fetch })).toEqual({
      kind: "fresh",
      version: null,
      rows: [],
      invalid: 0,
    });
  });

  it("throws on other HTTP errors", async () => {
    const fetch = vi.fn(async () => new Response("no", { status: 502 }));
    await expect(
      smartrecruitersAdapter.fetch(source(), { fetch }),
    ).rejects.toThrow(/HTTP 502/);
  });
});
