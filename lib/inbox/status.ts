import { z } from "zod";

/**
 * What the Inbox, To Apply, and posting detail can do to a user_postings
 * row: save it, skip it (optionally with a reason), put it back, or mark it
 * applied (into the Tracker). Later tracker statuses are set in the Tracker.
 */

export const SKIP_REASONS = [
  { value: "not_interested", label: "Not interested" },
  { value: "location", label: "Location" },
  { value: "not_eligible", label: "Not eligible" },
  { value: "already_applied", label: "Already applied" },
  { value: "other", label: "Other" },
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number]["value"];

const SKIP_REASON_VALUES = SKIP_REASONS.map((r) => r.value) as [
  SkipReason,
  ...SkipReason[],
];

export const statusChangeSchema = z.discriminatedUnion("status", [
  z.object({ id: z.uuid(), status: z.literal("new") }),
  z.object({ id: z.uuid(), status: z.literal("saved") }),
  z.object({ id: z.uuid(), status: z.literal("applied") }),
  z.object({
    id: z.uuid(),
    status: z.literal("skipped"),
    skipReason: z.enum(SKIP_REASON_VALUES).nullable().default(null),
  }),
]);

export type StatusChange = z.input<typeof statusChangeSchema>;

/**
 * The columns to update. skip_reason only ever goes with status skipped.
 * Marking applied leaves applied_at to the database (today, unless already
 * set); moving back out of the Tracker (Undo) clears it.
 */
export function statusUpdate(change: z.output<typeof statusChangeSchema>) {
  return {
    status: change.status,
    skip_reason: change.status === "skipped" ? change.skipReason : null,
    ...(change.status === "applied" ? {} : { applied_at: null }),
  };
}
