import { type AtsJob, canonicalizeUrl, parseAtsJob } from "@/lib/postings/url";

/**
 * Manual add by URL, step 1: is this job already a Shipmate posting? Same
 * keys as the watcher's dedupe (CLAUDE.md "Dedupe order"), minus the fuzzy
 * one, which needs a company and title we don't have yet:
 *   1. ATS job id parsed from the URL
 *   2. canonical URL
 * Only each posting's primary link is visible to users (posting_sources is
 * worker-only), so a job known under another feed's URL can be missed; the
 * fallback is a manual row, never a wrong match.
 */

export type PostingKey =
  | { by: "ats"; ats: AtsJob["ats"]; jobId: string }
  | { by: "canonical"; canonicalUrl: string };

/** The lookups to try, in order. Empty for something that isn't a URL. */
export function postingKeys(url: string): PostingKey[] {
  if (!/^https?:\/\//i.test(url.trim())) return [];
  const ats = parseAtsJob(url);
  return [
    ...(ats ? [{ by: "ats" as const, ats: ats.ats, jobId: ats.jobId }] : []),
    { by: "canonical", canonicalUrl: canonicalizeUrl(url) },
  ];
}

/** First posting any key finds, or null. `find` runs one query per key. */
export async function findExistingPosting<T>(
  url: string,
  find: (key: PostingKey) => Promise<T | null>,
): Promise<T | null> {
  for (const key of postingKeys(url)) {
    const found = await find(key);
    if (found) return found;
  }
  return null;
}

/** What the lookup Route Handler answers. */
export type LookupResult =
  | {
      kind: "posting";
      posting: {
        id: string;
        company: string;
        title: string;
        location: string | null;
        url: string;
        closed: boolean;
      };
      /** The user's row for it, if any (Inbox, To Apply, or Tracker). */
      row: { id: string; status: string } | null;
    }
  | {
      kind: "fetched";
      job: {
        company: string;
        title: string;
        location: string | null;
        url: string;
      };
    }
  | { kind: "unknown"; url: string };
