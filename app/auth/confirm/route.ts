import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { redeemPendingInvite } from "@/lib/auth/finish-sign-in";
import { SIGN_IN_PATH, safeRedirectPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

const EMAIL_TYPES: readonly EmailOtpType[] = ["magiclink", "email", "signup"];

/**
 * Magic-link return URL for the token-hash email template
 * (`/auth/confirm?token_hash={{ .TokenHash }}&type=email`). Unlike the PKCE
 * `code` flow it works when the link is opened on a different device from
 * the one that asked for it.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeRedirectPath(searchParams.get("next"));

  if (tokenHash && type && EMAIL_TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      const inviteProblem = await redeemPendingInvite(supabase);
      return NextResponse.redirect(new URL(inviteProblem ?? next, request.url));
    }
    console.error("[auth] magic link verify failed:", error.message);
  }

  return NextResponse.redirect(
    new URL(`${SIGN_IN_PATH}?error=link`, request.url),
  );
}
