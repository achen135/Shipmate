"use server";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { requireMember } from "@/lib/auth/viewer";
import {
  answersToColumn,
  standardAnswersSchema,
} from "@/lib/schemas/standard-answers";
import { createClient } from "@/lib/supabase/server";

/**
 * Save the phone number and the answers the answer sheet copies from.
 * Validated again here; RLS limits the update to the caller's row and column
 * grants to phone, standard_answers, notify_prefs.
 */
export async function updateStandardAnswers(
  values: unknown,
): Promise<ActionResult> {
  const viewer = await requireMember();
  const parsed = standardAnswersSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      phone: parsed.data.phone || null,
      standard_answers: answersToColumn(parsed.data),
    })
    .eq("user_id", viewer.id);
  if (error) {
    console.error("[profile] save answers failed:", error.message);
    return { ok: false, message: "Couldn't save. Try again." };
  }
  return { ok: true };
}
