import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";
import { requireSupabaseEnv } from "./env";

/**
 * Supabase as nobody in particular: the publishable key and no session.
 * For the extension's routes (lib/extension/server.ts), which have no
 * cookie; RLS treats them as signed out, and the only things they can do
 * are the extension_* functions, which require the server secret and the
 * extension's token. Never the service-role key.
 */
export function createAnonClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  return createClient<Database>(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
