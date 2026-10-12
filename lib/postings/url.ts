/**
 * Apply-URL helpers for dedupe (CLAUDE.md "Dedupe order"):
 *   1. ATS job id parsed from the URL  → parseAtsJob()
 *   2. canonical URL                   → canonicalizeUrl()
 *   3. company + title + location      → normalize.ts fuzzyKey()
 */

/**
 * Query parameters that only track or change presentation, never which job.
 * Everything else is kept (sorted), because some boards identify the job in
 * the query: `?gh_jid=`, Taleo `?job=`, BrassRing `?jobid=`, Greenhouse
 * `embed/job_app?token=`. Dropping those would merge different jobs.
 */
const NOISE_PARAMS = new Set([
  "embed",
  "mobile",
  "needsredirect",
  "icims",
  "ats",
  "ref",
  "refs",
  "referrer",
  "source",
  "src",
  "gh_src",
  "lever-source",
  "lever-origin",
  "nl",
  "fr",
  "iis",
  "iisn",
]);

/** Trailing path segments that open the form instead of the job page. */
const FORM_SUFFIX = /\/(application|apply)\/?$/i;

/**
 * One stable string per job page: https, lowercase host without `www.`, no
 * fragment, no tracking params, no trailing `/application` or `/apply`, no
 * trailing slash. Path case is kept (Workday and Lever ids are mixed case).
 * Unparseable input comes back trimmed.
 */
export function canonicalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(FORM_SUFFIX, "").replace(/\/+$/, "");

  const kept = [...url.searchParams.entries()]
    .filter(([key]) => {
      const k = key.toLowerCase();
      return !NOISE_PARAMS.has(k) && !k.startsWith("utm_");
    })
    .sort(([a, av], [b, bv]) =>
      a === b ? av.localeCompare(bv) : a < b ? -1 : 1,
    );
  // De-duplicate repeated identical pairs (`?nl=1&nl=1`).
  const query = [
    ...new Set(
      kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`),
    ),
  ].join("&");

  return `https://${host}${path}${query ? `?${query}` : ""}`;
}

export type Ats =
  "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters";

export type AtsJob = { ats: Ats; jobId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ATS and its job id, when the URL is a known ATS job page (or a company
 * page that embeds one, like `?gh_jid=`). Ids are globally unique per ATS,
 * except Workday's requisition ids, which are per tenant, so those are
 * returned as `tenant:REQID`.
 */
export function parseAtsJob(raw: string): AtsJob | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname
    .replace(FORM_SUFFIX, "")
    .split("/")
    .filter(Boolean);
  const param = (name: string) => {
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() === name) return value.trim();
    }
    return null;
  };

  // Greenhouse: boards / job-boards(.eu).greenhouse.io/{slug}/jobs/{id},
  // embed/job_app?token={id}, or a company site with ?gh_jid={id}.
  const ghJid = param("gh_jid");
  if (ghJid && /^\d+$/.test(ghJid)) return { ats: "greenhouse", jobId: ghJid };
  if (host === "greenhouse.io" || host.endsWith(".greenhouse.io")) {
    const jobsAt = segments.indexOf("jobs");
    const id = jobsAt >= 0 ? segments[jobsAt + 1] : param("token");
    if (id && /^\d+$/.test(id)) return { ats: "greenhouse", jobId: id };
    return null;
  }

  // Lever: jobs(.eu).lever.co/{slug}/{uuid}
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const id = segments[1];
    return id && UUID.test(id)
      ? { ats: "lever", jobId: id.toLowerCase() }
      : null;
  }

  // Ashby: jobs.ashbyhq.com/{slug}/{uuid}, or a company site with ?ashby_jid=
  const ashbyJid = param("ashby_jid");
  if (ashbyJid && UUID.test(ashbyJid)) {
    return { ats: "ashby", jobId: ashbyJid.toLowerCase() };
  }
  if (host === "jobs.ashbyhq.com") {
    const id = segments[1];
    return id && UUID.test(id)
      ? { ats: "ashby", jobId: id.toLowerCase() }
      : null;
  }

  // SmartRecruiters: jobs.smartrecruiters.com/{Company}/{id}[-title-slug]
  if (host === "jobs.smartrecruiters.com") {
    const id = segments[1]?.match(/^(\d{6,})/)?.[1];
    return id ? { ats: "smartrecruiters", jobId: id } : null;
  }

  // Workday: {tenant}.wdN.myworkdayjobs.com/[locale/]{site}/job/{location}/{Title}_{REQID}
  const workday = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/);
  if (workday) {
    const last = segments.at(-1) ?? "";
    // Requisition ids look like R123, JR0152635, REQ_0000055929, R-34910,
    // 01867386: optional letters, optional separator, then a digit.
    const req = last.match(/_([A-Za-z]{0,6}[_-]?\d[\w-]*)$/)?.[1];
    return req
      ? { ats: "workday", jobId: `${workday[1]}:${req.toUpperCase()}` }
      : null;
  }

  return null;
}
