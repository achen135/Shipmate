import "server-only";

import { z } from "zod";

import {
  importSchema,
  manualAddSchema,
  trackerEditSchema,
} from "@/lib/schemas/tracker";
import { createClient } from "@/lib/supabase/server";

import { readManual } from "./item";
import { listTrackerItems } from "./queries";
import { recordKey } from "./record";
import { isTrackerStatus } from "./status";

/**
 * Tracker writes, as the signed-in user. RLS limits every write to the
 * caller's own rows; column grants limit what can change (never user_id or,
 * after insert, posting_id). status_events are written by the database.
 */

export type WriteResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const UNIQUE_VIOLATION = "23505";

/**
 * Move a shared posting into the Tracker as applied: update the user's row
 * if they have one (Inbox, To Apply, skipped), else create it. A row already
 * in the Tracker is left as it is.
 */
export async function markPostingApplied(
  postingId: string,
): Promise<WriteResult> {
  if (!z.uuid().safeParse(postingId).success) {
    return { ok: false, message: "Something went wrong." };
  }
  const supabase = await createClient();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: row, error } = await supabase
      .from("user_postings")
      .select("id, status")
      .eq("posting_id", postingId)
      .maybeSingle();
    if (error) return failed("find row", error.message);

    if (row) {
      if (isTrackerStatus(row.status)) return { ok: true, id: row.id };
      const { error: updateError } = await supabase
        .from("user_postings")
        .update({ status: "applied", skip_reason: null })
        .eq("id", row.id);
      if (updateError) return failed("mark applied", updateError.message);
      return { ok: true, id: row.id };
    }

    const { data: inserted, error: insertError } = await supabase
      .from("user_postings")
      .insert({ posting_id: postingId, status: "applied" })
      .select("id")
      .single();
    if (inserted) return { ok: true, id: inserted.id };
    // A worker run (or another tab) created the row meanwhile: update it.
    if (insertError?.code !== UNIQUE_VIOLATION) {
      return failed("add posting", insertError?.message);
    }
  }
  return failed("mark applied", "retry exhausted");
}

/** Add an application that isn't a Shipmate posting. */
export async function addManualRow(values: unknown): Promise<WriteResult> {
  const parsed = manualAddSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_postings")
    .insert({
      manual: {
        company: v.company,
        title: v.role,
        url: v.url,
        location: v.location,
      },
      status: v.status,
      applied_at: v.appliedAt,
      term: v.term,
      referral: v.referral,
      notes: v.notes,
    })
    .select("id")
    .single();
  if (error) return failed("add manual", error.message);
  return { ok: true, id: data.id };
}

/** Save the row detail form. Manual rows can also fix company/role/link. */
export async function updateTrackerRow(
  id: string,
  values: unknown,
): Promise<WriteResult> {
  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Something went wrong." };
  }
  const parsed = trackerEditSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("user_postings")
    .select("posting_id, manual")
    .eq("id", id)
    .maybeSingle();
  if (readError) return failed("read row", readError.message);
  if (!row) return { ok: false, message: "That application is gone." };

  let manual = undefined;
  if (row.posting_id === null) {
    if (!v.company) {
      return {
        ok: false,
        message: "Check the highlighted field.",
        fieldErrors: { company: ["Company is required."] },
      };
    }
    manual = {
      company: v.company,
      title: v.role ?? null,
      url: v.url ?? null,
      location: v.location ?? readManual(row.manual)?.location ?? null,
    };
  }

  const { error } = await supabase
    .from("user_postings")
    .update({
      status: v.status,
      status_unsure: v.unsure,
      applied_at: v.appliedAt,
      referral: v.referral,
      referrer: v.referral ? v.referrer : null,
      term: v.term,
      resume_note: v.resumeNote,
      notes: v.notes,
      ...(manual ? { manual } : {}),
    })
    .eq("id", id);
  if (error) return failed("update row", error.message);
  return { ok: true, id };
}

/** Manual rows only (RLS); rows for shared postings are withdrawn instead. */
export async function deleteManualRow(
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Something went wrong." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_postings")
    .delete()
    .eq("id", id)
    .is("posting_id", null)
    .select("id");
  if (error) return failed("delete row", error.message);
  if (data.length === 0) {
    return {
      ok: false,
      message: "Only applications you added can be deleted.",
    };
  }
  return { ok: true };
}

export type ImportOutcome =
  { ok: true; added: number; skipped: number } | { ok: false; message: string };

/**
 * Save previewed import rows as manual tracker rows. Rows already in the
 * tracker (same company + role + date) are skipped, checked again here in
 * case the preview is stale. The insert trigger writes each row's first
 * status event at its applied date.
 */
export async function importRecords(values: unknown): Promise<ImportOutcome> {
  const parsed = importSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid rows.",
    };
  }
  const existing = new Set((await listTrackerItems()).map(recordKey));
  const fresh = parsed.data.filter((r) => {
    const key = recordKey(r);
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  if (fresh.length > 0) {
    const supabase = await createClient();
    const { error } = await supabase.from("user_postings").insert(
      fresh.map((r) => ({
        manual: {
          company: r.company,
          title: r.role,
          url: r.url,
          location: null,
        },
        status: r.status,
        status_unsure: r.unsure,
        applied_at: r.appliedAt,
        referral: r.referral,
        referrer: r.referrer,
        resume_note: r.resumeNote,
        notes: r.notes,
        term: r.term,
      })),
    );
    if (error) return failed("import", error.message);
  }
  return {
    ok: true,
    added: fresh.length,
    skipped: parsed.data.length - fresh.length,
  };
}

function invalid(error: z.ZodError): WriteResult {
  return {
    ok: false,
    message: "Check the highlighted fields.",
    fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]>,
  };
}

function failed(what: string, detail?: string): { ok: false; message: string } {
  console.error(`[tracker] ${what} failed:`, detail ?? "unknown");
  return { ok: false, message: "Couldn't save. Try again." };
}
