"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { requireInvited } from "@/lib/auth/viewer";
import { resumeContentSchema } from "@/lib/resume/structured";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * "Edit this copy": replace one tailored copy, never the master resume
 * (save_tailored_copy updates the tailoring row only, and asks the worker
 * to print its PDF again). The user's own edits aren't checked against the
 * master: it's their resume to change.
 */
export async function saveTailoredCopy(
  tailoringId: string,
  postingId: string,
  content: unknown,
): Promise<ActionResult> {
  await requireInvited();
  if (!z.uuid().safeParse(tailoringId).success) {
    return { ok: false, message: "Unknown tailoring." };
  }
  const parsed = resumeContentSchema.safeParse(content);
  if (!parsed.success) {
    return { ok: false, message: "Something in the resume is too long." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_tailored_copy", {
    p_id: tailoringId,
    p_content: parsed.data as unknown as Json,
  });
  if (error) {
    console.error("[tailor] save copy failed:", error.code);
    return { ok: false, message: "Couldn't save. Try again." };
  }
  revalidatePath(`/postings/${postingId}`);
  return { ok: true };
}

export async function noNotes(): Promise<ActionResult> {
  return { ok: true };
}
