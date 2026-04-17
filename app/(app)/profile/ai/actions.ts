"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { saveApiKey, type SaveKeyResult } from "@/lib/ai/keys";
import { requireInvited } from "@/lib/auth/viewer";
import { aiSettingsSchema } from "@/lib/schemas/ai-settings";
import { createClient } from "@/lib/supabase/server";

/**
 * Profile → AI (and onboarding step 3). Saving a key is the one write that
 * can't go through the user's own client: see lib/ai/keys.ts.
 */

export async function saveKey(values: unknown): Promise<SaveKeyResult> {
  const viewer = await requireInvited();
  const result = await saveApiKey(viewer.id, values);
  if (result.ok) revalidatePath("/profile", "layout");
  return result;
}

/** Remove the key. The database then switches the user back to Simple. */
export async function removeKey(): Promise<ActionResult> {
  const viewer = await requireInvited();
  const supabase = await createClient();
  const { error } = await supabase
    .from("api_keys")
    .delete()
    .eq("user_id", viewer.id);
  if (error) {
    console.error("[ai] remove key failed:", error.code);
    return { ok: false, message: "Couldn't remove the key. Try again." };
  }
  revalidatePath("/profile", "layout");
  return { ok: true };
}

/** Simple ↔ AI. AI needs a saved key (the database refuses otherwise). */
export async function setMode(mode: unknown): Promise<ActionResult> {
  const viewer = await requireInvited();
  const parsed = z.enum(["simple", "ai"]).safeParse(mode);
  if (!parsed.success) return { ok: false, message: "Unknown mode." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ mode: parsed.data })
    .eq("user_id", viewer.id);
  if (error) {
    return {
      ok: false,
      message:
        parsed.data === "ai"
          ? "Add an API key first."
          : "Couldn't switch. Try again.",
    };
  }
  revalidatePath("/profile", "layout");
  return { ok: true };
}

export async function saveAiSettings(values: unknown): Promise<ActionResult> {
  const viewer = await requireInvited();
  const parsed = aiSettingsSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      daily_cap: parsed.data.dailyCap,
      auto_tailor: parsed.data.autoTailor,
    })
    .eq("user_id", viewer.id);
  if (error) {
    console.error("[ai] save settings failed:", error.code);
    return { ok: false, message: "Couldn't save. Try again." };
  }
  return { ok: true };
}
