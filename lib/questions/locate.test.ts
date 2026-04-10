// @vitest-environment node
import { describe, expect, it } from "vitest";

import { locateForm, slugGuesses } from "./locate";

const none = { boards: [] };

describe("locateForm", () => {
  it("reads the slug and job id from a Greenhouse board link", () => {
    expect(
      locateForm({
        urls: ["https://boards.greenhouse.io/stripe/jobs/8194291"],
        company: "Stripe",
        ...none,
      }),
    ).toEqual({
      ats: "greenhouse",
      jobId: "8194291",
      candidates: [{ slug: "stripe", eu: false }],
    });
  });

  it("uses the watched board when the link is the company's own site (?gh_jid=)", () => {
    const location = locateForm({
      urls: ["https://stripe.com/jobs/search?gh_jid=8194291"],
      company: "Stripe, Inc.",
      boards: [{ kind: "greenhouse", slug: "stripe", eu: false }],
    });
    expect(location?.jobId).toBe("8194291");
    expect(location?.candidates[0]).toEqual({ slug: "stripe", eu: false });
  });

  it("guesses from the company name when nothing else says", () => {
    const location = locateForm({
      urls: ["https://janestreet.com/join?gh_jid=555"],
      company: "Jane Street, LLC",
      boards: [],
    });
    expect(location?.candidates.map((c) => c.slug)).toEqual([
      "janestreet",
      "jane-street",
    ]);
  });

  it("doesn't offer a board of the wrong kind", () => {
    const location = locateForm({
      urls: ["https://x.com/careers?gh_jid=1"],
      company: "X",
      boards: [{ kind: "lever", slug: "wrong", eu: false }],
    });
    expect(location?.candidates.map((c) => c.slug)).toEqual(["x"]);
  });

  it("handles Lever (including EU) and Ashby links", () => {
    const id = "774cf5c9-bf6a-4d77-bf60-d50ef1beb1a0";
    expect(
      locateForm({
        urls: [`https://jobs.lever.co/palantir/${id}`],
        company: "Palantir",
        ...none,
      })?.candidates[0],
    ).toEqual({ slug: "palantir", eu: false });
    expect(
      locateForm({
        urls: [`https://jobs.eu.lever.co/acme/${id}`],
        company: "Acme",
        ...none,
      })?.candidates[0],
    ).toEqual({ slug: "acme", eu: true });
    expect(
      locateForm({
        urls: [`https://jobs.ashbyhq.com/ramp/${id}`],
        company: "Ramp",
        ...none,
      }),
    ).toMatchObject({ ats: "ashby", candidates: [{ slug: "ramp" }] });
  });

  it("finds the ATS in any of the posting's links", () => {
    const id = "774cf5c9-bf6a-4d77-bf60-d50ef1beb1a0";
    expect(
      locateForm({
        urls: [
          "https://company.com/careers/123",
          `https://jobs.lever.co/acme/${id}/apply`,
        ],
        company: "Acme",
        ...none,
      })?.ats,
    ).toBe("lever");
  });

  it("returns null for ATSs whose forms aren't public", () => {
    expect(
      locateForm({
        urls: [
          "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Intern_JR1",
        ],
        company: "NVIDIA",
        ...none,
      }),
    ).toBeNull();
    expect(
      locateForm({
        urls: ["https://careers.example.com/jobs/1"],
        company: "Example",
        ...none,
      }),
    ).toBeNull();
  });

  it("caps the number of candidates (each costs a request)", () => {
    const location = locateForm({
      urls: [
        "https://x.com/?gh_jid=1",
        "https://boards.greenhouse.io/a/jobs/1",
      ],
      company: "Big Long Name",
      boards: ["b", "c", "d"].map((slug) => ({
        kind: "greenhouse",
        slug,
        eu: false,
      })),
    });
    expect(location?.candidates).toHaveLength(4);
  });
});

describe("slugGuesses", () => {
  it("drops legal suffixes and punctuation", () => {
    expect(slugGuesses("Stripe, Inc.")).toEqual(["stripe"]);
    expect(slugGuesses("Two Sigma Investments, LLC")).toEqual([
      "twosigmainvestments",
      "two-sigma-investments",
    ]);
  });

  it("returns nothing for an empty name", () => {
    expect(slugGuesses("")).toEqual([]);
  });
});
