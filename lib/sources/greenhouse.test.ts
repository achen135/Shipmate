// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import fixture from "./__fixtures__/greenhouse-stripe.json";
import {
  greenhouseAdapter,
  greenhouseConfigSchema,
  parseGreenhouseJobs,
} from "./greenhouse";
import type { FetchContext, SourceRecord } from "./types";

// Fixture: Stripe's board on 2026-10-12, trimmed to two intern jobs and one
// "Internal Audit …" job (descriptions cut to ~500 characters).

const config = greenhouseConfigSchema.parse({
  slug: "stripe",
  company: "Stripe",
});

const source = (): SourceRecord => ({
  id: "s1",
  kind: "greenhouse",
  name: "Stripe (Greenhouse)",
  config,
  lastVersion: null,
});

const ctx = (fetch: typeof globalThis.fetch): FetchContext => ({ fetch });

describe("parseGreenhouseJobs", () => {
  const { rows, invalid } = parseGreenhouseJobs(fixture, config);

  it("keeps internships and drops 'Internal Audit …'", () => {
    expect(invalid).toBe(0);
    expect(rows.map((r) => r.posting.title)).toEqual([
      "Data Analyst, Intern",
      "Data Analyst, Intern",
    ]);
  });

  it("normalizes a job", () => {
    const first = rows[0];
    expect(first.active).toBe(true);
    expect(first.posting).toMatchObject({
      sourceJobId: "8194287",
      company: "Stripe",
      url: "https://stripe.com/jobs/search?gh_jid=8194287",
      locations: ["Toronto"],
      postedAt: "2026-10-01T15:05:36.000Z",
      terms: [],
      category: null,
      sponsorship: "unknown",
      degrees: [],
    });
    expect(first.raw).toBe(fixture.jobs[0]);
  });

  it("turns the escaped HTML content into text", () => {
    const description = rows[0].posting.description!;
    expect(description).toContain("About Stripe");
    expect(description).not.toMatch(/<|&lt;|&gt;/);
  });

  it("rejects a response without a jobs array", () => {
    expect(() => parseGreenhouseJobs({ error: "x" }, config)).toThrow(
      /format changed/,
    );
  });

  it("counts a few unreadable rows but fails when too many are", () => {
    const jobs = Array.from({ length: 30 }, (_, i) => ({
      ...fixture.jobs[0],
      id: 1000 + i,
    }));
    expect(
      parseGreenhouseJobs({ jobs: [...jobs, { id: "x" }] }, config),
    ).toMatchObject({
      invalid: 1,
    });
    expect(() =>
      parseGreenhouseJobs({ jobs: [jobs[0], { id: "x" }] }, config),
    ).toThrow(/didn't parse/);
  });
});

describe("greenhouseAdapter", () => {
  it("is always a fresh snapshot with no version", async () => {
    const fetch = vi.fn(async () => Response.json(fixture));
    const result = await greenhouseAdapter.fetch(source(), ctx(fetch));
    expect(result).toMatchObject({ kind: "fresh", version: null, invalid: 0 });
    expect(fetch).toHaveBeenCalledWith(
      "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true",
      expect.anything(),
    );
  });

  it("treats a 404 as a board with no jobs, not an error", async () => {
    const fetch = vi.fn(
      async () => new Response('{"status":404}', { status: 404 }),
    );
    expect(await greenhouseAdapter.fetch(source(), ctx(fetch))).toEqual({
      kind: "fresh",
      version: null,
      rows: [],
      invalid: 0,
    });
  });

  it("throws on other HTTP errors", async () => {
    const fetch = vi.fn(async () => new Response("no", { status: 403 }));
    await expect(greenhouseAdapter.fetch(source(), ctx(fetch))).rejects.toThrow(
      /HTTP 403/,
    );
  });
});
