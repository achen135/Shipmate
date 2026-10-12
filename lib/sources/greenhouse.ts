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
 * Greenhouse job board API:
 * GET boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 *
 * `content=true` puts every description in the one response, so a check is a
 * single request. Closed jobs just vanish from the list; the planner's
 * "missing twice" rule closes them.
 */

export const greenhouseConfigSchema = z.object({
  slug: boardSlugSchema,
  company: companyNameSchema,
});

export type GreenhouseConfig = z.infer<typeof greenhouseConfigSchema>;

const jobSchema = z.object({
  id: z.number().int(),
  title: z.string().trim().min(1),
  absolute_url: z.string().trim().min(1),
  location: z.object({ name: z.string().nullish() }).nullish(),
  first_published: z.string().nullish(),
  content: z.string().nullish(),
});

export function parseGreenhouseJobs(json: unknown, config: GreenhouseConfig) {
  const jobs = (json as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) {
    throw new Error("Greenhouse response has no jobs array (format changed?)");
  }
  return collectRows(
    jobs,
    jobSchema,
    (job) => String(job.id),
    (job, raw): SourceRow | null => {
      if (!isInternshipTitle(job.title)) return null;
      const description = job.content ? htmlToText(job.content) : "";
      return {
        posting: {
          sourceJobId: String(job.id),
          company: config.company,
          title: job.title,
          url: job.absolute_url,
          locations: uniqueStrings([job.location?.name]),
          postedAt: isoOrNull(job.first_published),
          // Greenhouse doesn't tag a term; empty = unknown (matches any).
          terms: [],
          // No category or sponsorship field here, and guessing from the
          // title would be a guess: matching falls back to title keywords.
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

export const greenhouseAdapter: SourceAdapter = {
  kind: "greenhouse",
  async fetch(source, ctx) {
    const config = greenhouseConfigSchema.parse(source.config);
    const json = await getBoardJson(
      ctx,
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(config.slug)}/jobs?content=true`,
    );
    if (json === null) return EMPTY_SNAPSHOT;
    const { rows, invalid } = parseGreenhouseJobs(json, config);
    return { kind: "fresh", version: null, rows, invalid };
  },
};
