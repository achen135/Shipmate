import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { loadQuestions } from "./load";

/**
 * M9 §3: read a saved posting's application form now instead of when its
 * review page is first opened, so a "Tailor all" sit-down doesn't wait on
 * the ATS. It is exactly the review page's own load (loadQuestions: use the
 * cached copy if it's fresh, else fetch and cache it for everyone through
 * save_posting_questions()), run early. No AI, no cost, nothing new written.
 *
 * Best effort, and quiet: the review page fetches lazily as before, so a
 * failure here costs nothing but the head start. Logs a code, never a URL.
 */
export async function prefetchQuestions(
  supabase: SupabaseClient<Database>,
  userPostingId: string,
): Promise<"fetched" | "missing" | "failed"> {
  try {
    const { data, error } = await supabase
      .from("user_postings")
      .select(
        "posting:postings!inner(id, url, canonical_url, questions, questions_status, questions_fetched_at, company:companies(name))",
      )
      .eq("id", userPostingId)
      .maybeSingle();
    if (error) {
      console.error("[prefetch] questions: read failed:", error.code);
      return "failed";
    }
    if (!data) return "missing";
    await loadQuestions(data.posting, supabase);
    return "fetched";
  } catch (error) {
    console.error(
      "[prefetch] questions failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return "failed";
  }
}
