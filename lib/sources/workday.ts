import { z } from "zod";

import {
  boardSlugSchema,
  collectRows,
  companyNameSchema,
  uniqueStrings,
} from "./board";
import { isInternshipTitle } from "./title-filter";
import { BestEffortFailure, type SourceAdapter, type SourceRow } from "./types";

/**
 * Workday career sites, best effort. The `cxs` search endpoint is what the
 * careers page itself calls; it is undocumented and can change or be blocked
 * without notice. So every way this can go wrong, from a network error to an
 * unexpected shape, is a BestEffortFailure: logged, shown to the admin as a
 * low-key "best effort" note, never a failed run and never a snapshot (an
 * empty list here would close every Workday job we know).
 */

export const workdayConfigSchema = z.object({
  /** The subdomain: nvidia in nvidia.wd5.myworkdayjobs.com. */
  tenant: boardSlugSchema,
  /** The N in wdN. */
  wdNumber: z.number().int().min(1).max(999),
  /** The site name in the careers URL path. */
  site: boardSlugSchema,
  company: companyNameSchema,
});

export type WorkdayConfig = z.infer<typeof workdayConfigSchema>;

/** The search endpoint's page size limit. */
export const PAGE_SIZE = 20;
/**
 * Workday's search is full text ("intern" finds 1,080 NVIDIA jobs), best
 * matches first, so the title matches are near the top. Reading further costs
 * a request per 20 for little. A board past this cap gives a warning and a
 * list that may miss the tail: acceptable for a best-effort source, and the
 * only cost is a posting shown as closed that isn't.
 */
export const MAX_PAGES = 10;

const jobSchema = z.object({
  title: z.string().trim().min(1),
  externalPath: z.string().startsWith("/"),
  locationsText: z.string().nullish(),
});

export function workdayBaseUrl(config: WorkdayConfig): string {
  return `https://${config.tenant}.wd${config.wdNumber}.myworkdayjobs.com`;
}

export function parseWorkdayJobs(jobs: unknown[], config: WorkdayConfig) {
  return collectRows(
    jobs,
    jobSchema,
    (job) => job.externalPath,
    (job, raw): SourceRow | null => {
      if (!isInternshipTitle(job.title)) return null;
      return {
        posting: {
          // Unique within one tenant's site, which is what a source is.
          sourceJobId: job.externalPath,
          company: config.company,
          title: job.title,
          url: `${workdayBaseUrl(config)}/${config.site}${job.externalPath}`,
          locations: uniqueStrings([job.locationsText]),
          // "Posted 26 Days Ago" is all the search says.
          postedAt: null,
          terms: [],
          category: null,
          sponsorship: "unknown",
          degrees: [],
          description: null,
        },
        active: true,
        raw,
      };
    },
  );
}

async function searchJobs(
  config: WorkdayConfig,
  ctx: Parameters<SourceAdapter["fetch"]>[1],
): Promise<unknown[]> {
  const url = `${workdayBaseUrl(config)}/wday/cxs/${config.tenant}/${config.site}/jobs`;
  const jobs: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await ctx.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        appliedFacets: {},
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        searchText: "intern",
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      total?: unknown;
      jobPostings?: unknown;
    };
    if (!Array.isArray(json.jobPostings)) {
      throw new Error("no jobPostings array");
    }
    jobs.push(...json.jobPostings);
    const total = typeof json.total === "number" ? json.total : 0;
    if (json.jobPostings.length === 0 || jobs.length >= total) return jobs;
  }
  ctx.warn?.(
    `Workday ${config.tenant}: more than ${MAX_PAGES * PAGE_SIZE} results for "intern"; reading the first ${MAX_PAGES * PAGE_SIZE}`,
  );
  return jobs;
}

export const workdayAdapter: SourceAdapter = {
  kind: "workday",
  async fetch(source, ctx) {
    const config = workdayConfigSchema.parse(source.config);
    try {
      const jobs = await searchJobs(config, ctx);
      const { rows, invalid } = parseWorkdayJobs(jobs, config);
      return { kind: "fresh", version: null, rows, invalid };
    } catch (error) {
      throw new BestEffortFailure(
        `Workday ${config.tenant}/${config.site}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};
