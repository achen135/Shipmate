// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { NormalizedPosting, SourceRow } from "@/lib/sources/types";

import { DedupeIndex, dedupeKeys } from "./dedupe";
import {
  afterSnapshot,
  afterUnchanged,
  isLive,
  postingStatus,
} from "./lifecycle";
import {
  type IngestPlan,
  type IngestState,
  type Snapshot,
  buildState,
  combinePosting,
  planSource,
} from "./plan";

// ---------------------------------------------------------------- helpers

function posting(
  overrides: Partial<NormalizedPosting> = {},
): NormalizedPosting {
  return {
    sourceJobId: "job-1",
    company: "Stripe",
    title: "Software Engineer Intern",
    url: "https://job-boards.greenhouse.io/stripe/jobs/1001",
    locations: ["SF"],
    postedAt: "2026-10-01T12:00:00.000Z",
    terms: ["Summer 2027"],
    category: "Software",
    sponsorship: "unknown",
    degrees: ["Bachelor's"],
    description: null,
    ...overrides,
  };
}

const row = (p: NormalizedPosting, active = true): SourceRow => ({
  posting: p,
  active,
  raw: { id: p.sourceJobId },
});

function emptyState(): IngestState {
  return buildState({
    postings: [],
    links: [],
    companies: [],
    sources: [
      { id: "simplify", name: "Simplify Summer 2027" },
      { id: "vansh", name: "vanshb03 Summer 2027" },
      { id: "board", name: "Stripe board" },
    ],
  });
}

let counter = 0;
const opts = (now = "2026-10-10T00:00:00.000Z") => ({
  now,
  newId: () => `id-${++counter}`,
});

function run(
  state: IngestState,
  source: string,
  snapshot: Snapshot,
): IngestPlan {
  return planSource(state, source, snapshot, opts());
}

const fresh = (...rows: SourceRow[]): Snapshot => ({ kind: "fresh", rows });

function statusOf(state: IngestState, postingId: string) {
  return state.postings.get(postingId)?.status;
}

// ---------------------------------------------------------------- dedupe

describe("DedupeIndex", () => {
  const keysOf = (p: NormalizedPosting) => dedupeKeys(p);

  it("matches by ATS job id first, even across different URLs", () => {
    const index = new DedupeIndex();
    index.add("p1", keysOf(posting()), "simplify");
    const companySite = posting({
      url: "https://stripe.com/jobs/listing/swe-intern/1001?gh_jid=1001",
    });
    expect(index.find(keysOf(companySite), "board")).toEqual({
      postingId: "p1",
      by: "ats",
    });
  });

  it("then by canonical URL", () => {
    const index = new DedupeIndex();
    const oracle = posting({
      url: "https://egug.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/26013266",
    });
    index.add("p1", keysOf(oracle), "simplify");
    const again = posting({
      url: `${oracle.url}/?utm_source=simplify`,
      title: "Different",
    });
    expect(index.find(keysOf(again), "vansh")).toEqual({
      postingId: "p1",
      by: "canonical",
    });
  });

  it("then by company + title + location", () => {
    const index = new DedupeIndex();
    const a = posting({
      url: "https://stripe.com/careers/a",
      company: "Stripe, Inc.",
    });
    index.add("p1", keysOf(a), "simplify");
    const b = posting({ url: "https://stripe.com/careers/b" });
    expect(index.find(keysOf(b), "vansh")).toEqual({
      postingId: "p1",
      by: "fuzzy",
    });
  });

  it("never fuzzy-merges two rows the same source lists separately", () => {
    const index = new DedupeIndex();
    index.add(
      "p1",
      keysOf(posting({ url: "https://stripe.com/careers/a" })),
      "simplify",
    );
    const repost = posting({ url: "https://stripe.com/careers/b" });
    expect(index.find(keysOf(repost), "simplify")).toBeNull();
  });

  it("never fuzzy-merges two different ATS jobs", () => {
    const index = new DedupeIndex();
    index.add("p1", keysOf(posting()), "simplify");
    const otherReq = posting({
      url: "https://job-boards.greenhouse.io/stripe/jobs/2002",
    });
    expect(index.find(keysOf(otherReq), "vansh")).toBeNull();
  });
});

describe("combinePosting", () => {
  it("takes identity from the primary, fills gaps, unions lists", () => {
    const combined = combinePosting([
      {
        data: posting({ category: null, locations: ["SF"], terms: [] }),
        sourceName: "A",
      },
      {
        data: posting({
          title: "SWE Intern",
          category: "Software",
          locations: ["SF", "Seattle"],
          terms: ["Summer 2027"],
          sponsorship: "offers",
          description: "Full description",
          postedAt: "2026-09-01T00:00:00.000Z",
        }),
        sourceName: "B",
      },
    ]);
    expect(combined).toMatchObject({
      title: "Software Engineer Intern",
      category: "Software",
      locations: ["SF", "Seattle"],
      terms: ["Summer 2027"],
      sponsorship: "offers",
      description: "Full description",
      postedAt: "2026-09-01T00:00:00.000Z",
      ats: "greenhouse",
      atsJobId: "1001",
      sourceNames: ["A", "B"],
    });
  });
});

// ---------------------------------------------------------------- ingest

describe("planSource: new postings and dedupe across feeds", () => {
  it("inserts a company, a posting, and a link for a new active row", () => {
    const state = emptyState();
    const plan = run(state, "simplify", fresh(row(posting())));
    expect(plan.companies).toEqual([
      expect.objectContaining({ name: "Stripe", normalized_name: "stripe" }),
    ]);
    expect(plan.insertPostings).toHaveLength(1);
    expect(plan.insertPostings[0]).toMatchObject({
      title: "Software Engineer Intern",
      canonical_url: "https://job-boards.greenhouse.io/stripe/jobs/1001",
      ats: "greenhouse",
      ats_job_id: "1001",
      status: "open",
      source_names: ["Simplify Summer 2027"],
    });
    expect(plan.insertLinks).toHaveLength(1);
    expect(plan.newPostingIds).toEqual([plan.insertPostings[0].id]);
    expect(plan.stats).toMatchObject({ rows: 1, active: 1, new: 1 });
  });

  it("never creates a posting from an inactive row", () => {
    const plan = run(emptyState(), "simplify", fresh(row(posting(), false)));
    expect(plan.insertPostings).toHaveLength(0);
    expect(plan.stats).toMatchObject({ rows: 1, active: 0, new: 0 });
  });

  it("links the same job from a second feed instead of duplicating it", () => {
    const state = emptyState();
    const first = run(state, "simplify", fresh(row(posting())));
    const id = first.insertPostings[0].id;

    // vanshb03 lists the same Greenhouse job under its own row id, with the
    // form URL and a term the first feed didn't have.
    const second = run(
      state,
      "vansh",
      fresh(
        row(
          posting({
            sourceJobId: "vansh-9",
            url: "https://job-boards.greenhouse.io/stripe/jobs/1001?gh_src=x",
            terms: ["Fall 2026"],
          }),
        ),
      ),
    );
    expect(second.insertPostings).toHaveLength(0);
    expect(second.newPostingIds).toHaveLength(0);
    expect(second.insertLinks).toEqual([
      expect.objectContaining({ posting_id: id, source_id: "vansh" }),
    ]);
    expect(second.updatePostings).toEqual([
      expect.objectContaining({
        id,
        terms: ["Summer 2027", "Fall 2026"],
        source_names: ["Simplify Summer 2027", "vanshb03 Summer 2027"],
      }),
    ]);
    expect(second.stats).toMatchObject({ new: 0, merged: 1, updated: 1 });
  });

  it("dedupes within one snapshot too", () => {
    const state = emptyState();
    const plan = run(
      state,
      "simplify",
      fresh(
        row(posting({ sourceJobId: "a" })),
        row(
          posting({
            sourceJobId: "b",
            url: "https://boards.greenhouse.io/stripe/jobs/1001",
          }),
        ),
      ),
    );
    expect(plan.insertPostings).toHaveLength(1);
    expect(plan.insertLinks).toHaveLength(2);
  });

  it("writes nothing for an unchanged row, but marks it seen", () => {
    const state = emptyState();
    run(state, "simplify", fresh(row(posting())));
    const again = run(state, "simplify", fresh(row(posting())));
    expect(again).toMatchObject({
      insertPostings: [],
      updatePostings: [],
      insertLinks: [],
      updateLinks: [],
      companies: [],
    });
    expect(again.seenLinkIds).toHaveLength(1);
  });

  it("updates the posting when its source changes the row", () => {
    const state = emptyState();
    run(state, "simplify", fresh(row(posting())));
    const plan = run(
      state,
      "simplify",
      fresh(row(posting({ title: "Software Engineer Intern (Payments)" }))),
    );
    expect(plan.updateLinks).toEqual([
      expect.objectContaining({
        content_hash: expect.any(String),
        data: expect.anything(),
      }),
    ]);
    expect(plan.updatePostings[0]).toMatchObject({
      title: "Software Engineer Intern (Payments)",
    });
  });
});

describe("planSource: closing postings", () => {
  function seeded() {
    const state = emptyState();
    const plan = run(state, "simplify", fresh(row(posting())));
    return { state, id: plan.insertPostings[0].id };
  }
  const other = row(
    posting({ sourceJobId: "other", url: "https://x.com/2", title: "Other" }),
  );

  it("closes after 2 consecutive snapshots without the job", () => {
    const { state, id } = seeded();
    const miss1 = run(state, "simplify", fresh(other));
    expect(miss1.updateLinks).toEqual([
      expect.objectContaining({ active: true, missed_runs: 1 }),
    ]);
    expect(statusOf(state, id)).toBe("open");

    const miss2 = run(state, "simplify", fresh(other));
    expect(statusOf(state, id)).toBe("closed");
    expect(miss2.updatePostings).toEqual([
      expect.objectContaining({
        id,
        status: "closed",
        closed_at: "2026-10-10T00:00:00.000Z",
      }),
    ]);
    expect(miss2.stats.closed).toBe(1);

    // Further misses don't rewrite anything.
    const miss3 = run(state, "simplify", fresh(other));
    expect(miss3.updateLinks).toHaveLength(0);
    expect(miss3.updatePostings).toHaveLength(0);
  });

  it("a failed fetch doesn't count as missing", () => {
    const { state, id } = seeded();
    run(state, "simplify", fresh(other)); // miss 1
    const failed = run(state, "simplify", { kind: "failed" });
    expect(failed.updateLinks).toHaveLength(0);
    expect(failed.seenLinkIds).toHaveLength(0);
    run(state, "simplify", { kind: "failed" });
    expect(statusOf(state, id)).toBe("open");

    // Back in the next snapshot: misses reset.
    const back = run(state, "simplify", fresh(row(posting()), other));
    expect(back.updateLinks).toEqual(
      expect.arrayContaining([expect.objectContaining({ missed_runs: 0 })]),
    );
    run(state, "simplify", fresh(other));
    expect(statusOf(state, id)).toBe("open");
  });

  it("an unchanged check keeps counting a job that was already missing", () => {
    const { state, id } = seeded();
    run(state, "simplify", fresh(other)); // miss 1
    run(state, "simplify", { kind: "unchanged" }); // still missing → 2
    expect(statusOf(state, id)).toBe("closed");
  });

  it("an unchanged check leaves listed jobs alone", () => {
    const { state, id } = seeded();
    const plan = run(state, "simplify", { kind: "unchanged" });
    expect(plan.updateLinks).toHaveLength(0);
    expect(statusOf(state, id)).toBe("open");
  });

  it("closes at once when the source marks the job inactive", () => {
    const { state, id } = seeded();
    const plan = run(state, "simplify", fresh(row(posting(), false)));
    expect(statusOf(state, id)).toBe("closed");
    expect(plan.seenLinkIds).toHaveLength(0);
  });

  it("reopens when the job comes back", () => {
    const { state, id } = seeded();
    run(state, "simplify", fresh(row(posting(), false)));
    const plan = run(state, "simplify", fresh(row(posting())));
    expect(statusOf(state, id)).toBe("open");
    expect(plan.updatePostings[0]).toMatchObject({
      status: "open",
      closed_at: null,
    });
    expect(plan.stats.reopened).toBe(1);
  });

  it("stays open while another source still lists it", () => {
    const state = emptyState();
    const first = run(state, "simplify", fresh(row(posting())));
    const id = first.insertPostings[0].id;
    run(state, "vansh", fresh(row(posting({ sourceJobId: "v1" }))));
    run(state, "simplify", fresh(row(posting(), false)));
    expect(statusOf(state, id)).toBe("open");
    run(state, "vansh", fresh(row(posting({ sourceJobId: "v1" }), false)));
    expect(statusOf(state, id)).toBe("closed");
  });
});

describe("lifecycle rules", () => {
  it("a link is live while active and missed fewer than 2 times", () => {
    expect(isLive({ active: true, missedRuns: 1 })).toBe(true);
    expect(isLive({ active: true, missedRuns: 2 })).toBe(false);
    expect(isLive({ active: false, missedRuns: 0 })).toBe(false);
    expect(postingStatus([])).toBe("closed");
  });

  it("misses are capped and inactive links don't count misses", () => {
    expect(afterSnapshot({ active: true, missedRuns: 2 }, null)).toEqual({
      active: true,
      missedRuns: 2,
    });
    expect(afterSnapshot({ active: false, missedRuns: 0 }, null)).toEqual({
      active: false,
      missedRuns: 0,
    });
    expect(afterUnchanged({ active: true, missedRuns: 0 })).toEqual({
      active: true,
      missedRuns: 0,
    });
  });
});
