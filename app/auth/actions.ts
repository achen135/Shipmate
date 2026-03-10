"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { originFromHeaders } from "@/lib/auth/origin";
import { safeRedirectPath } from "@/lib/auth/routes";
import {
  PENDING_INVITE_COOKIE,
  PENDING_INVITE_MAX_AGE,
  normalizeInviteCode,
} from "@/lib/invites";
import { emailSignInEnabled, readSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type SignInState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

const NOT_CONFIGURED: SignInState = {
  status: "error",
  message: "Sign-in isn't set up on this server yet.",
};

/** Keep a code typed before sign-in so the callback can redeem it. */
async function rememberInvite(formData: FormData) {
  const code = normalizeInviteCode(String(formData.get("invite") ?? ""));
  if (!code) return;
  (await cookies()).set(PENDING_INVITE_COOKIE, code, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: PENDING_INVITE_MAX_AGE,
    path: "/",
  });
}

async function callbackUrl(formData: FormData) {
  const next = safeRedirectPath(String(formData.get("next") ?? ""));
  const origin = originFromHeaders(await headers());
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export async function signInWithGoogle(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  if (!readSupabaseEnv()) return NOT_CONFIGURED;

  await rememberInvite(formData);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: await callbackUrl(formData) },
  });
  if (error || !data.url) {
    console.error("[auth] Google sign-in failed:", error?.message);
    return {
      status: "error",
      message: "Couldn't start Google sign-in. Try again.",
    };
  }
  redirect(data.url);
}

const emailSchema = z.email("Enter a valid email address.");

export async function signInWithEmail(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  if (!readSupabaseEnv() || !emailSignInEnabled()) return NOT_CONFIGURED;

  const parsed = emailSchema.safeParse(
    String(formData.get("email") ?? "").trim(),
  );
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  await rememberInvite(formData);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: await callbackUrl(formData) },
  });
  if (error) {
    console.error("[auth] magic link failed:", error.message);
    return {
      status: "error",
      message:
        error.status === 429
          ? "Too many emails sent. Wait a minute and try again."
          : "Couldn't send the link. Try again.",
    };
  }
  return { status: "sent", email: parsed.data };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
