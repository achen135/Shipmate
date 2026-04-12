"use server";

import { headers } from "next/headers";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { requireMember } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

/**
 * Notification settings. Subscriptions go through save_push_subscription()
 * (a database function: a browser endpoint belongs to whoever is signed in on
 * it now); the email switch is a column the user may edit.
 */

const subscriptionSchema = z.object({
  endpoint: z.url().max(1000).startsWith("https://"),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

export async function savePushSubscription(
  input: unknown,
): Promise<ActionResult> {
  await requireMember();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "This browser sent something unexpected." };
  }
  const userAgent = (await headers()).get("user-agent") ?? "";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_keys: parsed.data.keys,
    p_user_agent: userAgent,
  });
  if (error) {
    console.error("[notifications] subscribe failed:", error.message);
    return { ok: false, message: "Couldn't turn notifications on. Try again." };
  }
  if (data === "limit") {
    return {
      ok: false,
      message: "That's 10 devices. Turn one off before adding another.",
    };
  }
  if (data !== "ok") {
    return { ok: false, message: "Couldn't turn notifications on. Try again." };
  }
  return { ok: true };
}

export async function removePushSubscription(
  endpoint: string,
): Promise<ActionResult> {
  await requireMember();
  if (!z.url().max(1000).safeParse(endpoint).success) {
    return { ok: false, message: "Something went wrong." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);
  if (error) {
    console.error("[notifications] unsubscribe failed:", error.message);
    return { ok: false, message: "Couldn't turn it off. Try again." };
  }
  return { ok: true };
}

export async function setEmailFallback(
  enabled: boolean,
): Promise<ActionResult> {
  const viewer = await requireMember();
  if (typeof enabled !== "boolean") {
    return { ok: false, message: "Something went wrong." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ notify_prefs: { email: enabled } })
    .eq("user_id", viewer.id);
  if (error) {
    console.error("[notifications] email pref failed:", error.message);
    return { ok: false, message: "Couldn't save. Try again." };
  }
  return { ok: true };
}
