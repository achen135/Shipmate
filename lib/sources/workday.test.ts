// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import fixture from "./__fixtures__/workday-nvidia.json";
import {
  MAX_PAGES,
  PAGE_SIZE,
  parseWorkdayJobs,
  workdayAdapter,
  workdayConfigSchema,
} from "./workday";
import { BestEffortFailure, type SourceRecord } from "./types";

// Fixture: NVIDIA's careers search for "intern" on 2026-10-12, first two hits.

const config = workdayConfigSchema.parse({
  tenant: "nvidia",
  wdNumber: 5,
  site: "NVIDIAExternalCareerSite",
  company: "NVIDIA",
});
const source = (): SourceRecord => ({
  id: "s1",
  kind: "workday",
  name: "NVIDIA (Workday)",
  config,
  lastVersion: null,
});

describe("parseWorkdayJobs", () => {
  const { rows } = parseWorkdayJobs(fixture.jobPostings, config);

  it("builds the job link from the site and externalPath", () => {
    expect(rows[0].posting).toMatchObject({
      sourceJobId: "/job/China-Shanghai/Custom-SOC-Intern---2027_JR2024692",
      company: "NVIDIA",
      title: "Custom SOC Intern - 2027",
      url: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/China-Shanghai/Custom-SOC-Intern---2027_JR2024692",
      locations: ["China, Shanghai"],
      postedAt: null,
      description: null,
    });
  });

  it("applies the same title filter", () => {
    const parsed = parseWorkdayJobs(
      [
        { title: "Internal Tools Engineer", externalPath: "/job/x/a_JR1" },
        { title: "Hardware Intern", externalPath: "/job/x/b_JR2" },
      ],
      config,
    );
    expect(parsed.rows.map((r) => r.posting.title)).toEqual([
      "Hardware Intern",
    ]);
  });
});

describe("workdayAdapter", () => {
  it("posts the search and returns a fresh snapshot", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ...fixture, total: fixture.jobPostings.length }),
    );
    const result = await workdayAdapter.fetch(source(), { fetch });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      appliedFacets: {},
      limit: PAGE_SIZE,
      offset: 0,
      searchText: "intern",
    });
    expect(result).toMatchObject({ kind: "fresh", version: null });
    // The second hit, "Director, International Tax Planning", is not an internship.
    if (result.kind === "fresh") expect(result.rows).toHaveLength(1);
  });

  it("reads further pages while there are more results", async () => {
    const fetch = vi.fn(async (_: RequestInfo | URL, init?: RequestInit) => {
      const offset = JSON.parse(String(init?.body)).offset as number;
      return Response.json({
        total: 45,
        jobPostings: Array.from(
          { length: Math.min(20, 45 - offset) },
          (_, i) => ({
            title: `Intern ${offset + i}`,
            externalPath: `/job/x/Intern-${offset + i}_JR${offset + i}`,
            locationsText: "Remote",
          }),
        ),
      });
    });
    const result = await workdayAdapter.fetch(source(), { fetch });
    expect(fetch).toHaveBeenCalledTimes(3);
    if (result.kind === "fresh") expect(result.rows).toHaveLength(45);
  });

  it("warns when the result list is past the page cap", async () => {
    const warn = vi.fn();
    const fetch = vi.fn(async () =>
      Response.json({
        total: 5000,
        jobPostings: Array.from({ length: PAGE_SIZE }, (_, i) => ({
          title: `Intern ${i}`,
          externalPath: `/job/x/Intern-${i}_JR${i}`,
        })),
      }),
    );
    await workdayAdapter.fetch(source(), { fetch, warn });
    expect(fetch).toHaveBeenCalledTimes(MAX_PAGES);
    expect(warn).toHaveBeenCalledOnce();
  });

  const failures: [string, () => Promise<Response>][] = [
    ["a non-200 answer", async () => new Response("blocked", { status: 403 })],
    ["a 404", async () => new Response("", { status: 404 })],
    ["malformed JSON", async () => new Response("<html>", { status: 200 })],
    ["an unexpected shape", async () => Response.json({ ok: true })],
    [
      "jobs that don't parse",
      async () =>
        Response.json({ total: 2, jobPostings: [{ a: 1 }, { b: 2 }] }),
    ],
    [
      "a network error",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
  ];
  it.each(failures)(
    "turns %s into a best-effort failure, never a snapshot",
    async (_, respond) => {
      const attempt = workdayAdapter.fetch(source(), { fetch: vi.fn(respond) });
      await expect(attempt).rejects.toBeInstanceOf(BestEffortFailure);
      await expect(attempt).rejects.toThrow(
        /Workday nvidia\/NVIDIAExternalCareerSite/,
      );
    },
  );
});
