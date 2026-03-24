"use server";

import { redirect } from "next/navigation";

import type { ActionResult } from "@/lib/action-result";
import { HOME_PATH } from "@/lib/auth/routes";
import { requireSignedIn } from "@/lib/auth/viewer";
import {
  isRedeemResult,
  normalizeInviteCode,
  redeemErrorMessage,
} from "@/lib/invites";
import {
  ONBOARDING_PATHS,
  STEP,
  pendingOnboardingPath,
} from "@/lib/onboarding";
import { saveBasics } from "@/lib/profile/save-basics";
import { createWatchProfile } from "@/lib/watch/profiles";
import { createClient } from "@/lib/supabase/server";

export type RedeemState = { message: string | null };

export async function redeemInvite(
  _prev: RedeemState,
  formData: FormData,
): Promise<RedeemState> {
  await requireSignedIn();
  const code = normalizeInviteCode(String(formData.get("code") ?? ""));
  if (!code) return { message: "Enter your invite code." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_invite", { p_code: code });
  if (error || !isRedeemResult(data)) {
    console.error("[onboarding] redeem_invite failed:", error?.message ?? data);
    return { message: "Couldn't check that code. Try again." };
  }

  const message = redeemErrorMessage(data);
  if (message) return { message };
  redirect(ONBOARDING_PATHS[STEP.basics]);
}

export async function completeBasics(values: unknown): Promise<ActionResult> {
  const viewer = await requireSignedIn();
  if (!viewer.invitedAt) redirect(ONBOARDING_PATHS[STEP.invite]);

  const result = await saveBasics(viewer, values, STEP.basics + 1);
  if (!result.ok) return result;
  redirect(
    pendingOnboardingPath({ ...viewer, onboardingStep: STEP.basics + 1 }) ??
      HOME_PATH,
  );
}

/**
 * Step "What to watch": save the first watch profile, backfill the Inbox
 * with the past week's matches, and finish onboarding.
 */
export async function completeWatch(values: unknown): Promise<ActionResult> {
  const viewer = await requireSignedIn();
  const pending = pendingOnboardingPath(viewer);
  if (pending !== ONBOARDING_PATHS[STEP.watch]) redirect(pending ?? HOME_PATH);

  const result = await createWatchProfile(values);
  if (!result.ok) return result;

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_step: STEP.watch + 1 })
    .eq("user_id", viewer.id);
  if (error) {
    console.error("[onboarding] finish failed:", error.message);
    return { ok: false, message: "Saved, but couldn't continue. Try again." };
  }
  redirect(HOME_PATH);
}
