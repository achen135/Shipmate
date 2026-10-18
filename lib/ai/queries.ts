import "server-only";

import { formatShortDate } from "@/lib/format/time";
import { createClient } from "@/lib/supabase/server";
import { getUsageToday } from "@/lib/tailor/queries";

import { SHARED_DAILY_LIMITS } from "./models";
import type { ProviderName, SharedQuotaLine } from "./types";

/**
 * Today's calls on the shared key against its free daily limits, from
 * shared_ai_quota() (counts only, nothing about who). Pacific day.
 */
export async function getSharedQuota(): Promise<SharedQuotaLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("shared_ai_quota");
  if (error) throw new Error(`shared quota: ${error.message}`);
  return SHARED_DAILY_LIMITS.map(({ model, perDay }) => ({
    label: model.label,
    perDay,
    used: data
      .filter((row) => row.model.startsWith(model.id))
      .reduce((sum, row) => sum + Number(row.used), 0),
  }));
}

/**
 * What the AI settings screen shows, as the signed-in user: the key's
 * provider and last four (through api_keys_public; the secret columns
 * aren't readable from here at all), the mode and cap, and today's usage.
 */
export async function getAiSettings() {
  const supabase = await createClient();
  const [key, profile, usedToday] = await Promise.all([
    supabase
      .from("api_keys_public")
      .select("provider, last4, created_at")
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("mode, daily_cap, auto_tailor")
      .maybeSingle(),
    getUsageToday(),
  ]);
  if (key.error) throw new Error(`api key: ${key.error.message}`);
  if (profile.error) throw new Error(`profile: ${profile.error.message}`);
  // Only people on the shared key see its quota: a key of your own is yours.
  const sharedQuota = key.data?.provider ? null : await getSharedQuota();
  return {
    savedKey:
      key.data?.provider && key.data.last4 && key.data.created_at
        ? {
            provider: key.data.provider as ProviderName,
            last4: key.data.last4,
            addedOn: formatShortDate(key.data.created_at),
          }
        : null,
    mode: (profile.data?.mode === "ai" ? "ai" : "simple") as "simple" | "ai",
    dailyCap: profile.data?.daily_cap ?? 10,
    autoTailor: profile.data?.auto_tailor ?? false,
    usedToday,
    sharedQuota,
  };
}
