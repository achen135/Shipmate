import type { Category, Sponsorship } from "@/lib/postings/normalize";

/**
 * Source adapter interface (Spec "Source adapter interface"). Each adapter
 * turns one upstream feed into rows of this shape; dedupe, lifecycle, and
 * matching never see upstream formats. A new source is a new adapter.
 */

export type SourceKind =
  | "simplify_repo"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workday";

export type NormalizedPosting = {
  /** The source's own id for the job, stable across snapshots. */
  sourceJobId: string;
  company: string;
  title: string;
  url: string;
  locations: string[];
  /** ISO timestamp, or null when the source doesn't say. */
  postedAt: string | null;
  /** e.g. ["Summer 2027"]; empty = unknown. */
  terms: string[];
  category: Category | null;
  sponsorship: Sponsorship;
  degrees: string[];
  description: string | null;
};

export type SourceRow = {
  posting: NormalizedPosting;
  /**
   * False when the source lists the job but says it's closed or hidden
   * (Simplify `active` / `is_visible`). Closes a known posting at once; never
   * creates a new one.
   */
  active: boolean;
  /** The upstream row as received, kept in posting_sources.raw. */
  raw: unknown;
};

/**
 * What one check of a source produced:
 * - fresh: a full snapshot of everything the source lists right now.
 * - unchanged: the upstream version (commit SHA / ETag) matches the last
 *   snapshot, so nothing was downloaded and the last snapshot still holds.
 * A failed check throws instead; it never counts as a snapshot.
 */
export type FetchResult =
  | {
      kind: "fresh";
      version: string | null;
      rows: SourceRow[];
      /** Rows in the upstream file that couldn't be parsed. */
      invalid: number;
    }
  | { kind: "unchanged"; version: string };

export type SourceRecord = {
  id: string;
  kind: SourceKind;
  name: string;
  config: unknown;
  lastVersion: string | null;
};

export type FetchContext = {
  fetch: typeof fetch;
  /** Workflow GITHUB_TOKEN; optional locally (unauthenticated API = 60 req/h). */
  githubToken?: string;
  /** Something worth a line in the run log that isn't a failure. */
  warn?: (message: string) => void;
};

/**
 * A check of a best-effort source (Workday's undocumented API) that didn't
 * work. Unlike an ordinary error it is not a source-health alert and not a
 * snapshot: the last snapshot simply stays as it was.
 */
export class BestEffortFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BestEffortFailure";
  }
}

export type SourceAdapter = {
  kind: SourceKind;
  fetch(source: SourceRecord, ctx: FetchContext): Promise<FetchResult>;
};
