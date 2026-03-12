"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { requireAdmin } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

/*
 * Both actions run as the signed-in admin (RLS + is_admin() decide), never
 * with the service-role key. requireAdmin() is for a friendly error; the
 * database is what actually refuses a non-admin.
 */

export type CreateInviteState =
  | { status: "idle" }
  | { status: "created"; code: string }
  | { status: "error"; message: string };

const noteSchema = z
  .string()
  .trim()
  .max(200, "Keep the note under 200 characters.");

export async function createInvite(
  _prev: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  await requireAdmin();
  const note = noteSchema.safeParse(String(formData.get("note") ?? ""));
  if (!note.success)
    return { status: "error", message: note.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invites")
    .insert({ note: note.data || null })
    .select("code")
    .single();
  if (error) {
    console.error("[admin] create invite failed:", error.message);
    return { status: "error", message: "Couldn't create a code. Try again." };
  }
  refresh();
  return { status: "created", code: data.code };
}

export async function revokeInvite(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!z.uuid().safeParse(id).success)
    return { ok: false, message: "Unknown invite." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("used_at", null)
    .is("revoked_at", null)
    .select("id");
  if (error || data.length === 0) {
    console.error("[admin] revoke failed:", error?.message ?? "no row");
    return { ok: false, message: "Couldn't revoke that code (already used?)." };
  }
  refresh();
  return { ok: true };
}
