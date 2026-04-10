import { USER_AGENT } from "@/lib/http";

import {
  ASHBY_GRAPHQL_URL,
  ashbyRequestBody,
  parseAshbyQuestions,
} from "./ashby";
import { parseGreenhouseQuestions } from "./greenhouse";
import { parseLeverQuestions } from "./lever";
import type { FormLocation } from "./locate";
import {
  type FetchedQuestions,
  MAX_QUESTIONS,
  type RawQuestion,
} from "./types";

/**
 * Fetch a posting's application form (CLAUDE.md "Question fetch"). Runs on
 * the server the first time anyone opens the posting; the result is cached
 * on the posting row (save_posting_questions), so each form is read once.
 *
 * Outcomes: `ok` (the questions), `unknown` (no such form at any candidate
 * slug, or no questions found), `failed` (a timeout or server error worth
 * retrying soon). Never throws.
 */

export const QUESTION_TIMEOUT_MS = 8000;

type Attempt = RawQuestion[] | "not_found";

async function get(
  fetchImpl: typeof fetch,
  url: string,
  accept: string,
): Promise<Response> {
  return fetchImpl(url, {
    headers: { accept, "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(QUESTION_TIMEOUT_MS),
    cache: "no-store",
  });
}

async function greenhouse(
  fetchImpl: typeof fetch,
  slug: string,
  jobId: string,
): Promise<Attempt> {
  const response = await get(
    fetchImpl,
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}?questions=true`,
    "application/json",
  );
  if (response.status === 404) return "not_found";
  if (!response.ok) throw new Error(`Greenhouse ${response.status}`);
  return parseGreenhouseQuestions(await response.json());
}

async function lever(
  fetchImpl: typeof fetch,
  slug: string,
  jobId: string,
  eu: boolean,
): Promise<Attempt> {
  const host = eu ? "jobs.eu.lever.co" : "jobs.lever.co";
  const response = await get(
    fetchImpl,
    `https://${host}/${encodeURIComponent(slug)}/${encodeURIComponent(jobId)}/apply`,
    "text/html",
  );
  if (response.status === 404) return "not_found";
  if (!response.ok) throw new Error(`Lever ${response.status}`);
  return parseLeverQuestions(await response.text());
}

async function ashby(
  fetchImpl: typeof fetch,
  slug: string,
  jobId: string,
): Promise<Attempt> {
  const response = await fetchImpl(ASHBY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    body: ashbyRequestBody(slug, jobId),
    signal: AbortSignal.timeout(QUESTION_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Ashby ${response.status}`);
  const json = (await response.json()) as {
    data?: { jobPosting?: unknown } | null;
  };
  // A wrong board name or a job that's gone: jobPosting is null.
  if (!json.data?.jobPosting) return "not_found";
  return parseAshbyQuestions(json);
}

export async function fetchQuestions(
  location: FormLocation | null,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedQuestions> {
  if (!location || location.candidates.length === 0) {
    return { status: "unknown" };
  }
  try {
    for (const { slug, eu } of location.candidates) {
      const attempt =
        location.ats === "greenhouse"
          ? await greenhouse(fetchImpl, slug, location.jobId)
          : location.ats === "lever"
            ? await lever(fetchImpl, slug, location.jobId, eu)
            : await ashby(fetchImpl, slug, location.jobId);
      if (attempt === "not_found") continue;
      return attempt.length > 0
        ? { status: "ok", questions: attempt.slice(0, MAX_QUESTIONS) }
        : { status: "unknown" };
    }
    return { status: "unknown" };
  } catch (error) {
    console.error(
      `[questions] ${location.ats} fetch failed:`,
      error instanceof Error ? error.message : error,
    );
    return { status: "failed" };
  }
}
