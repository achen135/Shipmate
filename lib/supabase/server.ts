import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";
import { requireSupabaseEnv } from "./env";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers,
 * acting as the signed-in user (publishable key + their session cookie), so
 * every query is subject to RLS. Create one per request; never hoist it.
 */
export async function createClient() {
  // cookies() first: during the build it marks the caller as request-time
  // only, so a build with no env never reaches the env check below.
  const cookieStore = await cookies();
  const { url, publishableKey } = requireSupabaseEnv();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe
          // to ignore: the proxy refreshes the session on every request.
        }
      },
    },
  });
}
