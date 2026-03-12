import "server-only";

import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { pendingOnboardingPath } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

/**
 * Data access layer for "who is this request?". Every gated page and Server
 * Action starts with one of the require* functions below; the proxy's
 * redirect is only an optimistic first pass.
 */

const PROFILE_COLUMNS =
  "user_id, email, name, school, degree, major, grad_month, grad_year, work_authorized, needs_sponsorship, invited_at, onboarding_step" as const;

export type Viewer = NonNullable<Awaited<ReturnType<typeof loadViewer>>>;

async function loadViewer() {
  // Request-time only. Validating the session compares the token's expiry
  // with the current time, which Next won't allow in a runtime prefetch, and
  // a cached viewer would go stale the moment an invite is redeemed.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const [profile, admin] = await Promise.all([
    supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("app_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (profile.error) throw new Error(`profile: ${profile.error.message}`);
  if (admin.error) throw new Error(`app_admins: ${admin.error.message}`);

  return {
    id: userId,
    email:
      (data.claims.email as string | undefined) ?? profile.data?.email ?? null,
    // A missing row (account older than the profiles trigger) reads as a
    // fresh, un-invited profile; redeem_invite creates it.
    profile: profile.data,
    invitedAt: profile.data?.invited_at ?? null,
    onboardingStep: profile.data?.onboarding_step ?? 1,
    isAdmin: admin.data !== null,
  };
}

/** The signed-in user for this request, or null. Memoised per request. */
export const getViewer = cache(loadViewer);

export async function requireSignedIn() {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  return viewer;
}

/** Signed in, invited, and through onboarding: allowed into the app. */
export async function requireMember() {
  const viewer = await requireSignedIn();
  const pending = pendingOnboardingPath(viewer);
  if (pending) redirect(pending);
  return viewer;
}

/** Admin pages 404 for everyone else rather than revealing they exist. */
export async function requireAdmin() {
  const viewer = await requireSignedIn();
  if (!viewer.isAdmin) notFound();
  return viewer;
}
