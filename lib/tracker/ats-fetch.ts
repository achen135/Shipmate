import { USER_AGENT } from "@/lib/http";

/**
 * Manual add by URL, step 2: for a Greenhouse, Lever, or Ashby job page,
 * read company + title + location from the board's public API (the same
 * endpoints as the watcher, CLAUDE.md "Board APIs"). One request with a short
 * timeout; anything unexpected returns null and the user fills in a form.
 */

export type FetchedJob = {
  company: string;
  title: string;
  location: string | null;
  url: string;
};

type ApiRequest = {
  apiUrl: string;
  read: (json: unknown) => Omit<FetchedJob, "url"> | null;
};

export const FETCH_TIMEOUT_MS = 5000;

export async function fetchAtsJob(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedJob | null> {
  const request = atsApiRequest(url);
  if (!request) return null;
  try {
    const response = await fetchImpl(request.apiUrl, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const job = request.read(await response.json());
    return job ? { ...job, url: url.trim() } : null;
  } catch {
    return null;
  }
}

/** Which API to call for a job page URL, and how to read its answer. */
export function atsApiRequest(raw: string): ApiRequest | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const enc = encodeURIComponent;

  // Greenhouse: (job-)boards.greenhouse.io/{slug}/jobs/{id}, or the embed
  // form boards.greenhouse.io/embed/job_app?for={slug}&token={id}.
  if (/^(boards|job-boards)\.greenhouse\.io$/.test(host)) {
    const embed = segments[0] === "embed";
    const slug = embed ? url.searchParams.get("for") : segments[0];
    const id = embed ? url.searchParams.get("token") : segments[2];
    if (!slug || !id || !/^\d+$/.test(id) || (!embed && segments[1] !== "jobs"))
      return null;
    return {
      apiUrl: `https://boards-api.greenhouse.io/v1/boards/${enc(slug)}/jobs/${id}`,
      read: (json) => {
        const j = json as {
          title?: unknown;
          company_name?: unknown;
          location?: { name?: unknown };
        };
        const title = str(j.title);
        return title
          ? {
              company: str(j.company_name) ?? prettySlug(slug),
              title,
              location: str(j.location?.name),
            }
          : null;
      },
    };
  }

  // Lever: jobs.lever.co/{slug}/{id}
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const [slug, id] = segments;
    if (!slug || !id || !UUID.test(id)) return null;
    const api =
      host === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co";
    return {
      apiUrl: `https://${api}/v0/postings/${enc(slug)}/${id}`,
      read: (json) => {
        const j = json as {
          text?: unknown;
          categories?: { location?: unknown };
        };
        const title = str(j.text);
        return title
          ? {
              company: prettySlug(slug),
              title,
              location: str(j.categories?.location),
            }
          : null;
      },
    };
  }

  // Ashby: jobs.ashbyhq.com/{slug}/{id}. The public API lists the board.
  if (host === "jobs.ashbyhq.com") {
    const [slug, id] = segments;
    if (!slug || !id || !UUID.test(id)) return null;
    return {
      apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${enc(slug)}`,
      read: (json) => {
        const jobs = (json as { jobs?: unknown }).jobs;
        if (!Array.isArray(jobs)) return null;
        const job = jobs.find(
          (j: { id?: unknown }) =>
            typeof j?.id === "string" &&
            j.id.toLowerCase() === id.toLowerCase(),
        ) as { title?: unknown; location?: unknown } | undefined;
        const title = str(job?.title);
        return title
          ? { company: prettySlug(slug), title, location: str(job?.location) }
          : null;
      },
    };
  }

  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** "acme-robotics" → "Acme Robotics" (Lever and Ashby don't send a name). */
export function prettySlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
