import { boardSlugSchema } from "@/lib/sources/board";
import { prettySlug } from "@/lib/tracker/ats-fetch";

/**
 * "Paste a careers link" → which ATS and which board. Pure: no network, so
 * the answer is instant and testable. A link we don't recognise isn't an
 * error, just "not supported yet".
 *
 * The result's `config` is what follow_board() takes (the database rebuilds
 * the stored config from it); the display name is added by the caller.
 */

export type DetectedBoard = {
  kind: "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workday";
  config: Record<string, string | number | boolean>;
  /** Shown to the user: "stripe" or "nvidia / NVIDIAExternalCareerSite". */
  ref: string;
  /** A starting point for the company name when the user gives none. */
  suggestedName: string;
};

export type Detection =
  | { ok: true; board: DetectedBoard }
  | { ok: false; reason: "not_a_link" | "unsupported" };

const UNSUPPORTED = { ok: false, reason: "unsupported" } as const;

function parseLink(input: string): URL | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  try {
    // "boards.greenhouse.io/stripe" with no scheme is how people paste.
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`,
    );
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

function found(
  kind: DetectedBoard["kind"],
  slug: string | null | undefined,
  extra: DetectedBoard["config"] = {},
): Detection {
  if (!slug || !boardSlugSchema.safeParse(slug).success) return UNSUPPORTED;
  return {
    ok: true,
    board: {
      kind,
      config: { slug, ...extra },
      ref: slug,
      suggestedName: prettySlug(slug),
    },
  };
}

/** en-US, fr-FR, en: the optional language folder in a Workday link. */
const LOCALE = /^[a-z]{2}([-_][A-Za-z]{2,4})?$/;

export function detectBoard(input: string): Detection {
  const url = parseLink(input);
  if (!url) return { ok: false, reason: "not_a_link" };

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  // boards.greenhouse.io/{slug}, job-boards.greenhouse.io/{slug}, the EU
  // hosts, and the old embed form ?for={slug}.
  if (/^(job-)?boards(\.eu)?\.greenhouse\.io$/.test(host)) {
    const slug =
      segments[0] === "embed" ? url.searchParams.get("for") : segments[0];
    return found("greenhouse", slug);
  }

  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    return found(
      "lever",
      segments[0],
      host === "jobs.eu.lever.co" ? { eu: true } : {},
    );
  }

  if (host === "jobs.ashbyhq.com") {
    return found("ashby", segments[0]);
  }

  // jobs.smartrecruiters.com/{Company}/…, careers.smartrecruiters.com/{Company},
  // or any smartrecruiters.com page carrying ?company={slug}.
  if (host === "smartrecruiters.com" || host.endsWith(".smartrecruiters.com")) {
    const fromQuery = url.searchParams.get("company");
    if (fromQuery) return found("smartrecruiters", fromQuery);
    if (
      host === "jobs.smartrecruiters.com" ||
      host === "careers.smartrecruiters.com"
    ) {
      return found("smartrecruiters", segments[0]);
    }
    return UNSUPPORTED;
  }

  // {tenant}.wd{N}.myworkdayjobs.com/[en-US/]{site}[/…]
  const workday = host.match(/^([a-z0-9-]+)\.wd(\d{1,3})\.myworkdayjobs\.com$/);
  if (workday) {
    const [, tenant, number] = workday;
    const rest =
      segments[0] && LOCALE.test(segments[0]) ? segments.slice(1) : segments;
    const site = rest[0];
    const wdNumber = Number(number);
    if (
      !site ||
      wdNumber < 1 ||
      !boardSlugSchema.safeParse(tenant).success ||
      !boardSlugSchema.safeParse(site).success
    ) {
      return UNSUPPORTED;
    }
    return {
      ok: true,
      board: {
        kind: "workday",
        config: { tenant, wdNumber, site },
        ref: `${tenant} / ${site}`,
        suggestedName: prettySlug(tenant),
      },
    };
  }

  return UNSUPPORTED;
}

export const BOARD_LABELS: Record<DetectedBoard["kind"], string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workday: "Workday",
};
