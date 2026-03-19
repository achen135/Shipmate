import { fuzzyKey } from "./normalize";
import { type AtsJob, canonicalizeUrl, parseAtsJob } from "./url";

/**
 * Dedupe (CLAUDE.md "Dedupe order"): is this incoming job one we already
 * have? Checked in order:
 *   1. same ATS job id (parsed from the URL)
 *   2. same canonical URL
 *   3. same normalized company + title + first location, but only when that
 *      can't be two different jobs: never with a posting the same source
 *      already lists separately (Simplify reposts keep their own ids), and
 *      never when both sides have ATS ids (they'd have matched in step 1).
 */

export type DedupeKeys = {
  ats: AtsJob | null;
  canonicalUrl: string;
  fuzzy: string | null;
};

export function dedupeKeys(posting: {
  url: string;
  company: string;
  title: string;
  locations: readonly string[];
}): DedupeKeys {
  return {
    ats: parseAtsJob(posting.url),
    canonicalUrl: canonicalizeUrl(posting.url),
    fuzzy: fuzzyKey(posting),
  };
}

export type DedupeMatch = {
  postingId: string;
  by: "ats" | "canonical" | "fuzzy";
};

const atsKey = (ats: AtsJob) => `${ats.ats}:${ats.jobId}`;

/** In-memory lookup over every known posting and each of its links' keys. */
export class DedupeIndex {
  private byAts = new Map<string, string>();
  private byCanonical = new Map<string, string>();
  private byFuzzy = new Map<string, string[]>();
  private sourcesOf = new Map<string, Set<string>>();
  private withAts = new Set<string>();

  /**
   * Record that `postingId` answers to these keys. `sourceId` = the source
   * whose link carries them (omit for keys read off the posting row).
   */
  add(postingId: string, keys: DedupeKeys, sourceId?: string): void {
    if (keys.ats) {
      this.byAts.set(atsKey(keys.ats), postingId);
      this.withAts.add(postingId);
    }
    this.byCanonical.set(keys.canonicalUrl, postingId);
    if (keys.fuzzy) {
      const list = this.byFuzzy.get(keys.fuzzy) ?? [];
      if (!list.includes(postingId)) list.push(postingId);
      this.byFuzzy.set(keys.fuzzy, list);
    }
    if (sourceId) {
      const sources = this.sourcesOf.get(postingId) ?? new Set();
      sources.add(sourceId);
      this.sourcesOf.set(postingId, sources);
    }
  }

  find(keys: DedupeKeys, sourceId: string): DedupeMatch | null {
    const byAts = keys.ats && this.byAts.get(atsKey(keys.ats));
    if (byAts) return { postingId: byAts, by: "ats" };

    const byCanonical = this.byCanonical.get(keys.canonicalUrl);
    if (byCanonical) return { postingId: byCanonical, by: "canonical" };

    if (!keys.fuzzy) return null;
    for (const postingId of this.byFuzzy.get(keys.fuzzy) ?? []) {
      if (this.sourcesOf.get(postingId)?.has(sourceId)) continue;
      if (keys.ats && this.withAts.has(postingId)) continue;
      return { postingId, by: "fuzzy" };
    }
    return null;
  }
}
