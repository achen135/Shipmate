import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  HOME_PATH,
  SIGN_IN_PATH,
  isGatedPath,
  safeRedirectPath,
} from "@/lib/auth/routes";

import type { Database } from "./database.types";
import { readSupabaseEnv } from "./env";

/**
 * Runs in `proxy.ts` before every matched request. Two jobs:
 *
 * 1. Refresh the Supabase session cookie. Server Components can't write
 *    cookies, so an expiring access token is swapped for a fresh one here.
 * 2. Optimistic gate: no session on a gated path → `/sign-in?next=…`; a
 *    session on `/sign-in` → the app. Invite and onboarding checks need the
 *    database, so they live in the pages (lib/auth/viewer.ts), not here.
 */
export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  let response = NextResponse.next({ request });

  const env = readSupabaseEnv();
  if (!env) {
    // Can't verify anyone, so fail closed: gated pages go to sign-in, which
    // explains that sign-in isn't configured.
    return isGatedPath(pathname)
      ? redirectTo(request, response, SIGN_IN_PATH, pathname + search)
      : response;
  }

  const supabase = createServerClient<Database>(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Responses that set auth cookies must never be cached by a CDN.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Nothing may run between creating the client and this call: it's what
  // refreshes the session. getClaims() verifies the JWT signature (locally
  // with asymmetric keys, otherwise via the Auth server).
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && isGatedPath(pathname)) {
    return redirectTo(request, response, SIGN_IN_PATH, pathname + search);
  }
  if (signedIn && pathname === SIGN_IN_PATH) {
    const next = safeRedirectPath(request.nextUrl.searchParams.get("next"));
    return redirectTo(request, response, next);
  }
  return response;
}

/** Redirect while keeping any refreshed session cookies on the response. */
function redirectTo(
  request: NextRequest,
  from: NextResponse,
  path: string,
  next?: string,
) {
  const url = request.nextUrl.clone();
  const [pathname, query = ""] = path.split("?");
  url.pathname = pathname;
  url.search = query;
  if (next && next !== HOME_PATH) url.searchParams.set("next", next);
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}
