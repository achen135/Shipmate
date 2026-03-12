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
import { ONBOARDING_PATHS, STEP } from "@/lib/onboarding";
import { saveBasics } from "@/lib/profile/save-basics";
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
  redirect(HOME_PATH);
}
