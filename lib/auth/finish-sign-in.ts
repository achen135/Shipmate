import "server-only";

import { cookies } from "next/headers";

import {
  PENDING_INVITE_COOKIE,
  isRedeemResult,
  redeemErrorMessage,
} from "@/lib/invites";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * After the session cookie is set (OAuth callback or magic-link confirm):
 * redeem the invite code typed before sign-in, if any. Returns a path to send
 * the user to when the code didn't work, otherwise null.
 */
export async function redeemPendingInvite(
  supabase: Client,
): Promise<string | null> {
  const cookieStore = await cookies();
  const code = cookieStore.get(PENDING_INVITE_COOKIE)?.value;
  if (!code) return null;
  cookieStore.delete(PENDING_INVITE_COOKIE);

  const { data, error } = await supabase.rpc("redeem_invite", { p_code: code });
  if (error || !isRedeemResult(data)) {
    console.error("[auth] redeem_invite failed:", error?.message ?? data);
    return "/onboarding/invite?invite=error";
  }
  return redeemErrorMessage(data) ? `/onboarding/invite?invite=${data}` : null;
}
