import "server-only";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { rowFromForm, watchProfileSchema } from "@/lib/schemas/watch-profile";
import { createClient } from "@/lib/supabase/server";

import { backfillInbox } from "./backfill";

/**
 * Watch profile writes for the signed-in user (RLS: own rows only; column
 * grants: never user_id). Every save re-runs the 7-day backfill so the Inbox
 * reflects the new rules right away.
 */

export const MAX_WATCH_PROFILES = 10;

export const WATCH_PROFILE_COLUMNS =
  "id, name, preset, categories, include_keywords, exclude_keywords, terms, locations, remote_ok, needs_sponsorship, active" as const;

export type SaveResult = ActionResult & { added?: number };

function invalid(error: z.ZodError): SaveResult {
  return {
    ok: false,
    message: "Check the highlighted fields.",
    fieldErrors: z.flattenError(error).fieldErrors,
  };
}

async function backfillAfterSave(): Promise<SaveResult> {
  try {
    return { ok: true, added: await backfillInbox() };
  } catch (error) {
    // The profile is saved; the worker's next run picks up new matches.
    console.error("[watch] backfill failed:", error);
    return { ok: true, added: 0 };
  }
}

export async function createWatchProfile(input: unknown): Promise<SaveResult> {
  const parsed = watchProfileSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { count, error: countError } = await supabase
    .from("watch_profiles")
    .select("id", { count: "exact", head: true });
  if (countError) {
    console.error("[watch] count failed:", countError.message);
    return { ok: false, message: "Couldn't save. Try again." };
  }
  if ((count ?? 0) >= MAX_WATCH_PROFILES) {
    return {
      ok: false,
      message: `You can have up to ${MAX_WATCH_PROFILES} searches. Edit or delete one first.`,
    };
  }

  const { error } = await supabase
    .from("watch_profiles")
    .insert(rowFromForm(parsed.data));
  if (error) {
    console.error("[watch] create failed:", error.message);
    return { ok: false, message: "Couldn't save. Try again." };
  }
  return backfillAfterSave();
}

export async function updateWatchProfile(
  id: string,
  input: unknown,
): Promise<SaveResult> {
  const parsed = watchProfileSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "That search doesn't exist." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("watch_profiles")
    .update(rowFromForm(parsed.data))
    .eq("id", id)
    .select("id");
  if (error) {
    console.error("[watch] update failed:", error.message);
    return { ok: false, message: "Couldn't save. Try again." };
  }
  if (data.length === 0) {
    return { ok: false, message: "That search doesn't exist." };
  }
  return backfillAfterSave();
}

export async function deleteWatchProfile(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: true };
  const supabase = await createClient();
  // Inbox rows it found stay; their watch_profile_id becomes null.
  const { error } = await supabase.from("watch_profiles").delete().eq("id", id);
  if (error) {
    console.error("[watch] delete failed:", error.message);
    return { ok: false, message: "Couldn't delete. Try again." };
  }
  return { ok: true };
}
