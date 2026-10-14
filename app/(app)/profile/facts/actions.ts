"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { requireInvited } from "@/lib/auth/viewer";
import { factInputSchema } from "@/lib/schemas/fact-bank";
import { createClient } from "@/lib/supabase/server";

/**
 * Fact bank writes, all as the signed-in user (RLS: own rows; a database
 * trigger caps it at 200 entries).
 */

const toRow = (fact: z.output<typeof factInputSchema>) => ({
  kind: fact.kind,
  content: fact.detail
    ? { text: fact.text, detail: fact.detail }
    : { text: fact.text },
});

function failed(error: { code?: string; message: string }): ActionResult {
  console.error("[facts] write failed:", error.code ?? error.message);
  return {
    ok: false,
    message: /200 entries/.test(error.message)
      ? "You can keep up to 200 entries."
      : "Couldn't save. Try again.",
  };
}

export async function addFact(values: unknown): Promise<ActionResult> {
  await requireInvited();
  const parsed = factInputSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("fact_bank")
    .insert({ ...toRow(parsed.data), source: "manual" });
  if (error) return failed(error);
  revalidatePath("/profile/facts");
  return { ok: true };
}

export async function deleteFact(id: unknown): Promise<ActionResult> {
  await requireInvited();
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, message: "Unknown entry." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("fact_bank")
    .delete()
    .eq("id", parsed.data);
  if (error) return failed(error);
  revalidatePath("/profile/facts");
  return { ok: true };
}

/** The suggestions the user ticked, saved as `imported`. */
export async function addSuggestedFacts(
  values: unknown,
): Promise<ActionResult> {
  await requireInvited();
  const parsed = z.array(factInputSchema).min(1).max(40).safeParse(values);
  if (!parsed.success) return { ok: false, message: "Nothing to add." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("fact_bank")
    .insert(parsed.data.map((f) => ({ ...toRow(f), source: "imported" })));
  if (error) return failed(error);
  revalidatePath("/profile/facts");
  return { ok: true };
}
