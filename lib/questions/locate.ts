import { normalizeCompany } from "@/lib/postings/normalize";
import { parseAtsJob } from "@/lib/postings/url";

/**
 * Where is a posting's application form? Only Greenhouse, Lever, and Ashby
 * show it publicly, so those are the only ATSs located; anything else is
 * "unknown" and the review page says so.
 *
 * The job id comes from the posting's link (lib/postings/url.ts). The board
 * slug is the harder half: a Stripe job's link is `stripe.com/jobs/search
 * ?gh_jid=…`, which doesn't say "stripe" is the Greenhouse board. So the
 * candidates are, in order: the slug in the link itself, the boards Shipmate
 * watches for that posting (posting_boards()), and a guess from the company
 * name. The fetcher tries them until one answers.
 */

export type FormAts = "greenhouse" | "lever" | "ashby";

export type BoardHint = { kind: string; slug: string; eu: boolean };

export type FormLocation = {
  ats: FormAts;
  jobId: string;
  candidates: { slug: string; eu: boolean }[];
};

const MAX_CANDIDATES = 4;

/** The slug written in an ATS job link, if the link is one. */
function slugInLink(raw: string, ats: FormAts) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  if (ats === "greenhouse" && /(^|\.)greenhouse\.io$/.test(host)) {
    const slug =
      segments[0] === "embed" ? url.searchParams.get("for") : segments[0];
    return slug ? { slug, eu: false } : null;
  }
  if (ats === "lever" && /^jobs(\.eu)?\.lever\.co$/.test(host)) {
    return segments[0]
      ? { slug: segments[0], eu: host.includes(".eu.") }
      : null;
  }
  if (ats === "ashby" && host === "jobs.ashbyhq.com") {
    return segments[0] ? { slug: segments[0], eu: false } : null;
  }
  return null;
}

/** "Stripe, Inc." → stripe; "Jane Street Capital" → janestreet, jane-street. */
export function slugGuesses(company: string): string[] {
  const words = normalizeCompany(company).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  return [...new Set([words.join(""), words.join("-")])];
}

export function locateForm(posting: {
  urls: string[];
  company: string;
  boards: BoardHint[];
}): FormLocation | null {
  let job: { ats: FormAts; jobId: string } | null = null;
  for (const raw of posting.urls) {
    const parsed = parseAtsJob(raw);
    if (
      parsed &&
      (parsed.ats === "greenhouse" ||
        parsed.ats === "lever" ||
        parsed.ats === "ashby")
    ) {
      job = { ats: parsed.ats, jobId: parsed.jobId };
      break;
    }
  }
  if (!job) return null;

  const raw: { slug: string; eu: boolean }[] = [];
  for (const url of posting.urls) {
    const found = slugInLink(url, job.ats);
    if (found) raw.push(found);
  }
  for (const board of posting.boards) {
    if (board.kind === job.ats) raw.push({ slug: board.slug, eu: board.eu });
  }
  for (const slug of slugGuesses(posting.company)) {
    raw.push({ slug, eu: false });
  }

  const seen = new Set<string>();
  const candidates = raw.filter(({ slug, eu }) => {
    const key = `${slug.toLowerCase()}|${eu}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...job, candidates: candidates.slice(0, MAX_CANDIDATES) };
}
