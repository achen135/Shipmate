// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { atsApiRequest, fetchAtsJob, prettySlug } from "./ats-fetch";

const LEVER_ID = "6ed76ce8-4156-4b60-b120-403538bd66cd";
const ASHBY_ID = "34413f8d-26bf-4bbc-8ade-eb309a0e2245";

function respond(body: unknown, status = 200) {
  return vi.fn(async () =>
    Response.json(body, { status }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("atsApiRequest", () => {
  it.each([
    [
      "https://boards.greenhouse.io/stripe/jobs/8172510?gh_src=x",
      "https://boards-api.greenhouse.io/v1/boards/stripe/jobs/8172510",
    ],
    [
      "https://job-boards.greenhouse.io/stripe/jobs/8172510",
      "https://boards-api.greenhouse.io/v1/boards/stripe/jobs/8172510",
    ],
    [
      "https://boards.greenhouse.io/embed/job_app?for=stripe&token=8172510",
      "https://boards-api.greenhouse.io/v1/boards/stripe/jobs/8172510",
    ],
    [
      `https://jobs.lever.co/palantir/${LEVER_ID}/apply`,
      `https://api.lever.co/v0/postings/palantir/${LEVER_ID}`,
    ],
    [
      `https://jobs.ashbyhq.com/ramp/${ASHBY_ID}/application`,
      "https://api.ashbyhq.com/posting-api/job-board/ramp",
    ],
  ])("%s → %s", (url, api) => {
    expect(atsApiRequest(url)?.apiUrl).toBe(api);
  });

  it.each([
    "https://stripe.com/jobs/search?gh_jid=8172510", // no board slug
    "https://boards.greenhouse.io/stripe",
    "https://jobs.lever.co/palantir",
    "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/X_R1",
    "not a url",
  ])("no API for %s", (url) => {
    expect(atsApiRequest(url)).toBeNull();
  });
});

describe("fetchAtsJob", () => {
  it("reads Greenhouse's company name, title, and location", async () => {
    const fetchImpl = respond({
      title: "Software Engineer Intern",
      company_name: "Stripe",
      location: { name: "Seattle, San Francisco" },
    });
    const url = "https://boards.greenhouse.io/stripe/jobs/8172510";
    expect(await fetchAtsJob(url, fetchImpl)).toEqual({
      company: "Stripe",
      title: "Software Engineer Intern",
      location: "Seattle, San Francisco",
      url,
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("user-agent")).toMatch(/^Shipmate\//);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("names Lever and Ashby companies from the slug", async () => {
    expect(
      await fetchAtsJob(
        `https://jobs.lever.co/acme-robotics/${LEVER_ID}`,
        respond({ text: "Intern", categories: { location: "Austin, TX" } }),
      ),
    ).toMatchObject({ company: "Acme Robotics", location: "Austin, TX" });
    expect(
      await fetchAtsJob(
        `https://jobs.ashbyhq.com/ramp/${ASHBY_ID.toUpperCase()}`,
        respond({
          jobs: [
            { id: "other", title: "Nope" },
            { id: ASHBY_ID, title: " Backend Intern", location: "NYC" },
          ],
        }),
      ),
    ).toMatchObject({
      company: "Ramp",
      title: "Backend Intern",
      location: "NYC",
    });
  });

  it("returns null on errors, odd bodies, and missing jobs", async () => {
    const gh = "https://boards.greenhouse.io/stripe/jobs/1";
    expect(await fetchAtsJob(gh, respond({ error: "x" }, 404))).toBeNull();
    expect(await fetchAtsJob(gh, respond({ nothing: true }))).toBeNull();
    expect(
      await fetchAtsJob(
        gh,
        vi.fn(async () => {
          throw new Error("timeout");
        }) as unknown as typeof fetch,
      ),
    ).toBeNull();
    expect(
      await fetchAtsJob(
        `https://jobs.ashbyhq.com/ramp/${ASHBY_ID}`,
        respond({ jobs: [] }),
      ),
    ).toBeNull();
  });

  it("doesn't fetch anything for other sites", async () => {
    const fetchImpl = respond({});
    expect(
      await fetchAtsJob("https://example.com/job/1", fetchImpl),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("prettySlug", () => {
  it("title-cases slugs", () => {
    expect(prettySlug("acme_robotics-co")).toBe("Acme Robotics Co");
  });
});
