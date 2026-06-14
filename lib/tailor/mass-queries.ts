import "server-only";

import { getSharedQuota } from "@/lib/ai/queries";
import type { SharedQuotaLine } from "@/lib/ai/types";
import { createClient } from "@/lib/supabase/server";

import { getUsageToday } from "./queries";

export type TailorAllPlan = {
  /** Saved, open, and with no tailoring queued, running or done. */
  eligible: number;
  remainingToday: number;
  dailyCap: number;
  /** On the shared key: how busy it is today (null with a key of your own). */
  sharedQuota: SharedQuotaLine[] | null;
};

/**
 * What "Tailor all" would do right now, for the To Apply screen (M9 §1), as
 * the signed-in user. An estimate for the button's line; tailor_all() in the
 * database makes the real schedule. Null outside AI mode.
 */
export async function getTailorAllPlan(
  savedOpenIds: string[],
): Promise<TailorAllPlan | null> {
  const supabase = await createClient();
  const [profile, key, used, active] = await Promise.all([
    supabase.from("profiles").select("mode, daily_cap").maybeSingle(),
    supabase.from("api_keys_public").select("provider").maybeSingle(),
    getUsageToday(),
    savedOpenIds.length > 0
      ? supabase
          .from("tailorings")
          .select("user_posting_id")
          .in("user_posting_id", savedOpenIds)
          .in("state", ["queued", "running", "done"])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profile.error) throw new Error(`profile: ${profile.error.message}`);
  if (key.error) throw new Error(`api key: ${key.error.message}`);
  if (active.error) throw new Error(`tailorings: ${active.error.message}`);
  if (profile.data?.mode !== "ai") return null;

  const busy = new Set(
    (active.data ?? []).map(
      (row: { user_posting_id: string }) => row.user_posting_id,
    ),
  );
  const dailyCap = profile.data.daily_cap;
  return {
    eligible: savedOpenIds.filter((id) => !busy.has(id)).length,
    remainingToday: Math.max(0, dailyCap - used.count),
    dailyCap,
    sharedQuota: key.data?.provider ? null : await getSharedQuota(),
  };
}
