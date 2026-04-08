import { z } from "zod";

/** Companies → "Follow a company by its careers page". */
export const followLinkSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Paste a careers page link.")
    .max(2000, "That link is too long."),
  /** Optional: the company's name when the link doesn't say it. */
  name: z
    .string()
    .trim()
    .max(120, "Keep the name under 120 characters.")
    .optional()
    .transform((value) => value || undefined),
});

export type FollowLinkInput = z.input<typeof followLinkSchema>;

export const companyIdSchema = z.uuid();
