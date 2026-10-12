// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import newGrad from "./__fixtures__/simplify-new-grad.json";
import summer from "./__fixtures__/simplify-summer2027.json";
import vansh from "./__fixtures__/vanshb03-summer2027.json";
import {
  parseSimplifyListings,
  simplifyAdapter,
  simplifyConfigSchema,
} from "./simplify";

// Fixtures are real rows sliced from each repo's listings.json (2026-10-10).

const summerConfig = simplifyConfigSchema.parse({
  repo: "SimplifyJobs/Summer2027-Internships",
});
const newGradConfig = simplifyConfigSchema.parse({
  repo: "SimplifyJobs/New-Grad-Positions",
  defaultTerms: ["New Grad"],
});
const vanshConfig = simplifyConfigSchema.parse({
  repo: "vanshb03/Summer2027-Internships",
  seasonYears: { Summer: 2027, Fall: 2026, Winter: 2027, Spring: 2027 },
});

const byUrl = (
  rows: ReturnType<typeof parseSimplifyListings>["rows"],
  part: string,
) => rows.find((r) => r.posting.url.includes(part))!;

describe("parseSimplifyListings: Summer 2027", () => {
  const { rows, invalid } = parseSimplifyListings(summer, summerConfig);

  it("parses every row, active or not", () => {
    expect(invalid).toBe(0);
    expect(rows).toHaveLength(summer.length);
  });

  it("normalizes a Greenhouse row", () => {
    const row = byUrl(rows, "aquaticcapitalmanagement/jobs/8489233002");
    expect(row.active).toBe(true);
    expect(row.posting).toMatchObject({
      company: "Aquatic Capital Management",
      terms: ["Summer 2027"],
      category: "Software",
      sponsorship: "unknown",
      description: null,
    });
    expect(row.posting.sourceJobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.posting.postedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(row.raw).toBe(summer.find((r) => r.url === row.posting.url));
  });

  it("treats inactive or hidden rows as inactive", () => {
    expect(byUrl(rows, "dovercorporation").active).toBe(false);
    expect(byUrl(rows, "genevatrading").active).toBe(false);
  });

  it("stores N/A terms as unknown (empty)", () => {
    expect(byUrl(rows, "CLOUDworks").posting.terms).toEqual([]);
  });

  it("keeps multiple terms", () => {
    expect(byUrl(rows, "mercor").posting.terms).toContain("Summer 2027");
    expect(byUrl(rows, "mercor").posting.terms.length).toBeGreaterThan(1);
  });

  it("maps long category names and informative sponsorship", () => {
    expect(byUrl(rows, "hermeus").posting).toMatchObject({
      category: "Hardware",
      sponsorship: "citizens_only",
    });
    expect(byUrl(rows, "interplay").posting).toMatchObject({
      category: "AI/ML/Data",
      sponsorship: "offers",
    });
  });
});

describe("parseSimplifyListings: feed differences", () => {
  it("gives New-Grad rows (no terms) the configured term", () => {
    const { rows } = parseSimplifyListings(newGrad, newGradConfig);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.posting.terms).toEqual(["New Grad"]);
  });

  it("turns vanshb03 seasons into terms, including Spring/Summer", () => {
    const { rows } = parseSimplifyListings(vansh, vanshConfig);
    expect(byUrl(rows, "crowe").posting.terms).toEqual(["Fall 2026"]);
    expect(byUrl(rows, "careers.amd.com").posting.terms).toEqual([
      "Spring 2027",
      "Summer 2027",
    ]);
    expect(byUrl(rows, "crowe").posting.category).toBeNull();
  });
});

describe("parseSimplifyListings: format checks", () => {
  it("rejects a file that isn't an array", () => {
    expect(() => parseSimplifyListings({ listings: [] }, summerConfig)).toThrow(
      /not an array/,
    );
  });

  it("rejects a file where many rows don't parse", () => {
    const broken = summer.map((row) => ({ ...row, title: undefined }));
    expect(() => parseSimplifyListings(broken, summerConfig)).toThrow(
      /didn't parse/,
    );
  });

  it("skips a few bad or duplicate rows and counts them", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...summer[0],
      id: `id-${i}`,
    }));
    const { rows, invalid } = parseSimplifyListings(
      [...many, { ...summer[0], id: "id-0" }, { id: "x" }],
      summerConfig,
    );
    expect(rows).toHaveLength(40);
    expect(invalid).toBe(2);
  });
});

describe("simplifyAdapter.fetch", () => {
  function fakeFetch(sha: string) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.github.com/")) {
        return Response.json([{ sha }]);
      }
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        return Response.json(summer);
      }
      return new Response("not found", { status: 404 });
    });
  }

  const source = {
    id: "s1",
    kind: "simplify_repo" as const,
    name: "Simplify Summer 2027",
    config: { repo: "SimplifyJobs/Summer2027-Internships" },
  };

  it("downloads nothing when the commit SHA hasn't changed", async () => {
    const fetch = fakeFetch("abc123");
    const result = await simplifyAdapter.fetch(
      { ...source, lastVersion: "abc123" },
      { fetch: fetch as typeof globalThis.fetch, githubToken: "t" },
    );
    expect(result).toEqual({ kind: "unchanged", version: "abc123" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/repos/SimplifyJobs/Summer2027-Internships/commits?sha=dev&path=.github%2Fscripts%2Flistings.json&per_page=1",
    );
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer t");
  });

  it("downloads the file pinned to the new SHA", async () => {
    const fetch = fakeFetch("def456");
    const result = await simplifyAdapter.fetch(
      { ...source, lastVersion: "abc123" },
      { fetch: fetch as typeof globalThis.fetch },
    );
    expect(result.kind).toBe("fresh");
    expect(result.kind === "fresh" && result.rows).toHaveLength(summer.length);
    expect(String(fetch.mock.calls[1][0])).toBe(
      "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/def456/.github/scripts/listings.json",
    );
  });

  it("throws (a failed check, not a snapshot) on HTTP errors", async () => {
    const fetch = vi.fn(
      async () => new Response("rate limited", { status: 403 }),
    );
    await expect(
      simplifyAdapter.fetch(
        { ...source, lastVersion: null },
        { fetch: fetch as typeof globalThis.fetch },
      ),
    ).rejects.toThrow(/HTTP 403/);
  });
});
