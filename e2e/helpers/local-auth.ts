import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Test-only sign-in for E2E, against the LOCAL Supabase stack only.
 *
 * Creates users with the admin API, then signs the browser in through the
 * app's real magic-link endpoint (/auth/confirm) with a generated token, so
 * the session cookie is set exactly as in production. Nothing test-only is
 * shipped in the app itself.
 *
 * Run with `npm run test:e2e:local` (wraps Playwright with the local keys).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const DOMAIN = "e2e.shipmate.invalid";

/** True when pointed at a local stack with the keys needed to run auth tests. */
export const localSupabaseAvailable =
  /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url) && secretKey !== "";

function admin() {
  if (!localSupabaseAvailable) {
    throw new Error(
      `Refusing to create test users against ${url || "<unset>"}: local Supabase only.`,
    );
  }
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type TestUser = { id: string; email: string };

const created: string[] = [];

export function testEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`;
}

export async function createTestUser(label: string): Promise<TestUser> {
  const email = testEmail(label);
  const { data, error } = await admin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  created.push(data.user.id);
  return { id: data.user.id, email };
}

export async function makeAdmin(user: TestUser): Promise<void> {
  const { error } = await admin()
    .from("app_admins")
    .insert({ user_id: user.id });
  if (error) throw new Error(`app_admins insert: ${error.message}`);
}

/** Sign `page`'s browser context in as `user`, landing on `next`. */
export async function signIn(
  page: Page,
  user: TestUser,
  next = "/inbox",
): Promise<void> {
  const { data, error } = await admin().auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  if (error) throw new Error(`generateLink: ${error.message}`);
  const params = new URLSearchParams({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
    next,
  });
  await page.goto(`/auth/confirm?${params}`);
}

/** Track a user the app created itself (e.g. via a magic link) for cleanup. */
export async function adoptUser(email: string): Promise<void> {
  const { data, error } = await admin().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const user = data.users.find((u) => u.email === email);
  if (user) created.push(user.id);
}

/** A fresh invite code, created with the service role (no admin UI). */
export async function createInviteCode(note: string): Promise<string> {
  const { data, error } = await admin()
    .from("invites")
    .insert({ note })
    .select("code")
    .single();
  if (error) throw new Error(`invites insert: ${error.message}`);
  return data.code as string;
}

/**
 * The sign-in link from the newest email to `to` in Mailpit (local Supabase's
 * mail catcher). Polls briefly because sending is asynchronous.
 */
export async function magicLinkFor(to: string): Promise<string> {
  const mailpit = process.env.MAILPIT_URL;
  if (!mailpit) throw new Error("MAILPIT_URL not set (run via test:e2e:local)");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const search = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    ).then((r) => r.json() as Promise<{ messages: { ID: string }[] }>);
    const id = search.messages[0]?.ID;
    if (id) {
      const message = await fetch(`${mailpit}/api/v1/message/${id}`).then(
        (r) => r.json() as Promise<{ Text: string }>,
      );
      const link = message.Text.match(
        /https?:\/\/\S+\/auth\/v1\/verify\S+/,
      )?.[0];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no sign-in email for ${to}`);
}

/** Delete the users this worker created (other workers' users are untouched). */
export async function deleteCreatedUsers(): Promise<void> {
  const client = admin();
  for (const id of created.splice(0)) {
    await client.auth.admin.deleteUser(id);
  }
}
