import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * Service-role client for the app server. Bypasses RLS, so its use is
 * limited to AI keys: the key-saving Server Action (writing the sealed key,
 * which no signed-in role may write or read) and `getProvider` (reading it
 * back to decrypt). lib/ai/guard.test.ts fails if anything else imports
 * this file. Everything else in the app acts as the signed-in user.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in the server env (Vercel: not
 * NEXT_PUBLIC_, so it's never bundled for the browser).
 */
export function createAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY isn't set on the server (needed to store AI keys).",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
