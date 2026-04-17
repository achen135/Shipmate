import { z } from "zod";

/** Profile → AI: the daily cap and auto-tailor switch (enforced in M7). */
export const aiSettingsSchema = z.object({
  dailyCap: z.coerce
    .number<string | number>()
    .int("Whole postings only.")
    .min(1, "At least 1.")
    .max(100, "At most 100."),
  autoTailor: z.boolean(),
});

export type AiSettingsInput = z.input<typeof aiSettingsSchema>;
