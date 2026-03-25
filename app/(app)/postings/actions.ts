"use server";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { requireMember } from "@/lib/auth/viewer";
import {
  type StatusChange,
  statusChangeSchema,
  statusUpdate,
} from "@/lib/inbox/status";
import { createClient } from "@/lib/supabase/server";

/**
 * Inbox / To Apply / posting detail actions. RLS limits each update to the
 * caller's own row; column grants limit it to status, skip_reason, seen_at.
 * No revalidation: the card shows the result itself (with Undo), and the
 * lists are dynamic, so the next visit reads fresh rows.
 */

export async function changeStatus(input: StatusChange): Promise<ActionResult> {
  await requireMember();
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Something went wrong." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_postings")
    .update(statusUpdate(parsed.data))
    .eq("id", parsed.data.id)
    .select("id");
  if (error || data.length === 0) {
    console.error("[inbox] status change failed:", error?.message ?? "no row");
    return { ok: false, message: "Couldn't update. Try again." };
  }
  return { ok: true };
}

export async function markSeen(id: string): Promise<void> {
  await requireMember();
  if (!z.uuid().safeParse(id).success) return;
  const supabase = await createClient();
  await supabase
    .from("user_postings")
    .update({ seen_at: new Date().toISOString() })
    .eq("id", id)
    .is("seen_at", null);
}
