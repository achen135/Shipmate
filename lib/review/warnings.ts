import { DEGREES, MONTHS } from "@/lib/schemas/basics";
import { statusLabel } from "@/lib/tracker/status";

/**
 * The review page's warnings (Spec "Review page"). Every rule here only
 * *warns* (hard rule 3): a mismatch is a sentence with the reason, never a
 * block, and the page still shows the resume and the Apply button. Each rule
 * is independent, so one failing to find anything never hides another.
 *
 * Rule-based and best effort: most postings don't tag a class year, so the
 * graduation rule reads the posting text and says what it found.
 */

export type WarningProfile = {
  gradMonth: number | null;
  gradYear: number | null;
  degree: string | null;
  needsSponsorship: boolean | null;
};

export type WarningPosting = {
  title: string;
  terms: readonly string[];
  degrees: readonly string[];
  sponsorship: string;
  description: string | null;
};

export type PreviousApplication = {
  /** The user_postings id, for the link to the Tracker. */
  id: string;
  role: string | null;
  /** YYYY-MM-DD or null. */
  appliedAt: string | null;
  status: string;
  unsure: boolean;
};

export type Warning = {
  /**
   * The first five are M5's rules; skills_gap and low_score come from an
   * AI-mode tailoring (lib/tailor/pipeline.ts) and are stored with it.
   */
  kind:
    | "grad_year"
    | "term"
    | "degree"
    | "sponsorship"
    | "previous"
    | "skills_gap"
    | "low_score";
  message: string;
  previous?: PreviousApplication[];
};

// ---------------------------------------------------------------- graduation year

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** Years the posting ties to graduation ("class of 2028", "graduating … 2027"). */
export function graduationYears(text: string): number[] {
  const years = new Set<number>();
  const add = (chunk: string) => {
    for (const m of chunk.matchAll(/\b(20\d\d)\b/g)) {
      const year = Number(m[1]);
      if (year >= MIN_YEAR && year <= MAX_YEAR) years.add(year);
    }
  };
  for (const m of text.matchAll(/class of (20\d\d)/gi)) add(m[1]);
  for (const m of text.matchAll(
    /\b(20\d\d)\s+(graduates?|grads?|graduating)\b/gi,
  )) {
    add(m[1]);
  }
  // "graduating between December 2026 and June 2028", "expected graduation
  // date: May 2027": whatever years follow within the same phrase.
  for (const m of text.matchAll(
    /\b(graduat\w*|degree completion)\b([^.\n;]{0,90})/gi,
  )) {
    add(m[2]);
  }
  return [...years].sort((a, b) => a - b);
}

function graduationYearWarning(
  posting: WarningPosting,
  profile: WarningProfile,
): Warning | null {
  if (!profile.gradYear) return null;
  const years = graduationYears(
    `${posting.title}\n${posting.description ?? ""}`,
  );
  if (years.length === 0) return null;
  const [low, high] = [years[0], years[years.length - 1]];
  if (profile.gradYear >= low && profile.gradYear <= high) return null;
  const said = low === high ? `${low}` : `${low} to ${high}`;
  return {
    kind: "grad_year",
    message: `The posting mentions graduating in ${said}; you graduate in ${profile.gradYear}.`,
  };
}

// ---------------------------------------------------------------- term vs graduation

const SEASON_START_MONTH: Record<string, number> = {
  winter: 1,
  spring: 2,
  summer: 6,
  fall: 9,
};

const INTERNSHIP = /\b(intern|internship|co-?op)\b/i;

function termWarning(
  posting: WarningPosting,
  profile: WarningProfile,
): Warning | null {
  if (!profile.gradYear || !profile.gradMonth) return null;
  if (!INTERNSHIP.test(posting.title)) return null;

  const starts: { label: string; index: number }[] = [];
  for (const term of posting.terms) {
    const m = /^(winter|spring|summer|fall)\s+(20\d\d)$/i.exec(term.trim());
    if (!m) continue;
    starts.push({
      label: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`,
      index: Number(m[2]) * 12 + SEASON_START_MONTH[m[1].toLowerCase()],
    });
  }
  if (starts.length === 0) return null;

  const graduation = profile.gradYear * 12 + profile.gradMonth;
  const earliest = starts.reduce((a, b) => (b.index < a.index ? b : a));
  if (graduation >= earliest.index) return null;
  return {
    kind: "term",
    message: `You graduate in ${MONTHS[profile.gradMonth - 1]} ${profile.gradYear}, before ${earliest.label} starts. Many internships need you to still be a student when they begin.`,
  };
}

// ---------------------------------------------------------------- degree

/** "Bachelor's", "Masters", "MBA" → one of our degree values. */
function degreeValue(text: string): string | null {
  const t = text.toLowerCase().replace(/['’]/g, "");
  if (/^associate/.test(t)) return "associate";
  if (/^bachelor/.test(t)) return "bachelors";
  if (/^master|^mba$|^ms$/.test(t)) return "masters";
  if (/^ph\.?d|^doctor/.test(t)) return "phd";
  return null;
}

function degreeWarning(
  posting: WarningPosting,
  profile: WarningProfile,
): Warning | null {
  if (!profile.degree || profile.degree === "other") return null;
  const wanted = posting.degrees
    .map(degreeValue)
    .filter((d): d is string => d !== null);
  // Nothing readable listed: no claim either way.
  if (wanted.length === 0 || wanted.includes(profile.degree)) return null;
  const label = DEGREES.find((d) => d.value === profile.degree)?.label;
  return {
    kind: "degree",
    message: `The posting lists ${posting.degrees.join(", ")}; you're working toward a ${label} degree.`,
  };
}

// ---------------------------------------------------------------- sponsorship

function sponsorshipWarning(
  posting: WarningPosting,
  profile: WarningProfile,
): Warning | null {
  if (!profile.needsSponsorship) return null;
  if (posting.sponsorship === "no_sponsorship") {
    return {
      kind: "sponsorship",
      message:
        "This employer says it doesn't offer visa sponsorship, and you've said you need it.",
    };
  }
  if (posting.sponsorship === "citizens_only") {
    return {
      kind: "sponsorship",
      message:
        "This role requires U.S. citizenship, and you've said you need visa sponsorship.",
    };
  }
  return null;
}

// ---------------------------------------------------------------- previous applications

function previousWarning(previous: PreviousApplication[]): Warning | null {
  if (previous.length === 0) return null;
  return {
    kind: "previous",
    message:
      previous.length === 1
        ? "You've applied to this company before:"
        : `You've applied to this company ${previous.length} times before:`,
    previous,
  };
}

/** Short line for one earlier application: "Backend Intern, 3/12 (Applied)". */
export function describePrevious(p: PreviousApplication): string {
  const date = p.appliedAt
    ? ` ${Number(p.appliedAt.slice(5, 7))}/${Number(p.appliedAt.slice(8, 10))}`
    : "";
  return `${p.role ?? "Role not listed"},${date || " no date"} (${statusLabel(p.status)}${p.unsure ? "?" : ""})`;
}

export function reviewWarnings(input: {
  posting: WarningPosting;
  profile: WarningProfile;
  previous: PreviousApplication[];
}): Warning[] {
  const { posting, profile, previous } = input;
  return [
    previousWarning(previous),
    graduationYearWarning(posting, profile),
    termWarning(posting, profile),
    degreeWarning(posting, profile),
    sponsorshipWarning(posting, profile),
  ].filter((w): w is Warning => w !== null);
}
