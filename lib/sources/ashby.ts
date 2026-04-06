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
import { htmlToText } from "./text";
import { isInternshipTitle } from "./title-filter";
import type { SourceAdapter, SourceRow } from "./types";

/**
 * Ashby public job board API:
 * GET api.ashbyhq.com/posting-api/job-board/{slug}
 */

export const ashbyConfigSchema = z.object({
  slug: boardSlugSchema,
  company: companyNameSchema,
});

export type AshbyConfig = z.infer<typeof ashbyConfigSchema>;

const jobSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  jobUrl: z.string().trim().min(1),
  location: z.string().nullish(),
  secondaryLocations: z
    .array(z.object({ location: z.string().nullish() }))
    .nullish(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().default(true),
  descriptionPlain: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
});

export function parseAshbyJobs(json: unknown, config: AshbyConfig) {
  const jobs = (json as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) {
    throw new Error("Ashby response has no jobs array (format changed?)");
  }
  return collectRows(
    jobs,
    jobSchema,
    (job) => job.id,
    (job, raw): SourceRow | null => {
      // Unlisted = an unpublished draft: never ours to show.
      if (!job.isListed || !isInternshipTitle(job.title)) return null;
      const description =
        job.descriptionPlain?.trim() ||
        (job.descriptionHtml ? htmlToText(job.descriptionHtml) : "");
      return {
        posting: {
          sourceJobId: job.id,
          company: config.company,
          title: job.title,
          url: job.jobUrl,
          locations: uniqueStrings([
            job.location,
            ...(job.secondaryLocations ?? []).map((l) => l.location),
          ]),
          postedAt: isoOrNull(job.publishedAt),
          terms: [],
          category: null,
          sponsorship: "unknown",
          degrees: [],
          description: description || null,
        },
        active: true,
        raw,
      };
    },
  );
}

export const ashbyAdapter: SourceAdapter = {
  kind: "ashby",
  async fetch(source, ctx) {
    const config = ashbyConfigSchema.parse(source.config);
    const json = await getBoardJson(
      ctx,
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(config.slug)}`,
    );
    if (json === null) return EMPTY_SNAPSHOT;
    const { rows, invalid } = parseAshbyJobs(json, config);
    return { kind: "fresh", version: null, rows, invalid };
  },
};
