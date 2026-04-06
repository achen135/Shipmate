// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import fixture from "./__fixtures__/lever-palantir.json";
import { leverAdapter, leverConfigSchema, parseLeverJobs } from "./lever";
import type { SourceRecord } from "./types";

// Fixture: Palantir's board on 2026-10-12, two internships and one other job.

const config = leverConfigSchema.parse({
  slug: "palantir",
  company: "Palantir",
});
const source = (cfg: unknown = config): SourceRecord => ({
  id: "s1",
  kind: "lever",
  name: "Palantir (Lever)",
  config: cfg,
  lastVersion: null,
});

describe("parseLeverJobs", () => {
  const { rows, invalid } = parseLeverJobs(fixture, config);

  it("keeps the internships", () => {
    expect(invalid).toBe(0);
    expect(rows.map((r) => r.posting.title)).toEqual([
      "Deployment Strategist, Internship",
      "Deployment Strategist, Internship - US Government",
    ]);
  });

  it("normalizes a job (createdAt is epoch milliseconds)", () => {
    expect(rows[0].posting).toMatchObject({
      sourceJobId: "774cf5c9-bf6a-4d77-bf60-d50ef1beb1a0",
      company: "Palantir",
      url: "https://jobs.lever.co/palantir/774cf5c9-bf6a-4d77-bf60-d50ef1beb1a0",
      locations: ["Paris, France"],
      postedAt: new Date(1778517108152).toISOString(),
      terms: [],
      category: null,
      sponsorship: "unknown",
    });
    expect(rows[0].posting.description).toMatch(/^A World-Changing Company/);
  });

  it("rejects a response that isn't an array", () => {
    expect(() => parseLeverJobs({ ok: false }, config)).toThrow(
      /format changed/,
    );
  });
});

describe("leverAdapter", () => {
  it("is always a fresh snapshot with no version", async () => {
    const fetch = vi.fn(async () => Response.json(fixture));
    const result = await leverAdapter.fetch(source(), { fetch });
    expect(result).toMatchObject({ kind: "fresh", version: null });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.lever.co/v0/postings/palantir?mode=json",
      expect.anything(),
    );
  });

  it("uses the EU host for EU boards", async () => {
    const fetch = vi.fn(async () => Response.json([]));
    await leverAdapter.fetch(source({ ...config, eu: true }), { fetch });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.eu.lever.co/v0/postings/palantir?mode=json",
      expect.anything(),
    );
  });

  it("treats a 404 as a board with no jobs, not an error", async () => {
    const fetch = vi.fn(
      async () => new Response('{"ok":false}', { status: 404 }),
    );
    expect(await leverAdapter.fetch(source(), { fetch })).toEqual({
      kind: "fresh",
      version: null,
      rows: [],
      invalid: 0,
    });
  });

  it("throws on other HTTP errors", async () => {
    const fetch = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(leverAdapter.fetch(source(), { fetch })).rejects.toThrow(
      /HTTP 500/,
    );
  });
});
