import "server-only";

import { sameCompany } from "@/lib/tracker/item";
import { listTrackerItems } from "@/lib/tracker/queries";
import { createClient } from "@/lib/supabase/server";

import type { PreviousApplication } from "./warnings";

/**
 * Everything the review page reads, as the signed-in user (RLS: their own
 * user_postings, profile, and resume; postings and companies readable by
 * members).
 */

const POSTING_FIELDS =
  "id, title, url, canonical_url, locations, terms, category, sponsorship, degrees, description, posted_at, first_seen_at, source_names, status, ats, ats_job_id, questions, questions_status, questions_fetched_at, company:companies(name)" as const;

const PROFILE_FIELDS =
  "name, email, phone, school, degree, major, grad_month, grad_year, work_authorized, needs_sponsorship, standard_answers" as const;

export async function getReview(postingId: string) {
  const supabase = await createClient();
  const [posting, item, profile, resume, tracker] = await Promise.all([
    supabase
      .from("postings")
      .select(POSTING_FIELDS)
      .eq("id", postingId)
      .maybeSingle(),
    supabase
      .from("user_postings")
      .select("id, status, skip_reason, seen_at, answer_sheet")
      .eq("posting_id", postingId)
      .maybeSingle(),
    supabase.from("profiles").select(PROFILE_FIELDS).maybeSingle(),
    supabase
      .from("resumes")
      .select("file_name, file_path, text_content, updated_at")
      .maybeSingle(),
    listTrackerItems(),
  ]);
  for (const [label, result] of [
    ["posting", posting],
    ["user_posting", item],
    ["profile", profile],
    ["resume", resume],
  ] as const) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
  }
  if (!posting.data) return null;

  const company = posting.data.company?.name ?? "";
  const previous: PreviousApplication[] = tracker
    .filter(
      (row) =>
        row.postingId !== postingId &&
        company &&
        sameCompany(row.company, company),
    )
    .map((row) => ({
      id: row.id,
      role: row.role,
      appliedAt: row.appliedAt,
      status: row.status,
      unsure: row.unsure,
    }));

  return {
    posting: posting.data,
    item: item.data,
    profile: profile.data,
    resume: resume.data,
    previous,
  };
}

export type Review = NonNullable<Awaited<ReturnType<typeof getReview>>>;
