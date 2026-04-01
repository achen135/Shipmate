// @vitest-environment node
import { describe, expect, it } from "vitest";

import { type PostingKey, findExistingPosting, postingKeys } from "./lookup";

/** Postings as the database has them: primary-link keys only. */
const POSTINGS = [
  {
    id: "gh",
    ats: "greenhouse",
    ats_job_id: "4012345",
    canonical_url: "https://job-boards.greenhouse.io/stripe/jobs/4012345",
  },
  {
    id: "taleo",
    ats: null,
    ats_job_id: null,
    canonical_url: "https://acme.taleo.net/careersection/jobdetail.ftl?job=42",
  },
];

function finder(log: PostingKey[] = []) {
  return async (key: PostingKey) => {
    log.push(key);
    return (
      POSTINGS.find((p) =>
        key.by === "ats"
          ? p.ats === key.ats && p.ats_job_id === key.jobId
          : p.canonical_url === key.canonicalUrl,
      ) ?? null
    );
  };
}

describe("findExistingPosting (URL → existing posting)", () => {
  it("finds a posting by ATS job id under another URL shape", async () => {
    for (const url of [
      "https://boards.greenhouse.io/stripe/jobs/4012345?gh_src=abc",
      "https://stripe.com/jobs/search?gh_jid=4012345",
      "https://job-boards.greenhouse.io/stripe/jobs/4012345/application",
    ]) {
      expect((await findExistingPosting(url, finder()))?.id).toBe("gh");
    }
  });

  it("falls back to the canonical URL (tracking params, www, slash)", async () => {
    const log: PostingKey[] = [];
    const found = await findExistingPosting(
      "http://www.ACME.taleo.net/careersection/jobdetail.ftl/?utm_source=x&job=42",
      finder(log),
    );
    expect(found?.id).toBe("taleo");
    expect(log.map((k) => k.by)).toEqual(["canonical"]);
  });

  it("tries the ATS id before the URL, and stops at the first hit", async () => {
    const log: PostingKey[] = [];
    await findExistingPosting(
      "https://job-boards.greenhouse.io/stripe/jobs/4012345",
      finder(log),
    );
    expect(log).toEqual([{ by: "ats", ats: "greenhouse", jobId: "4012345" }]);
  });

  it("returns null for unknown jobs and non-URLs", async () => {
    expect(
      await findExistingPosting(
        "https://jobs.lever.co/acme/0f9c7a52-3d8c-4c39-9a85-6a3b6b0e8f11",
        finder(),
      ),
    ).toBeNull();
    expect(postingKeys("Stripe SWE intern")).toEqual([]);
    expect(postingKeys("javascript:alert(1)")).toEqual([]);
  });
});
