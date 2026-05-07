"use server";

import { redirect } from "next/navigation";

import { recordResumeUsed } from "@/app/(app)/postings/actions";
import { requireMember } from "@/lib/auth/viewer";
import {
  type ImportOutcome,
  type WriteResult,
  addManualRow,
  deleteManualRow,
  importRecords,
  markPostingApplied,
  updateTrackerRow,
} from "@/lib/tracker/write";

/**
 * Tracker actions. Each re-checks the session, then writes as the user
 * (lib/tracker/write.ts), so RLS and column grants apply in the database.
 */

/** "Mark applied" on a posting with no Inbox row yet, or "Add" after lookup. */
export async function addPostingToTracker(
  postingId: string,
  options: { open?: boolean } = {},
): Promise<WriteResult> {
  await requireMember();
  const result = await markPostingApplied(postingId);
  if (result.ok) await recordResumeUsed(result.id);
  if (result.ok && options.open) redirect(`/tracker/${result.id}`);
  return result;
}

export async function addManualApplication(
  values: unknown,
): Promise<WriteResult> {
  await requireMember();
  const result = await addManualRow(values);
  if (!result.ok) return result;
  redirect(`/tracker/${result.id}`);
}

export async function saveTrackerRow(
  id: string,
  values: unknown,
): Promise<WriteResult> {
  await requireMember();
  return updateTrackerRow(id, values);
}

export async function deleteTrackerRow(
  id: string,
): Promise<{ ok: false; message: string }> {
  await requireMember();
  const result = await deleteManualRow(id);
  if (!result.ok) return result;
  redirect("/tracker");
}

export async function importApplications(
  records: unknown,
): Promise<ImportOutcome> {
  await requireMember();
  return importRecords(records);
}
