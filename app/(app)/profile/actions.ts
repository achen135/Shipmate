"use server";

import type { ActionResult } from "@/lib/action-result";
import { requireMember } from "@/lib/auth/viewer";
import { saveBasics } from "@/lib/profile/save-basics";

export async function updateBasics(values: unknown): Promise<ActionResult> {
  const viewer = await requireMember();
  return saveBasics(viewer, values);
}
