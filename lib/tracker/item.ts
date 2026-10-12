import type { Json } from "@/lib/supabase/database.types";

import type { TrackerRecord } from "./record";
import type { TrackerStatus } from "./status";

/**
 * A tracker row as the screens use it: company / role / link come from the
 * shared posting, or from `manual` for rows added by hand or imported.
 */
export type TrackerItem = {
  id: string;
  postingId: string | null;
  company: string;
  /** null → shown as "—". */
  role: string | null;
  url: string | null;
  location: string | null;
  /** Grouping term: the row's own, else the posting's first, else null. */
  term: string | null;
  status: TrackerStatus;
  unsure: boolean;
  /** YYYY-MM-DD. */
  appliedAt: string | null;
  referral: boolean;
  referrer: string | null;
  resumeNote: string | null;
  notes: string | null;
  lastEventAt: string | null;
  postingClosed: boolean;
};

export type ManualFields = {
  company: string;
  title: string | null;
  url: string | null;
  location: string | null;
};

/** `manual` jsonb → fields, tolerating anything odd in it. */
export function readManual(value: Json | null): ManualFields | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const str = (v: Json | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const company = str(value.company);
  return company
    ? {
        company,
        title: str(value.title),
        url: str(value.url),
        location: str(value.location),
      }
    : null;
}

export type TrackerRow = {
  id: string;
  status: string;
  status_unsure: boolean;
  applied_at: string | null;
  referral: boolean;
  referrer: string | null;
  notes: string | null;
  term: string | null;
  manual: Json | null;
  resume_note: string | null;
  posting: {
    id: string;
    title: string;
    url: string;
    terms: string[];
    locations: string[];
    status: string;
    company: { name: string } | null;
  } | null;
  status_events: { at: string }[];
};

export function toTrackerItem(row: TrackerRow): TrackerItem {
  const manual = readManual(row.manual);
  const p = row.posting;
  return {
    id: row.id,
    postingId: p?.id ?? null,
    company: p?.company?.name ?? manual?.company ?? "Unknown company",
    role: p?.title ?? manual?.title ?? null,
    url: p?.url ?? manual?.url ?? null,
    location: p ? p.locations.join(" · ") || null : (manual?.location ?? null),
    term: row.term ?? p?.terms[0] ?? null,
    status: row.status as TrackerStatus,
    unsure: row.status_unsure,
    appliedAt: row.applied_at,
    referral: row.referral,
    referrer: row.referrer,
    resumeNote: row.resume_note,
    notes: row.notes,
    lastEventAt: row.status_events[0]?.at ?? null,
    postingClosed: p?.status === "closed",
  };
}

export function toRecord(item: TrackerItem): TrackerRecord {
  return {
    company: item.company,
    role: item.role,
    term: item.term,
    appliedAt: item.appliedAt,
    status: item.status,
    unsure: item.unsure,
    referral: item.referral,
    referrer: item.referrer,
    resumeNote: item.resumeNote,
    notes: item.notes,
    url: item.url,
  };
}

export const OTHER_TERM = "Other";

/**
 * Rows grouped by term, newest group first (by latest applied date); rows
 * without a term go under "Other", last. Rows keep their order.
 */
export function groupByTerm<
  T extends { term: string | null; appliedAt: string | null },
>(items: readonly T[]): { term: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const term = item.term ?? OTHER_TERM;
    groups.set(term, [...(groups.get(term) ?? []), item]);
  }
  const latest = (rows: T[]) =>
    rows.reduce(
      (max, r) => ((r.appliedAt ?? "") > max ? r.appliedAt! : max),
      "",
    );
  return [...groups]
    .map(([term, rows]) => ({ term, items: rows }))
    .sort((a, b) => {
      if (a.term === OTHER_TERM) return 1;
      if (b.term === OTHER_TERM) return -1;
      return (
        latest(b.items).localeCompare(latest(a.items)) ||
        a.term.localeCompare(b.term)
      );
    });
}

/** Same company, case and spacing ignored ("Other applications at Ramp"). */
export function sameCompany(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(a) === norm(b);
}
