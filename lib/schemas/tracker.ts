import { z } from "zod";

import { TRACKER_STATUS_VALUES } from "@/lib/tracker/status";

/**
 * Tracker schemas, shared by the forms, the Server Actions, and the import
 * parser. Limits match the user_postings check constraints.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .transform((s) => (s === "" ? null : s))
    .nullable();

const httpUrl = z
  .string()
  .trim()
  .max(2000, "That link is too long.")
  .refine(
    (s) => s === "" || /^https?:\/\/\S+$/i.test(s),
    "Enter a full link (https://…).",
  )
  .transform((s) => (s === "" ? null : s))
  .nullable();

const appliedDate = z
  .union([z.iso.date("Enter a date."), z.literal("")])
  .transform((s) => (s === "" ? null : s))
  .nullable();

/** One application, as import and export see it (lib/tracker/record.ts). */
export const trackerRecordSchema = z.object({
  company: z
    .string()
    .trim()
    .min(1, "Company is required.")
    .max(200, "Keep it under 200 characters."),
  role: text(200),
  term: text(40),
  appliedAt: appliedDate,
  status: z.enum(TRACKER_STATUS_VALUES),
  unsure: z.boolean(),
  referral: z.boolean(),
  referrer: text(200),
  resumeNote: text(200),
  notes: text(10_000),
  url: httpUrl,
});

export const MAX_IMPORT_ROWS = 1000;

export const importSchema = z
  .array(trackerRecordSchema)
  .min(1, "Nothing to import.")
  .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time.`);

/**
 * The editable fields of a tracker row (row detail). Company, role, link,
 * and location only apply to manual rows; a shared posting's come from it.
 */
export const trackerEditSchema = z.object({
  status: z.enum(TRACKER_STATUS_VALUES),
  unsure: z.boolean(),
  appliedAt: appliedDate,
  referral: z.boolean(),
  referrer: text(200),
  term: text(40),
  resumeNote: text(200),
  notes: text(10_000),
  company: text(200).optional(),
  role: text(200).optional(),
  url: httpUrl.optional(),
  location: text(200).optional(),
});

export type TrackerEditForm = z.input<typeof trackerEditSchema>;

/** Manual add: company, role, etc. typed in (or prefilled from the ATS). */
export const manualAddSchema = trackerRecordSchema
  .omit({ unsure: true, referrer: true, resumeNote: true })
  .extend({ location: text(200) });

export type ManualAddForm = z.input<typeof manualAddSchema>;
