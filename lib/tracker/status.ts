/**
 * Tracker statuses: a user_postings row is in the Tracker once its status is
 * one of these. Inbox (new), To Apply (saved), and skipped come before.
 */

export const TRACKER_STATUSES = [
  { value: "applied", label: "Applied" },
  { value: "oa", label: "OA" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
] as const;

export type TrackerStatus = (typeof TRACKER_STATUSES)[number]["value"];

export const TRACKER_STATUS_VALUES = TRACKER_STATUSES.map((s) => s.value) as [
  TrackerStatus,
  ...TrackerStatus[],
];

/** The counts strip at the top of the Tracker (withdrawn isn't counted). */
export const COUNTED_STATUSES: readonly TrackerStatus[] = [
  "applied",
  "oa",
  "interview",
  "offer",
  "rejected",
];

export function isTrackerStatus(status: string): status is TrackerStatus {
  return (TRACKER_STATUS_VALUES as readonly string[]).includes(status);
}

const LABELS: Record<string, string> = {
  new: "Inbox",
  saved: "Saved",
  skipped: "Skipped",
  ...Object.fromEntries(TRACKER_STATUSES.map((s) => [s.value, s.label])),
};

/** "Applied", "OA", … and the pre-tracker ones, for timelines. */
export function statusLabel(status: string): string {
  return LABELS[status] ?? status;
}

/** "Rejected?" when the user isn't sure. Also the CSV export value. */
export function statusText(status: string, unsure: boolean): string {
  return `${statusLabel(status)}${unsure ? "?" : ""}`;
}
