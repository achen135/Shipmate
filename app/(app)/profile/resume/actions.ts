"use server";

import type { ActionResult } from "@/lib/action-result";
import { requireInvited } from "@/lib/auth/viewer";
import { resumeContentSchema } from "@/lib/resume/structured";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/** Save the edited structured resume (as the user; RLS + column grants). */
export async function saveResume(content: unknown): Promise<ActionResult> {
  const viewer = await requireInvited();
  const parsed = resumeContentSchema.safeParse(content);
  if (!parsed.success) {
    return { ok: false, message: "Something in the resume is too long." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("resumes")
    .upsert(
      { kind: "structured", content: parsed.data as unknown as Json },
      { onConflict: "user_id" },
    );
  if (error) {
    console.error(
      `[resume] save ${viewer.id.slice(0, 8)} failed:`,
      error.message,
    );
    return { ok: false, message: "Couldn't save. Try again." };
  }
  return { ok: true };
}

/** "I've checked them": dismiss the import's notes. */
export async function clearImportNotes(): Promise<ActionResult> {
  const viewer = await requireInvited();
  const supabase = await createClient();
  const { error } = await supabase
    .from("resumes")
    .update({ import_notes: null })
    .eq("user_id", viewer.id);
  if (error) return { ok: false, message: "Couldn't update. Try again." };
  return { ok: true };
}
