/**
 * Step 1: the posting's full text. Most postings come from the Simplify
 * aggregators with no description at all, so the worker fetches it the
 * first time someone tailors to that posting, and caches it on the posting
 * (postings.fetched_description) for everyone after.
 *
 * Where from, in order: the ATS's public job API when the link is a
 * Greenhouse, Lever or Ashby job (lib/questions/locate.ts finds the board),
 * else the posting page itself as plain text. Most other ATS pages (Workday,
 * iCIMS) are drawn by JavaScript and come back nearly empty, which the
 * pipeline then reports as "not enough text" rather than guessing.
 *
 * Never throws: null when nothing usable came back.
 */

import { USER_AGENT } from "@/lib/http";
import { type BoardHint, locateForm } from "@/lib/questions/locate";
import { htmlToText } from "@/lib/sources/text";

const TIMEOUT_MS = 10_000;
const MAX_CHARS = 30_000;
/** Less than this from a whole page is a shell, not a posting. */
const MIN_PAGE_CHARS = 400;

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`${new URL(url).hostname} ${response.status}`);
  return response.json();
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

async function fromGreenhouse(
  fetchImpl: typeof fetch,
  slug: string,
  jobId: string,
): Promise<string | null> {
  const json = (await getJson(
    fetchImpl,
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}`,
  )) as { content?: unknown } | null;
  return json ? htmlToText(str(json.content)) : null;
}

async function fromLever(
  fetchImpl: typeof fetch,
  slug: string,
  jobId: string,
  eu: boolean,
): Promise<string | null> {
  const host = eu ? "api.eu.lever.co" : "api.lever.co";
  const json = (await getJson(
    fetchImpl,
    `https://${host}/v0/postings/${encodeURIComponent(slug)}/${encodeURIComponent(jobId)}`,
  )) as {
    descriptionPlain?: unknown;
    lists?: { text?: unknown; content?: unknown }[];
    additionalPlain?: unknown;
  } | null;
  if (!json) return null;
  const lists = (json.lists ?? []).map(
    (l) => `${str(l.text)}\n${htmlToText(str(l.content))}`,
  );
  return [str(json.descriptionPlain), ...lists, str(json.additionalPlain)]
    .join("\n\n")
    .trim();
}

async function fromAshby(
  fetchImpl: typeof fetch,
  slug: string,
  jobId: string,
): Promise<string | null> {
  const json = (await getJson(
    fetchImpl,
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
  )) as {
    jobs?: {
      id?: unknown;
      descriptionPlain?: unknown;
      descriptionHtml?: unknown;
    }[];
  } | null;
  const job = json?.jobs?.find((j) => j.id === jobId);
  if (!job) return null;
  return str(job.descriptionPlain) || htmlToText(str(job.descriptionHtml));
}

async function fromPage(
  fetchImpl: typeof fetch,
  url: string,
): Promise<string | null> {
  if (!/^https:\/\//i.test(url)) return null;
  const response = await fetchImpl(url, {
    headers: { accept: "text/html", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) return null;
  if (!/text\/html/i.test(response.headers.get("content-type") ?? "")) {
    return null;
  }
  const text = htmlToText(await response.text());
  return text.length >= MIN_PAGE_CHARS ? text : null;
}

export async function fetchPostingText(
  posting: { url: string; canonical_url: string; company: string },
  boards: BoardHint[],
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const location = locateForm({
    urls: [posting.url, posting.canonical_url],
    company: posting.company,
    boards,
  });
  try {
    if (location) {
      for (const { slug, eu } of location.candidates) {
        const text =
          location.ats === "greenhouse"
            ? await fromGreenhouse(fetchImpl, slug, location.jobId)
            : location.ats === "lever"
              ? await fromLever(fetchImpl, slug, location.jobId, eu)
              : await fromAshby(fetchImpl, slug, location.jobId);
        if (text?.trim()) return text.trim().slice(0, MAX_CHARS);
      }
    }
    const page = await fromPage(fetchImpl, posting.url);
    return page ? page.slice(0, MAX_CHARS) : null;
  } catch (error) {
    console.warn(
      `[tailor] posting text: ${error instanceof Error ? error.message : "failed"}`,
    );
    return null;
  }
}
