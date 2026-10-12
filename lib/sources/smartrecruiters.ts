import { z } from "zod";

import {
  EMPTY_SNAPSHOT,
  boardSlugSchema,
  collectRows,
  companyNameSchema,
  getBoardJson,
  isoOrNull,
  uniqueStrings,
} from "./board";
import { isInternshipTitle } from "./title-filter";
import type { SourceAdapter, SourceRow } from "./types";

/**
 * SmartRecruiters posting API:
 * GET api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100&offset=N
 *
 * The list holds summaries only (no apply URL, no description), and fetching
 * each job's detail would cost one request per job per check, so the apply
 * link is built from SmartRecruiters' stable public URL and the description
 * stays empty until a user opens the job.
 */

export const smartrecruitersConfigSchema = z.object({
  slug: boardSlugSchema,
  company: companyNameSchema,
});

export type SmartRecruitersConfig = z.infer<typeof smartrecruitersConfigSchema>;

export const PAGE_SIZE = 100;

/**
 * Pages read per check. AbbVie lists ~1,900 jobs (19 pages) with its interns
 * scattered through them, so a board that big must still be read whole. A
 * board past this cap is an error, not a partial snapshot: a snapshot missing
 * the tail would close the jobs in it.
 */
export const MAX_PAGES = 30;

const jobSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  releasedDate: z.string().nullish(),
  location: z
    .object({
      fullLocation: z.string().nullish(),
      city: z.string().nullish(),
      region: z.string().nullish(),
      country: z.string().nullish(),
    })
    .nullish(),
});

type Job = z.infer<typeof jobSchema>;

function locationOf(job: Job): string[] {
  const l = job.location;
  if (!l) return [];
  if (l.fullLocation?.trim()) return [l.fullLocation];
  return uniqueStrings([
    [l.city, l.region, l.country].filter(Boolean).join(", "),
  ]);
}

export function parseSmartRecruitersJobs(
  jobs: unknown[],
  config: SmartRecruitersConfig,
) {
  return collectRows(
    jobs,
    jobSchema,
    (job) => job.id,
    (job, raw): SourceRow | null => {
      if (!isInternshipTitle(job.name)) return null;
      return {
        posting: {
          sourceJobId: job.id,
          company: config.company,
          title: job.name,
          url: `https://jobs.smartrecruiters.com/${encodeURIComponent(config.slug)}/${job.id}`,
          locations: locationOf(job),
          postedAt: isoOrNull(job.releasedDate),
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

export const smartrecruitersAdapter: SourceAdapter = {
  kind: "smartrecruiters",
  async fetch(source, ctx) {
    const config = smartrecruitersConfigSchema.parse(source.config);
    const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(config.slug)}/postings`;

    const jobs: unknown[] = [];
    for (let page = 0; ; page += 1) {
      if (page >= MAX_PAGES) {
        throw new Error(
          `more than ${MAX_PAGES * PAGE_SIZE} postings; not reading a partial list`,
        );
      }
      const json = (await getBoardJson(
        ctx,
        `${base}?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
      )) as { content?: unknown; totalFound?: unknown } | null;
      if (json === null) {
        // No public board. Only the first page can say so; later, it's odd.
        if (page === 0) return EMPTY_SNAPSHOT;
        throw new Error("board disappeared while reading it");
      }
      if (!Array.isArray(json.content)) {
        throw new Error(
          "SmartRecruiters response has no content array (format changed?)",
        );
      }
      jobs.push(...json.content);
      const total = typeof json.totalFound === "number" ? json.totalFound : 0;
      if (json.content.length === 0 || jobs.length >= total) break;
    }

    const { rows, invalid } = parseSmartRecruitersJobs(jobs, config);
    return { kind: "fresh", version: null, rows, invalid };
  },
};
