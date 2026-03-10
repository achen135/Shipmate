import { NextResponse, type NextRequest } from "next/server";

import { redeemPendingInvite } from "@/lib/auth/finish-sign-in";
import { SIGN_IN_PATH, safeRedirectPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth (and same-browser magic-link) return URL. Supabase redirects here
 * with a one-time `code`; exchanging it (PKCE) sets the session cookie.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const inviteProblem = await redeemPendingInvite(supabase);
      return NextResponse.redirect(new URL(inviteProblem ?? next, request.url));
    }
    console.error("[auth] code exchange failed:", error.message);
  }

  // Google's "Cancel" lands here with ?error=access_denied and no code.
  return NextResponse.redirect(
    new URL(`${SIGN_IN_PATH}?error=callback`, request.url),
  );
}
