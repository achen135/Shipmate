import { z } from "zod";

import {
  normalizeCategory,
  normalizeSponsorship,
} from "@/lib/postings/normalize";

import type {
  FetchContext,
  NormalizedPosting,
  SourceAdapter,
  SourceRow,
} from "./types";

/**
 * Simplify-format aggregators: a GitHub repo whose bot keeps a
 * `listings.json` up to date (SimplifyJobs/Summer2027-Internships,
 * SimplifyJobs/New-Grad-Positions, vanshb03/Summer2027-Internships).
 *
 * Each check asks GitHub for the latest commit that touched the file and
 * downloads it (pinned to that commit) only if the SHA changed.
 */

export const simplifyConfigSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  branch: z.string().min(1).default("dev"),
  path: z.string().min(1).default(".github/scripts/listings.json"),
  /** For feeds without terms (New-Grad): the term every row gets. */
  defaultTerms: z.array(z.string()).default([]),
  /**
   * For feeds with a bare `season` ("Summer") instead of `terms`
   * (vanshb03): the year each season means in this repo's cycle.
   */
  seasonYears: z.record(z.string(), z.number().int()).default({}),
});

export type SimplifyConfig = z.infer<typeof simplifyConfigSchema>;

/**
 * One upstream row. Lenient on purpose: optional fields differ between the
 * three repos. Measured 2026-10-10: Summer2027 has terms/category/degrees,
 * New-Grad has no terms, vanshb03 has season and no category/degrees.
 */
const rowSchema = z.object({
  id: z.string().min(1),
  company_name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  url: z.string().trim().min(1),
  active: z.boolean(),
  is_visible: z.boolean().default(true),
  locations: z.array(z.string()).nullish(),
  terms: z.array(z.string()).nullish(),
  season: z.string().nullish(),
  category: z.string().nullish(),
  sponsorship: z.string().nullish(),
  degrees: z.array(z.string()).nullish(),
  date_posted: z.number().nullish(),
});

type Row = z.infer<typeof rowSchema>;

/** A file with more unparseable rows than this is treated as a format change. */
export const MAX_INVALID_SHARE = 0.05;

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function termsFor(row: Row, config: SimplifyConfig): string[] {
  let terms: string[];
  if (row.terms) {
    terms = row.terms;
  } else if (row.season) {
    // "Spring/Summer" → both; a season without a configured year is dropped.
    terms = row.season.split("/").flatMap((season) => {
      const year = config.seasonYears[season.trim()];
      return year ? [`${season.trim()} ${year}`] : [];
    });
  } else {
    terms = [];
  }
  // "N/A" means the term is unknown: store nothing rather than a fake term.
  const known = unique(terms).filter((t) => t.toUpperCase() !== "N/A");
  return known.length > 0 ? known : [...config.defaultTerms];
}

function toPosting(row: Row, config: SimplifyConfig): NormalizedPosting {
  return {
    sourceJobId: row.id,
    company: row.company_name,
    title: row.title,
    url: row.url,
    locations: unique(row.locations ?? []),
    postedAt:
      row.date_posted && row.date_posted > 0
        ? new Date(row.date_posted * 1000).toISOString()
        : null,
    terms: termsFor(row, config),
    category: normalizeCategory(row.category),
    sponsorship: normalizeSponsorship(row.sponsorship),
    degrees: unique(row.degrees ?? []),
    description: null,
  };
}

/**
 * Parse a whole listings.json. Every row is returned, active or not: an
 * inactive row closes a posting we already know about (CLAUDE.md "close
 * stale"), and only active + visible rows can create one.
 */
export function parseSimplifyListings(
  json: unknown,
  config: SimplifyConfig,
): { rows: SourceRow[]; invalid: number } {
  if (!Array.isArray(json)) {
    throw new Error("listings.json is not an array (format changed?)");
  }
  const rows: SourceRow[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const raw of json) {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data.id)) {
      invalid += 1;
      continue;
    }
    seen.add(parsed.data.id);
    rows.push({
      posting: toPosting(parsed.data, config),
      active: parsed.data.active && parsed.data.is_visible,
      raw,
    });
  }
  if (json.length > 0 && invalid / json.length > MAX_INVALID_SHARE) {
    throw new Error(
      `${invalid} of ${json.length} rows didn't parse (format changed?)`,
    );
  }
  return { rows, invalid };
}

function githubHeaders(token?: string): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** SHA of the newest commit on `branch` that touched `path`. */
export async function latestCommitSha(
  config: SimplifyConfig,
  ctx: FetchContext,
): Promise<string> {
  const params = new URLSearchParams({
    sha: config.branch,
    path: config.path,
    per_page: "1",
  });
  const res = await ctx.fetch(
    `https://api.github.com/repos/${config.repo}/commits?${params}`,
    { headers: githubHeaders(ctx.githubToken) },
  );
  if (!res.ok) {
    throw new Error(`GitHub commits API: HTTP ${res.status}`);
  }
  const commits = (await res.json()) as { sha?: unknown }[];
  const sha = commits[0]?.sha;
  if (typeof sha !== "string") {
    throw new Error(`no commits touch ${config.path} on ${config.branch}`);
  }
  return sha;
}

export const simplifyAdapter: SourceAdapter = {
  kind: "simplify_repo",
  async fetch(source, ctx) {
    const config = simplifyConfigSchema.parse(source.config);
    const sha = await latestCommitSha(config, ctx);
    if (sha === source.lastVersion) return { kind: "unchanged", version: sha };

    // Pinned to the commit, so the file matches the SHA we record.
    const res = await ctx.fetch(
      `https://raw.githubusercontent.com/${config.repo}/${sha}/${config.path}`,
    );
    if (!res.ok) throw new Error(`download listings.json: HTTP ${res.status}`);
    const { rows, invalid } = parseSimplifyListings(await res.json(), config);
    return { kind: "fresh", version: sha, rows, invalid };
  },
};
