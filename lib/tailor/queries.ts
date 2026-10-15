import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { Warning } from "@/lib/review/warnings";

import type { Change } from "./edits";
import { MAX_SUGGESTIONS, type Suggestion } from "./second-look";

/**
 * Tailoring as the signed-in user sees it (RLS: their own rows only).
 */

const changesSchema = z.array(
  z.object({
    what: z.string(),
    why: z.string(),
    before: z.string().optional(),
    after: z.string().optional(),
  }),
);
const notesSchema = z.array(z.string());
const suggestionsSchema = z
  .array(z.object({ what: z.string() }))
  .max(MAX_SUGGESTIONS);
const warningsSchema = z.array(
  z.object({ kind: z.string(), message: z.string() }).loose(),
);

export type TailoringView = {
  id: string;
  state: "queued" | "running" | "done" | "failed";
  createdAt: string;
  rateLimitedAt: string | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  matched: string[];
  missing: string[];
  changes: Change[];
  /** A second look's notes: noticed, never applied. */
  suggestions: Suggestion[];
  notes: string[];
  warnings: Warning[];
  hasPdf: boolean;
  pdfPending: boolean;
  edited: boolean;
  keySource: "own" | "shared" | null;
  /** The model that answered last (the shared key's backup, sometimes). */
  model: string | null;
  estCost: number;
  error: string | null;
};

/** The latest tailoring for one Inbox row, or null. */
export async function getLatestTailoring(
  userPostingId: string,
): Promise<TailoringView | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tailorings")
    .select(
      "id, state, created_at, rate_limited_at, score_before, score_after, matched, missing, changes, suggestions, notes, warnings, pdf_path, pdf_requested_at, edited_at, key_source, model, est_cost, error",
    )
    .eq("user_posting_id", userPostingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`tailoring: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    state: data.state as TailoringView["state"],
    createdAt: data.created_at,
    rateLimitedAt: data.rate_limited_at,
    scoreBefore: data.score_before,
    scoreAfter: data.score_after,
    matched: data.matched,
    missing: data.missing,
    changes: changesSchema.catch([]).parse(data.changes),
    suggestions: suggestionsSchema.catch([]).parse(data.suggestions),
    notes: notesSchema.catch([]).parse(data.notes),
    warnings: warningsSchema.catch([]).parse(data.warnings) as Warning[],
    hasPdf: data.pdf_path !== null,
    pdfPending: data.pdf_requested_at !== null,
    edited: data.edited_at !== null,
    keySource: (data.key_source as TailoringView["keySource"]) ?? null,
    model: data.model,
    estCost: Number(data.est_cost),
    error: data.error,
  };
}

/** Today's tailorings that count against the cap, and what they cost. */
export async function getUsageToday(): Promise<{
  count: number;
  cost: number;
}> {
  const supabase = await createClient();
  const { data: start, error: startError } = await supabase.rpc(
    "tailoring_day_start",
  );
  if (startError) throw new Error(`day start: ${startError.message}`);
  const { data, error } = await supabase
    .from("tailorings")
    .select("est_cost")
    .gte("created_at", start)
    .neq("state", "failed");
  if (error) throw new Error(`usage: ${error.message}`);
  return {
    count: data.length,
    cost: data.reduce((sum, row) => sum + Number(row.est_cost), 0),
  };
}
