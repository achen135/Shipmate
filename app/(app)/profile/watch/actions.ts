"use server";

import { redirect } from "next/navigation";

import type { ActionResult } from "@/lib/action-result";
import { requireMember } from "@/lib/auth/viewer";
import {
  type SaveResult,
  createWatchProfile,
  deleteWatchProfile,
  updateWatchProfile,
} from "@/lib/watch/profiles";

export async function addWatchProfile(values: unknown): Promise<SaveResult> {
  await requireMember();
  const result = await createWatchProfile(values);
  if (!result.ok) return result;
  redirect("/profile");
}

export async function editWatchProfile(
  id: string,
  values: unknown,
): Promise<SaveResult> {
  await requireMember();
  return updateWatchProfile(id, values);
}

export async function removeWatchProfile(id: string): Promise<ActionResult> {
  await requireMember();
  const result = await deleteWatchProfile(id);
  if (!result.ok) return result;
  redirect("/profile");
}
