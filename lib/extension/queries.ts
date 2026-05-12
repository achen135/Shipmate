import "server-only";

import { createClient } from "@/lib/supabase/server";

/** The signed-in user's connected extension, if any (never the token). */
export async function getExtensionConnection(): Promise<{
  connectedAt: string;
  lastUsedAt: string | null;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("extension_tokens")
    .select("created_at, last_used_at")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(`extension: ${error.message}`);
  return data
    ? { connectedAt: data.created_at, lastUsedAt: data.last_used_at }
    : null;
}
