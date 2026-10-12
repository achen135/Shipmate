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
 * Lever postings API: GET api.lever.co/v0/postings/{slug}?mode=json (EU
 * boards: api.eu.lever.co). The response is a bare array of jobs.
 */

export const leverConfigSchema = z.object({
  slug: boardSlugSchema,
  company: companyNameSchema,
  /** A board on jobs.eu.lever.co. */
  eu: z.boolean().default(false),
});

export type LeverConfig = z.infer<typeof leverConfigSchema>;

const jobSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1),
  hostedUrl: z.string().trim().min(1),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
    })
    .nullish(),
  // Epoch milliseconds, not seconds.
  createdAt: z.number().nullish(),
  descriptionPlain: z.string().nullish(),
});

export function parseLeverJobs(json: unknown, config: LeverConfig) {
  if (!Array.isArray(json)) {
    throw new Error("Lever response is not an array (format changed?)");
  }
  return collectRows(
    json,
    jobSchema,
    (job) => job.id,
    (job, raw): SourceRow | null => {
      if (!isInternshipTitle(job.text)) return null;
      return {
        posting: {
          sourceJobId: job.id,
          company: config.company,
          title: job.text,
          url: job.hostedUrl,
          locations: uniqueStrings(
            job.categories?.allLocations?.length
              ? job.categories.allLocations
              : [job.categories?.location],
          ),
          postedAt: isoOrNull(job.createdAt),
          terms: [],
          category: null,
          sponsorship: "unknown",
          degrees: [],
          description: job.descriptionPlain?.trim() || null,
        },
        active: true,
        raw,
      };
    },
  );
}

export const leverAdapter: SourceAdapter = {
  kind: "lever",
  async fetch(source, ctx) {
    const config = leverConfigSchema.parse(source.config);
    const host = config.eu ? "api.eu.lever.co" : "api.lever.co";
    const json = await getBoardJson(
      ctx,
      `https://${host}/v0/postings/${encodeURIComponent(config.slug)}?mode=json`,
    );
    if (json === null) return EMPTY_SNAPSHOT;
    const { rows, invalid } = parseLeverJobs(json, config);
    return { kind: "fresh", version: null, rows, invalid };
  },
};
