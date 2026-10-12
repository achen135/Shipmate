import "server-only";

import { z } from "zod";

import { normalizeCompany } from "@/lib/postings/normalize";
import { followLinkSchema, companyIdSchema } from "@/lib/schemas/follow";
import { createClient } from "@/lib/supabase/server";

import { BOARD_LABELS, detectBoard } from "./detect";

/**
 * Follow writes for the signed-in user. Following goes through the database
 * functions follow_company() and follow_board() (they create the shared
 * company and source rows a user can't write directly); priority and
 * unfollow are plain RLS-checked writes on the user's own `follows` row.
 */

export type FollowResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const FAILED: FollowResult = {
  ok: false,
  message: "Couldn't save. Try again.",
};

const STATUS_MESSAGES: Record<string, string> = {
  not_member: "Finish setting up your account first.",
  limit: "You're following as many companies as allowed. Unfollow one first.",
  invalid: "Shipmate couldn't use that link.",
  not_found: "That company isn't in Shipmate anymore.",
};

type RpcOutcome = { status: string; created_source?: boolean };

export async function followByLink(values: unknown): Promise<FollowResult> {
  const parsed = followLinkSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const detected = detectBoard(parsed.data.url);
  if (!detected.ok) {
    return {
      ok: false,
      message:
        detected.reason === "not_a_link"
          ? "That doesn't look like a link."
          : "Shipmate can't read that site yet. It works with Greenhouse, Lever, Ashby, SmartRecruiters, and Workday careers pages.",
      fieldErrors: { url: ["Not a supported careers page."] },
    };
  }

  const name = parsed.data.name ?? detected.board.suggestedName;
  const normalized = normalizeCompany(name);
  if (!normalized) {
    return {
      ok: false,
      message: "Add the company's name.",
      fieldErrors: { name: ["Add the company's name."] },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("follow_board", {
    p_kind: detected.board.kind,
    p_config: detected.board.config,
    p_company_name: name,
    p_normalized_name: normalized,
  });
  if (error) {
    console.error("[follows] follow_board failed:", error.message);
    return FAILED;
  }
  const outcome = data as RpcOutcome;
  if (outcome.status !== "ok") {
    return {
      ok: false,
      message: STATUS_MESSAGES[outcome.status] ?? FAILED.message,
    };
  }
  return {
    ok: true,
    message: `Following ${name} on ${BOARD_LABELS[detected.board.kind]}. New internships show up within about 30 minutes.`,
  };
}

export async function followCompany(companyId: unknown): Promise<FollowResult> {
  const id = companyIdSchema.safeParse(companyId);
  if (!id.success) return FAILED;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("follow_company", {
    p_company_id: id.data,
  });
  if (error) {
    console.error("[follows] follow_company failed:", error.message);
    return FAILED;
  }
  const outcome = data as RpcOutcome;
  if (outcome.status !== "ok") {
    return {
      ok: false,
      message: STATUS_MESSAGES[outcome.status] ?? FAILED.message,
    };
  }
  return { ok: true, message: "Following." };
}

export async function setFollowPriority(
  companyId: unknown,
  priority: boolean,
): Promise<FollowResult> {
  const id = companyIdSchema.safeParse(companyId);
  if (!id.success) return FAILED;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("follows")
    .update({ priority })
    .eq("company_id", id.data)
    .select("company_id");
  if (error || data.length === 0) {
    if (error) console.error("[follows] priority failed:", error.message);
    return FAILED;
  }
  return { ok: true, message: priority ? "Marked priority." : "Priority off." };
}

export async function unfollowCompany(
  companyId: unknown,
): Promise<FollowResult> {
  const id = companyIdSchema.safeParse(companyId);
  if (!id.success) return FAILED;
  const supabase = await createClient();
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("company_id", id.data);
  if (error) {
    console.error("[follows] unfollow failed:", error.message);
    return FAILED;
  }
  return { ok: true, message: "Unfollowed." };
}
