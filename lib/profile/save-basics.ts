import "server-only";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { basicsSchema, basicsToProfile } from "@/lib/schemas/basics";
import { createClient } from "@/lib/supabase/server";

/**
 * Validate and save Basics for the signed-in user. RLS limits the update to
 * their own row and column grants limit which columns. `minStep` moves
 * onboarding forward, never back.
 */
export async function saveBasics(
  viewer: { id: string; onboardingStep: number },
  input: unknown,
  minStep?: number,
): Promise<ActionResult> {
  const parsed = basicsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const advance = minStep !== undefined && viewer.onboardingStep < minStep;
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      ...basicsToProfile(parsed.data),
      ...(advance ? { onboarding_step: minStep } : {}),
    })
    .eq("user_id", viewer.id);
  if (error) {
    console.error("[profile] save basics failed:", error.message);
    return { ok: false, message: "Couldn't save. Try again." };
  }
  return { ok: true };
}
