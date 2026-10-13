// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { fetchQuestions } from "./fetch";
import type { FormLocation } from "./locate";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");

const reply = (body: string, status = 200) => new Response(body, { status });
const mockFetch = (handler: (url: string, init?: RequestInit) => Response) =>
  vi.fn<typeof fetch>(async (input, init) => handler(String(input), init));

const greenhouse = (slugs: string[]): FormLocation => ({
  ats: "greenhouse",
  jobId: "8194291",
  candidates: slugs.map((slug) => ({ slug, eu: false })),
});

describe("fetchQuestions", () => {
  it("reads a Greenhouse form from the official questions endpoint", async () => {
    const http = mockFetch(() =>
      reply(fixture("greenhouse-stripe-questions.json")),
    );
    const result = await fetchQuestions(greenhouse(["stripe"]), http);
    expect(result.status).toBe("ok");
    expect(String(http.mock.calls[0][0])).toBe(
      "https://boards-api.greenhouse.io/v1/boards/stripe/jobs/8194291?questions=true",
    );
  });

  it("tries the next slug when a guess 404s", async () => {
    const http = mockFetch((url) =>
      url.includes("/boards/wrong/")
        ? reply("{}", 404)
        : reply(fixture("greenhouse-stripe-questions.json")),
    );
    const result = await fetchQuestions(greenhouse(["wrong", "stripe"]), http);
    expect(result.status).toBe("ok");
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("says unknown when every slug 404s", async () => {
    const http = mockFetch(() => reply("{}", 404));
    expect(await fetchQuestions(greenhouse(["a", "b"]), http)).toEqual({
      status: "unknown",
    });
  });

  it("reports a failure on a server error, without trying other slugs", async () => {
    const http = mockFetch(() => reply("oops", 503));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await fetchQuestions(greenhouse(["a", "b"]), http)).toEqual({
      status: "failed",
    });
    expect(http).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });

  it("reports a failure when the network throws or the body isn't what we expect", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    expect(await fetchQuestions(greenhouse(["a"]), thrown)).toEqual({
      status: "failed",
    });
    expect(
      await fetchQuestions(
        greenhouse(["a"]),
        mockFetch(() => reply('{"nope":1}')),
      ),
    ).toEqual({ status: "failed" });
    quiet.mockRestore();
  });

  it("is unknown without a location or candidates (Workday, unknown ATS)", async () => {
    const http = mockFetch(() => reply("{}"));
    expect(await fetchQuestions(null, http)).toEqual({ status: "unknown" });
    expect(await fetchQuestions(greenhouse([]), http)).toEqual({
      status: "unknown",
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("reads a Lever form from the apply page, EU boards from the EU host", async () => {
    const http = mockFetch(() => reply(fixture("lever-palantir-apply.html")));
    const id = "774cf5c9-bf6a-4d77-bf60-d50ef1beb1a0";
    const result = await fetchQuestions(
      { ats: "lever", jobId: id, candidates: [{ slug: "acme", eu: true }] },
      http,
    );
    expect(result.status).toBe("ok");
    expect(String(http.mock.calls[0][0])).toBe(
      `https://jobs.eu.lever.co/acme/${id}/apply`,
    );
  });

  it("reads an Ashby form through the GraphQL call; a null posting is a wrong board", async () => {
    const id = "34413f8d-26bf-4bbc-8ade-eb309a0e2245";
    const http = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        variables: { organizationHostedJobsPageName: string };
      };
      return body.variables.organizationHostedJobsPageName === "ramp"
        ? reply(fixture("ashby-ramp-security.json"))
        : reply('{"data":{"jobPosting":null}}');
    });
    const result = await fetchQuestions(
      {
        ats: "ashby",
        jobId: id,
        candidates: [
          { slug: "ramps", eu: false },
          { slug: "ramp", eu: false },
        ],
      },
      http,
    );
    expect(result.status).toBe("ok");
    expect(http.mock.calls[0][1]?.method).toBe("POST");
  });

  it("calls a form with no questions unknown", async () => {
    const http = mockFetch(() => reply('{"questions":[]}'));
    expect(await fetchQuestions(greenhouse(["a"]), http)).toEqual({
      status: "unknown",
    });
  });
});
