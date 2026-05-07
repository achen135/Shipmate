import { z } from "zod";

/**
 * user_postings.resume_used: which PDF went with an application, recorded
 * by the database function record_resume_used() (or the extension's) when
 * it's marked submitted. Paths are never overwritten, so this is the exact
 * file (supabase/migrations/20260507100000_resume_used.sql).
 */
export const resumeUsedSchema = z.object({
  kind: z.enum(["tailored", "uploaded"]),
  bucket: z.enum(["pdfs", "uploads"]),
  path: z.string(),
  file_name: z.string().nullish(),
  tailoring_id: z.string().nullish(),
  edited: z.boolean().nullish(),
  recorded_at: z.string(),
});
export type ResumeUsed = z.infer<typeof resumeUsedSchema>;

export function parseResumeUsed(value: unknown): ResumeUsed | null {
  const parsed = resumeUsedSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** "Your tailored resume for this posting (edited by you)" and the like. */
export function describeResumeUsed(used: ResumeUsed): string {
  if (used.kind === "tailored") {
    return used.edited
      ? "Your tailored resume for this posting, as you edited it"
      : "Your tailored resume for this posting";
  }
  return `Your uploaded resume${used.file_name ? ` (${used.file_name})` : ""}`;
}
