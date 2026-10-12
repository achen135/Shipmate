import { createHash, randomUUID } from "node:crypto";

import type { NormalizedPosting, SourceRow } from "@/lib/sources/types";

import { DedupeIndex, dedupeKeys } from "./dedupe";
import {
  type LinkLife,
  afterSnapshot,
  afterUnchanged,
  postingStatus,
  sameLife,
} from "./lifecycle";
import { normalizeCompany } from "./normalize";

/**
 * Ingest planning: given what the database holds and one source's snapshot,
 * decide every write (pure, no I/O; the worker applies the plan). Postings
 * are combined from all their links, so a job listed by two feeds is one row.
 *
 * planSource() also updates `state` to match the plan, so the next source in
 * the same run dedupes against this one's new postings.
 */

// ---------------------------------------------------------------- state

export type PostingState = {
  id: string;
  status: "open" | "closed";
  closedAt: string | null;
  hash: string;
  /** Not in the database yet (created by this run). */
  isNew?: boolean;
};

export type LinkState = LinkLife & {
  id: string;
  postingId: string;
  sourceId: string;
  sourceJobId: string;
  data: NormalizedPosting;
  hash: string;
  firstSeenAt: string;
};

export type IngestState = {
  postings: Map<string, PostingState>;
  links: Map<string, LinkState>;
  linkByJob: Map<string, string>;
  linksByPosting: Map<string, string[]>;
  /** normalized company name → company id */
  companies: Map<string, string>;
  sourceNames: Map<string, string>;
  index: DedupeIndex;
};

const jobKey = (sourceId: string, sourceJobId: string) =>
  `${sourceId}\u0000${sourceJobId}`;

export function buildState(input: {
  postings: (PostingState & {
    canonicalUrl: string;
    ats: string | null;
    atsJobId: string | null;
    fuzzyKey: string | null;
  })[];
  links: LinkState[];
  companies: { id: string; normalizedName: string }[];
  sources: { id: string; name: string }[];
}): IngestState {
  const state: IngestState = {
    postings: new Map(),
    links: new Map(),
    linkByJob: new Map(),
    linksByPosting: new Map(),
    companies: new Map(input.companies.map((c) => [c.normalizedName, c.id])),
    sourceNames: new Map(input.sources.map((s) => [s.id, s.name])),
    index: new DedupeIndex(),
  };
  for (const p of input.postings) {
    state.postings.set(p.id, {
      id: p.id,
      status: p.status,
      closedAt: p.closedAt,
      hash: p.hash,
    });
    // The row's own keys too, so a posting whose links were lost still dedupes.
    state.index.add(p.id, {
      ats:
        p.ats && p.atsJobId ? { ats: p.ats as never, jobId: p.atsJobId } : null,
      canonicalUrl: p.canonicalUrl,
      fuzzy: p.fuzzyKey,
    });
  }
  for (const link of input.links) addLink(state, link);
  return state;
}

function addLink(state: IngestState, link: LinkState): void {
  state.links.set(link.id, link);
  state.linkByJob.set(jobKey(link.sourceId, link.sourceJobId), link.id);
  const list = state.linksByPosting.get(link.postingId) ?? [];
  list.push(link.id);
  state.linksByPosting.set(link.postingId, list);
  state.index.add(link.postingId, dedupeKeys(link.data), link.sourceId);
}

// ---------------------------------------------------------------- combine

export type CombinedPosting = {
  company: string;
  title: string;
  url: string;
  canonicalUrl: string;
  ats: string | null;
  atsJobId: string | null;
  fuzzyKey: string | null;
  locations: string[];
  terms: string[];
  category: NormalizedPosting["category"];
  sponsorship: NormalizedPosting["sponsorship"];
  degrees: string[];
  description: string | null;
  postedAt: string | null;
  sourceNames: string[];
};

const union = (lists: string[][]) => [...new Set(lists.flat())];

/**
 * One posting from its links, oldest link first (the "primary"): identity
 * fields come from the primary, gaps are filled from the others, lists are
 * unioned, the longest description wins, and the earliest posted date wins.
 */
export function combinePosting(
  links: { data: NormalizedPosting; sourceName: string }[],
): CombinedPosting {
  const primary = links[0].data;
  const keys = dedupeKeys(primary);
  const datas = links.map((l) => l.data);
  const posted = datas
    .map((d) => d.postedAt)
    .filter((d): d is string => d !== null)
    .sort();
  return {
    company: primary.company,
    title: primary.title,
    url: primary.url,
    canonicalUrl: keys.canonicalUrl,
    ats: keys.ats?.ats ?? null,
    atsJobId: keys.ats?.jobId ?? null,
    fuzzyKey: keys.fuzzy,
    locations: union(datas.map((d) => d.locations)),
    terms: union(datas.map((d) => d.terms)),
    category: datas.find((d) => d.category)?.category ?? null,
    sponsorship:
      datas.find((d) => d.sponsorship !== "unknown")?.sponsorship ?? "unknown",
    degrees: union(datas.map((d) => d.degrees)),
    description:
      datas
        .map((d) => d.description)
        .filter((d): d is string => !!d)
        .sort((a, b) => b.length - a.length)[0] ?? null,
    postedAt: posted[0] ?? null,
    sourceNames: [...new Set(links.map((l) => l.sourceName))],
  };
}

export function stableHash(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

// ---------------------------------------------------------------- plan

/** Column names as in the database, ready to send. */
export type PostingRow = {
  id: string;
  company_id: string;
  title: string;
  url: string;
  canonical_url: string;
  ats: string | null;
  ats_job_id: string | null;
  fuzzy_key: string | null;
  locations: string[];
  terms: string[];
  category: string | null;
  sponsorship: string;
  degrees: string[];
  description: string | null;
  posted_at: string | null;
  source_names: string[];
  content_hash: string;
  status: "open" | "closed";
  closed_at: string | null;
};

export type NewLinkRow = {
  id: string;
  posting_id: string;
  source_id: string;
  source_job_id: string;
  data: NormalizedPosting;
  raw: unknown;
  content_hash: string;
  active: boolean;
  missed_runs: number;
  /** Explicit (not the column default) so link order matches the plan's. */
  first_seen_at: string;
};

/** For update_links(): content fields only when the content changed. */
export type LinkUpdate = {
  id: string;
  active: boolean;
  missed_runs: number;
  data?: NormalizedPosting;
  raw?: unknown;
  content_hash?: string;
};

export type SourceStats = {
  rows: number;
  active: number;
  new: number;
  merged: number;
  updated: number;
  closed: number;
  reopened: number;
};

export type IngestPlan = {
  companies: { id: string; name: string; normalized_name: string }[];
  insertPostings: PostingRow[];
  updatePostings: PostingRow[];
  insertLinks: NewLinkRow[];
  updateLinks: LinkUpdate[];
  /** Links listed (and active) in this snapshot: bump last_seen_at. */
  seenLinkIds: string[];
  /** Postings this snapshot created (candidates for matching). */
  newPostingIds: string[];
  stats: SourceStats;
};

/**
 * What one check of a source produced. `failed` is a check that errored: it
 * is not a snapshot, so it changes nothing (a job is never "missing" because
 * the fetch failed).
 */
export type Snapshot =
  | { kind: "fresh"; rows: SourceRow[] }
  | { kind: "unchanged" }
  | { kind: "failed" };

export type PlanOptions = { now?: string; newId?: () => string };

export function hashPosting(posting: NormalizedPosting): string {
  return stableHash(posting);
}

export function planSource(
  state: IngestState,
  sourceId: string,
  snapshot: Snapshot,
  { now = new Date().toISOString(), newId = randomUUID }: PlanOptions = {},
): IngestPlan {
  const plan: IngestPlan = {
    companies: [],
    insertPostings: [],
    updatePostings: [],
    insertLinks: [],
    updateLinks: [],
    seenLinkIds: [],
    newPostingIds: [],
    stats: {
      rows: 0,
      active: 0,
      new: 0,
      merged: 0,
      updated: 0,
      closed: 0,
      reopened: 0,
    },
  };
  const dirty = new Set<string>();
  const sourceLinks = [...state.links.values()].filter(
    (l) => l.sourceId === sourceId,
  );

  const setLife = (link: LinkState, next: LinkLife) => {
    if (sameLife(link, next)) return;
    link.active = next.active;
    link.missedRuns = next.missedRuns;
    plan.updateLinks.push({
      id: link.id,
      active: link.active,
      missed_runs: link.missedRuns,
    });
    dirty.add(link.postingId);
  };

  if (snapshot.kind === "failed") return plan;

  if (snapshot.kind === "unchanged") {
    for (const link of sourceLinks) setLife(link, afterUnchanged(link));
  } else {
    const listed = new Set<string>();
    for (const row of snapshot.rows) {
      const { posting } = row;
      plan.stats.rows += 1;
      if (row.active) plan.stats.active += 1;
      listed.add(posting.sourceJobId);

      const linkId = state.linkByJob.get(jobKey(sourceId, posting.sourceJobId));
      const link = linkId ? state.links.get(linkId) : undefined;
      if (link) {
        const hash = hashPosting(posting);
        const next = afterSnapshot(link, { active: row.active });
        if (hash !== link.hash) {
          link.data = posting;
          link.hash = hash;
          link.active = next.active;
          link.missedRuns = next.missedRuns;
          plan.updateLinks.push({
            id: link.id,
            active: link.active,
            missed_runs: link.missedRuns,
            data: posting,
            raw: row.raw,
            content_hash: hash,
          });
          state.index.add(link.postingId, dedupeKeys(posting), sourceId);
          dirty.add(link.postingId);
        } else {
          setLife(link, next);
        }
        if (row.active) plan.seenLinkIds.push(link.id);
        continue;
      }

      // Unknown job: only an active row may create anything.
      if (!row.active) continue;
      const keys = dedupeKeys(posting);
      const match = state.index.find(keys, sourceId);
      let postingId: string;
      if (match) {
        postingId = match.postingId;
        plan.stats.merged += 1;
      } else {
        postingId = newId();
        state.postings.set(postingId, {
          id: postingId,
          status: "open",
          closedAt: null,
          hash: "",
          isNew: true,
        });
        plan.newPostingIds.push(postingId);
        plan.stats.new += 1;
      }
      const newLink: LinkState = {
        id: newId(),
        postingId,
        sourceId,
        sourceJobId: posting.sourceJobId,
        data: posting,
        hash: hashPosting(posting),
        active: true,
        missedRuns: 0,
        firstSeenAt: now,
      };
      addLink(state, newLink);
      plan.insertLinks.push({
        id: newLink.id,
        posting_id: postingId,
        source_id: sourceId,
        source_job_id: posting.sourceJobId,
        data: posting,
        raw: row.raw,
        content_hash: newLink.hash,
        active: true,
        missed_runs: 0,
        first_seen_at: now,
      });
      dirty.add(postingId);
    }
    for (const link of sourceLinks) {
      if (!listed.has(link.sourceJobId))
        setLife(link, afterSnapshot(link, null));
    }
  }

  for (const postingId of dirty) recompute(state, postingId, plan, now, newId);
  return plan;
}

function companyId(
  state: IngestState,
  plan: IngestPlan,
  name: string,
  newId: () => string,
): string {
  const normalized = normalizeCompany(name) || name.trim().toLowerCase();
  const existing = state.companies.get(normalized);
  if (existing) return existing;
  const id = newId();
  state.companies.set(normalized, id);
  plan.companies.push({ id, name: name.trim(), normalized_name: normalized });
  return id;
}

function recompute(
  state: IngestState,
  postingId: string,
  plan: IngestPlan,
  now: string,
  newId: () => string,
): void {
  const posting = state.postings.get(postingId);
  const links = (state.linksByPosting.get(postingId) ?? [])
    .map((id) => state.links.get(id)!)
    .sort((a, b) =>
      a.firstSeenAt === b.firstSeenAt
        ? a.id.localeCompare(b.id)
        : a.firstSeenAt.localeCompare(b.firstSeenAt),
    );
  if (!posting || links.length === 0) return;

  const combined = combinePosting(
    links.map((l) => ({
      data: l.data,
      sourceName: state.sourceNames.get(l.sourceId) ?? "Unknown source",
    })),
  );
  const company = companyId(state, plan, combined.company, newId);
  const status = postingStatus(links);
  const hash = stableHash({ ...combined, company });
  const closedAt =
    status === "open"
      ? null
      : posting.status === "closed"
        ? posting.closedAt
        : now;

  const row: PostingRow = {
    id: postingId,
    company_id: company,
    title: combined.title,
    url: combined.url,
    canonical_url: combined.canonicalUrl,
    ats: combined.ats,
    ats_job_id: combined.atsJobId,
    fuzzy_key: combined.fuzzyKey,
    locations: combined.locations,
    terms: combined.terms,
    category: combined.category,
    sponsorship: combined.sponsorship,
    degrees: combined.degrees,
    description: combined.description,
    posted_at: combined.postedAt,
    source_names: combined.sourceNames,
    content_hash: hash,
    status,
    closed_at: closedAt,
  };

  if (posting.isNew) {
    plan.insertPostings.push(row);
    posting.isNew = false;
  } else if (hash !== posting.hash || status !== posting.status) {
    plan.updatePostings.push(row);
    if (status !== posting.status) {
      plan.stats[status === "closed" ? "closed" : "reopened"] += 1;
    } else {
      plan.stats.updated += 1;
    }
  } else {
    return;
  }
  posting.hash = hash;
  posting.status = status;
  posting.closedAt = closedAt;
}
