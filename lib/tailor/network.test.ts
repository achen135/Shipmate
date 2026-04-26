// @vitest-environment node
import { describe, expect, it } from "vitest";

import { scriptedProvider } from "./__fixtures__/fake-provider";
import { fetchPostingText } from "./posting-text";
import { NO_RESEARCH, researchCompany, verifyResearch } from "./research";

function fakeFetch(
  routes: Record<string, { type: string; body: string } | number>,
) {
  const seen: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    const route = routes[url];
    if (route === undefined || typeof route === "number") {
      return new Response("", {
        status: typeof route === "number" ? route : 404,
      });
    }
    return new Response(route.body, {
      headers: { "content-type": route.type },
    });
  }) as typeof fetch;
  return { impl, seen };
}

const json = (body: unknown) => ({
  type: "application/json",
  body: JSON.stringify(body),
});
const LONG = "We build ships. ".repeat(40);

describe("fetchPostingText", () => {
  it("Greenhouse: the job API's content, as plain text", async () => {
    const { impl } = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123": json({
        content: "&lt;p&gt;Build &amp;amp; ship.&lt;/p&gt;",
      }),
    });
    const text = await fetchPostingText(
      {
        url: "https://boards.greenhouse.io/acme/jobs/123",
        canonical_url: "https://boards.greenhouse.io/acme/jobs/123",
        company: "Acme",
      },
      [],
      impl,
    );
    expect(text).toBe("Build & ship.");
  });

  it("Lever and Ashby: their public posting APIs", async () => {
    const lever = fakeFetch({
      "https://api.lever.co/v0/postings/acme/5b3c4b9e-1f2a-4c3d-9e8f-0a1b2c3d4e5f":
        json({
          descriptionPlain: "Intro.",
          lists: [{ text: "Requirements", content: "<li>Python</li>" }],
          additionalPlain: "Benefits.",
        }),
    });
    expect(
      await fetchPostingText(
        {
          url: "https://jobs.lever.co/acme/5b3c4b9e-1f2a-4c3d-9e8f-0a1b2c3d4e5f",
          canonical_url:
            "https://jobs.lever.co/acme/5b3c4b9e-1f2a-4c3d-9e8f-0a1b2c3d4e5f",
          company: "Acme",
        },
        [],
        lever.impl,
      ),
    ).toBe("Intro.\n\nRequirements\n- Python\n\nBenefits.");

    const ashby = fakeFetch({
      "https://api.ashbyhq.com/posting-api/job-board/acme": json({
        jobs: [
          {
            id: "7d9e2f10-3a4b-4c5d-8e6f-1a2b3c4d5e6f",
            descriptionPlain: "Ashby text.",
          },
        ],
      }),
    });
    expect(
      await fetchPostingText(
        {
          url: "https://jobs.ashbyhq.com/acme/7d9e2f10-3a4b-4c5d-8e6f-1a2b3c4d5e6f",
          canonical_url:
            "https://jobs.ashbyhq.com/acme/7d9e2f10-3a4b-4c5d-8e6f-1a2b3c4d5e6f",
          company: "Acme",
        },
        [],
        ashby.impl,
      ),
    ).toBe("Ashby text.");
  });

  it("anything else: the page itself, only if it has real text", async () => {
    const page = fakeFetch({
      "https://acme.com/jobs/1": {
        type: "text/html",
        body: `<main>${LONG}</main><script>x()</script>`,
      },
      "https://shell.com/jobs/1": {
        type: "text/html",
        body: "<div id=root></div>",
      },
    });
    const posting = (url: string) => ({
      url,
      canonical_url: url,
      company: "Acme",
    });
    expect(
      await fetchPostingText(posting("https://acme.com/jobs/1"), [], page.impl),
    ).toBe(LONG.trim());
    expect(
      await fetchPostingText(
        posting("https://shell.com/jobs/1"),
        [],
        page.impl,
      ),
    ).toBeNull();
  });

  it("a server error is null, not a throw", async () => {
    const { impl } = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123": 503,
    });
    expect(
      await fetchPostingText(
        {
          url: "https://boards.greenhouse.io/acme/jobs/123",
          canonical_url: "https://boards.greenhouse.io/acme/jobs/123",
          company: "Acme",
        },
        [],
        impl,
      ),
    ).toBeNull();
  });
});

describe("company research", () => {
  it("no site, no board: nothing found, and no AI call", async () => {
    const { provider, calls } = scriptedProvider({});
    const { impl, seen } = fakeFetch({});
    const result = await researchCompany(
      provider,
      { name: "Acme", website: null, careers_url: null },
      [],
      impl,
    );
    expect(result).toEqual({ research: NO_RESEARCH, usage: null });
    expect(calls).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("never fetches LinkedIn", async () => {
    const { provider } = scriptedProvider({});
    const { impl, seen } = fakeFetch({});
    await researchCompany(
      provider,
      {
        name: "Acme",
        website: null,
        careers_url: "https://www.linkedin.com/company/acme/jobs",
      },
      [],
      impl,
    );
    expect(seen).toEqual([]);
  });

  it("reads the site, /about and the Greenhouse intro; keeps only what they say", async () => {
    const { impl, seen } = fakeFetch({
      "https://acme.com/": {
        type: "text/html",
        body: `<p>Acme builds port software in Go and Postgres. ${LONG}</p>`,
      },
      "https://acme.com/about": {
        type: "text/html",
        body: "<p>We value craft and customer obsession.</p>",
      },
      "https://boards-api.greenhouse.io/v1/boards/acme": json({
        content: "&lt;p&gt;Join us.&lt;/p&gt;",
      }),
    });
    const { provider } = scriptedProvider({
      company_research: () => ({
        summary: "Acme builds port software.",
        values: ["customer obsession", "frugality"],
        tech: ["Go", "Postgres", "Kubernetes"],
      }),
    });
    const { research } = await researchCompany(
      provider,
      { name: "Acme", website: "acme.com", careers_url: null },
      [{ kind: "greenhouse", slug: "acme", eu: false }],
      impl,
    );
    expect(seen).toEqual([
      "https://acme.com/",
      "https://acme.com/about",
      "https://boards-api.greenhouse.io/v1/boards/acme",
    ]);
    expect(research).toEqual({
      status: "ok",
      summary: "Acme builds port software.",
      values: ["customer obsession"],
      tech: ["Go", "Postgres"],
      sources: [
        "https://acme.com/",
        "https://acme.com/about",
        "https://boards-api.greenhouse.io/v1/boards/acme",
      ],
    });
  });

  it("a summary the pages don't support is dropped", () => {
    expect(
      verifyResearch(
        {
          summary: "A leading AI unicorn backed by top VCs.",
          values: [],
          tech: [],
        },
        "Acme builds port software.",
      ).summary,
    ).toBe("");
  });
});
