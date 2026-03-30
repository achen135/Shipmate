import { toCsv } from "./csv";
import { type TrackerStatus, statusText } from "./status";

/**
 * One application as import and export see it: the columns of Alex's old
 * Markdown tracker plus what Shipmate adds. Export writes these columns and
 * import reads them back, so a round-trip gives the same rows.
 */
export type TrackerRecord = {
  company: string;
  /** Empty for "just the company" rows, shown as "—". */
  role: string | null;
  term: string | null;
  /** YYYY-MM-DD. */
  appliedAt: string | null;
  status: TrackerStatus;
  unsure: boolean;
  referral: boolean;
  referrer: string | null;
  /** "Resume v3" (the old Resume Version column). */
  resumeNote: string | null;
  notes: string | null;
  url: string | null;
};

export const EXPORT_COLUMNS = [
  "Company",
  "Role",
  "Term",
  "Date Applied",
  "Status",
  "Referral",
  "Referrer",
  "Resume Version",
  "Notes",
  "URL",
] as const;

export function toExportCsv(records: readonly TrackerRecord[]): string {
  return toCsv([
    EXPORT_COLUMNS,
    ...records.map((r) => [
      r.company,
      r.role ?? "",
      r.term ?? "",
      r.appliedAt ?? "",
      statusText(r.status, r.unsure),
      r.referral ? "Yes" : "",
      r.referrer ?? "",
      r.resumeNote ?? "",
      r.notes ?? "",
      r.url ?? "",
    ]),
  ]);
}

const squash = (s: string | null) =>
  (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Same application = same company + role + date applied (case and spacing
 * ignored). Re-importing a file skips rows already in the tracker.
 */
export function recordKey(r: {
  company: string;
  role: string | null;
  appliedAt: string | null;
}): string {
  return [squash(r.company), squash(r.role), r.appliedAt ?? ""].join("|");
}
