"use server";

import { after } from "next/server";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { requireMember } from "@/lib/auth/viewer";
import {
  type StatusChange,
  statusChangeSchema,
  statusUpdate,
} from "@/lib/inbox/status";
import { prefetchQuestions } from "@/lib/questions/prefetch";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Inbox / To Apply / posting detail actions. RLS limits each update to the
 * caller's own row; column grants limit it to status, skip_reason, seen_at.
 * No revalidation: the card shows the result itself (with Undo), and the
 * lists are dynamic, so the next visit reads fresh rows. Saving also starts
 * the no-AI prep that can start early (the application form: M9 §3).
 */

export async function changeStatus(input: StatusChange): Promise<ActionResult> {
  await requireMember();
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Something went wrong." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_postings")
    .update(statusUpdate(parsed.data))
    .eq("id", parsed.data.id)
    .select("id");
  if (error || data.length === 0) {
    console.error("[inbox] status change failed:", error?.message ?? "no row");
    return { ok: false, message: "Couldn't update. Try again." };
  }
  if (parsed.data.status === "applied") {
    await recordResumeUsed(parsed.data.id);
  }
  if (parsed.data.status === "saved") {
    // After the answer has gone: read the application form now, so the review
    // page and a later "Tailor all" don't wait on the ATS (M9 §3). The client
    // is made here because cookies aren't readable once the response is sent.
    const id = parsed.data.id;
    after(() => prefetchQuestions(supabase, id));
  }
  return { ok: true };
}

/**
 * Note which PDF went with this application: the posting's latest tailored
 * PDF, else the uploaded resume (the database function picks and checks
 * it; the first record wins). Best effort: a failure here never undoes
 * "applied".
 */
export async function recordResumeUsed(userPostingId: string): Promise<void> {
  await requireMember();
  if (!z.uuid().safeParse(userPostingId).success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_resume_used", {
    p_user_posting_id: userPostingId,
  });
  if (error) console.error("[apply] resume_used failed:", error.code);
}

export async function markSeen(id: string): Promise<void> {
  await requireMember();
  if (!z.uuid().safeParse(id).success) return;
  const supabase = await createClient();
  await supabase
    .from("user_postings")
    .update({ seen_at: new Date().toISOString() })
    .eq("id", id)
    .is("seen_at", null);
}

const PASTED_MAX = 20000;

/**
 * Keep the questions a user pasted for an application Shipmate can't read.
 * Stored in their own row's answer_sheet (RLS: theirs only), merged so keys
 * later milestones add there aren't lost.
 */
export async function savePastedQuestions(
  userPostingId: string,
  text: string,
): Promise<ActionResult> {
  await requireMember();
  if (!z.uuid().safeParse(userPostingId).success || text.length > PASTED_MAX) {
    return { ok: false, message: "Something went wrong." };
  }

  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("user_postings")
    .select("answer_sheet")
    .eq("id", userPostingId)
    .maybeSingle();
  if (readError || !row) {
    console.error(
      "[review] paste read failed:",
      readError?.message ?? "no row",
    );
    return { ok: false, message: "Couldn't save. Try again." };
  }

  const current =
    row.answer_sheet &&
    typeof row.answer_sheet === "object" &&
    !Array.isArray(row.answer_sheet)
      ? row.answer_sheet
      : {};
  const rest = { ...current } as Record<string, unknown>;
  delete rest.pastedQuestions;
  const trimmed = text.trim();
  const { data, error } = await supabase
    .from("user_postings")
    .update({
      answer_sheet: (trimmed
        ? { ...rest, pastedQuestions: trimmed }
        : rest) as Json,
    })
    .eq("id", userPostingId)
    .select("id");
  if (error || data.length === 0) {
    console.error("[review] paste save failed:", error?.message ?? "no row");
    return { ok: false, message: "Couldn't save. Try again." };
  }
  return { ok: true };
}
