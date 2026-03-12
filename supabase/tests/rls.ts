/**
 * RLS + invite tests: drive PostgREST with real user JWTs against the LOCAL
 * Supabase stack.
 *
 *   npx supabase start
 *   npm run db:test:rls
 *
 * ## Why a script and not a Vitest file
 *
 * What's under test is Postgres: policies, column grants, and the
 * `security definer` redeem function. The honest way to test that is to sign in
 * as real users and ask the database, the same path the app takes. Vitest runs
 * without a database, so this is its own command (CI runs it in the `db` job).
 *
 * Users are created with the admin API and signed in by verifying a generated
 * magic-link token, so each client holds a genuine session JWT and no
 * passwords are involved.
 *
 * Refuses to run against anything but localhost: it creates and deletes users.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) {
  console.error(
    `Refusing to run against ${url || "<no NEXT_PUBLIC_SUPABASE_URL>"}.\n` +
      "These tests create and delete users, so they only run locally:\n\n" +
      "  npx supabase start\n" +
      "  npm run db:test:rls\n",
  );
  process.exit(1);
}
if (!publishableKey || !secretKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

type Client = SupabaseClient<Database>;

const NO_SESSION = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

const admin: Client = createClient<Database>(url, secretKey, NO_SESSION);

const DOMAIN = "rls-test.shipmate.invalid";

// ---------------------------------------------------------------- assertions

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(
      `  FAIL ${name}${detail === undefined ? "" : `\n         ${JSON.stringify(detail)}`}`,
    );
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, Object.is(actual, expected), { actual, expected });
}

// ---------------------------------------------------------------- helpers

async function deleteTestUsers(): Promise<void> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const user of data.users) {
      if (user.email?.endsWith(`@${DOMAIN}`)) {
        await admin.auth.admin.deleteUser(user.id);
      }
    }
    if (data.users.length < 200) return;
  }
}

type TestUser = { id: string; email: string; client: Client };

/** Create a user and return a client signed in as them (role `authenticated`). */
async function makeUser(name: string): Promise<TestUser> {
  const email = `${name}@${DOMAIN}`;
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: `Test ${name}` },
    });
  if (createError)
    throw new Error(`createUser ${email}: ${createError.message}`);

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw new Error(`generateLink ${email}: ${linkError.message}`);

  const client = createClient<Database>(url, publishableKey, NO_SESSION);
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyError)
    throw new Error(`verifyOtp ${email}: ${verifyError.message}`);

  return { id: created.user.id, email, client };
}

async function createInviteAsAdmin(client: Client, note: string) {
  const { data, error } = await client
    .from("invites")
    .insert({ note })
    .select("id, code")
    .single();
  if (error) throw new Error(`create invite: ${error.message}`);
  return data;
}

async function redeem(client: Client, code: string): Promise<string> {
  const { data, error } = await client.rpc("redeem_invite", { p_code: code });
  if (error) throw new Error(`redeem_invite: ${error.message}`);
  return data;
}

async function invitedAt(userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("invited_at")
    .eq("user_id", userId)
    .single();
  if (error) throw new Error(`read profile: ${error.message}`);
  return data.invited_at;
}

// ---------------------------------------------------------------- tests

async function testProfiles(a: TestUser, b: TestUser): Promise<void> {
  console.log("\nprofiles: each user sees and edits only their own row");

  const own = await a.client.from("profiles").select("user_id, email, name");
  eq("A sees exactly one profile", own.data?.length, 1);
  eq("…and it is A's", own.data?.[0]?.user_id, a.id);
  eq("the auth trigger copied the email", own.data?.[0]?.email, a.email);
  eq("…and the Google-style full_name", own.data?.[0]?.name, "Test a");

  const other = await a.client.from("profiles").select("*").eq("user_id", b.id);
  eq("A can't read B's profile", other.data?.length, 0);

  const updateOther = await a.client
    .from("profiles")
    .update({ name: "hijacked" })
    .eq("user_id", b.id)
    .select("user_id");
  eq("A's update of B's profile touches 0 rows", updateOther.data?.length, 0);
  const { data: bRow } = await admin
    .from("profiles")
    .select("name")
    .eq("user_id", b.id)
    .single();
  eq("B's name is unchanged", bRow?.name, "Test b");

  const updateOwn = await a.client
    .from("profiles")
    .update({ school: "Test University", grad_year: 2028 })
    .eq("user_id", a.id)
    .select("school");
  eq(
    "A can update their own basics",
    updateOwn.data?.[0]?.school,
    "Test University",
  );

  const selfInvite = await a.client
    .from("profiles")
    .update({ invited_at: new Date().toISOString() })
    .eq("user_id", a.id);
  check(
    "A can't set their own invited_at (column not granted)",
    selfInvite.error !== null,
    selfInvite.error?.message,
  );
  eq("A is still not invited", await invitedAt(a.id), null);

  const insert = await a.client
    .from("profiles")
    .insert({ user_id: crypto.randomUUID() } as never);
  check(
    "A can't insert profiles",
    insert.error !== null,
    insert.error?.message,
  );

  const del = await a.client
    .from("profiles")
    .delete()
    .eq("user_id", a.id)
    .select();
  check(
    "A can't delete their profile",
    del.error !== null || del.data?.length === 0,
    del.error?.message,
  );

  const anon = createClient<Database>(url, publishableKey, NO_SESSION);
  const anonRead = await anon.from("profiles").select("user_id");
  check(
    "anonymous requests read no profiles",
    anonRead.error !== null || anonRead.data?.length === 0,
    anonRead.error?.message,
  );
}

async function testAdmins(alice: TestUser, a: TestUser): Promise<void> {
  console.log(
    "\napp_admins: readable only by the user themself, never writable",
  );

  const own = await alice.client.from("app_admins").select("user_id");
  eq("the admin sees their own row", own.data?.length, 1);

  const others = await a.client.from("app_admins").select("user_id");
  eq("a non-admin sees no rows (not even the admin's)", others.data?.length, 0);

  const selfPromote = await a.client
    .from("app_admins")
    .insert({ user_id: a.id });
  check(
    "a non-admin can't add themself",
    selfPromote.error !== null,
    selfPromote.error?.message,
  );

  const { data: isAdminA } = await a.client.rpc("is_admin");
  eq("is_admin() is false for a non-admin", isAdminA, false);
  const { data: isAdminAlice } = await alice.client.rpc("is_admin");
  eq("is_admin() is true for the admin", isAdminAlice, true);
}

async function testInvites(alice: TestUser, a: TestUser): Promise<void> {
  console.log("\ninvites: only admins create, list, and revoke");

  const nonAdminCreate = await a.client
    .from("invites")
    .insert({ note: "nope" });
  check(
    "a non-admin can't create an invite",
    nonAdminCreate.error !== null,
    nonAdminCreate.error?.message,
  );

  const invite = await createInviteAsAdmin(alice.client, "for the list test");
  check(
    "the admin can create one",
    /^[2-9A-HJKMNP-Z]{8}$/.test(invite.code),
    invite,
  );

  const nonAdminList = await a.client.from("invites").select("id, code");
  eq("a non-admin lists no invites", nonAdminList.data?.length, 0);

  const adminList = await alice.client
    .from("invites")
    .select("id")
    .eq("id", invite.id);
  eq("the admin can list it", adminList.data?.length, 1);

  const nonAdminRevoke = await a.client
    .from("invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invite.id)
    .select("id");
  eq("a non-admin's revoke touches 0 rows", nonAdminRevoke.data?.length, 0);

  const forgeCode = await alice.client
    .from("invites")
    .insert({ note: "forged", code: "AAAAAAAA" } as never);
  check(
    "even an admin can't choose the code (column not granted)",
    forgeCode.error !== null,
    forgeCode.error?.message,
  );

  const forgeUse = await alice.client
    .from("invites")
    .update({ used_by: a.id } as never)
    .eq("id", invite.id);
  check(
    "even an admin can't mark a code used directly",
    forgeUse.error !== null,
    forgeUse.error?.message,
  );

  const anonRedeem = await createClient<Database>(
    url,
    publishableKey,
    NO_SESSION,
  ).rpc("redeem_invite", { p_code: invite.code });
  check(
    "anonymous callers can't run redeem_invite",
    anonRedeem.error !== null,
    anonRedeem.error?.message,
  );
}

async function testRedeem(
  alice: TestUser,
  b: TestUser,
  c: TestUser,
): Promise<void> {
  console.log("\nredeem_invite: single use, atomic");

  const invite = await createInviteAsAdmin(alice.client, "for B");
  eq("B is not invited yet", await invitedAt(b.id), null);

  // Lowercase with a dash, the way someone might type it from a message.
  const typed =
    `${invite.code.slice(0, 4)}-${invite.code.slice(4)}`.toLowerCase();
  eq("B redeems it (normalised input)", await redeem(b.client, typed), "ok");
  check("B is now invited", (await invitedAt(b.id)) !== null);

  const { data: bProfile } = await b.client
    .from("profiles")
    .select("onboarding_step")
    .single();
  eq("B moves on to onboarding step 2", bProfile?.onboarding_step, 2);

  eq(
    "C can't reuse the same code",
    await redeem(c.client, invite.code),
    "used",
  );
  eq("C is still not invited", await invitedAt(c.id), null);
  eq(
    "B redeeming again doesn't spend anything",
    await redeem(b.client, invite.code),
    "already_invited",
  );

  const { data: row } = await alice.client
    .from("invites")
    .select("used_by, used_at")
    .eq("id", invite.id)
    .single();
  eq("the invite records who used it", row?.used_by, b.id);

  eq(
    "an unknown code is invalid",
    await redeem(c.client, "ZZZZ2222"),
    "invalid",
  );

  const revoked = await createInviteAsAdmin(alice.client, "to revoke");
  const revoke = await alice.client
    .from("invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", revoked.id);
  check(
    "the admin can revoke a code",
    revoke.error === null,
    revoke.error?.message,
  );
  eq(
    "a revoked code can't be redeemed",
    await redeem(c.client, revoked.code),
    "revoked",
  );
}

async function testRace(alice: TestUser): Promise<void> {
  console.log("\nredeem_invite: two people racing for one code, one wins");

  const contested = await createInviteAsAdmin(alice.client, "contested");
  const racers = await Promise.all([makeUser("racer1"), makeUser("racer2")]);
  const results = await Promise.all(
    racers.map((r) => redeem(r.client, contested.code)),
  );
  eq("exactly one 'ok'", results.filter((r) => r === "ok").length, 1);
  eq("the other gets 'used'", results.filter((r) => r === "used").length, 1);

  const invited = await Promise.all(racers.map((r) => invitedAt(r.id)));
  eq(
    "exactly one racer is invited",
    invited.filter((at) => at !== null).length,
    1,
  );
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  console.log(`RLS tests: ${url}`);
  await deleteTestUsers();

  try {
    const [alice, a, b, c] = await Promise.all([
      makeUser("alice"),
      makeUser("a"),
      makeUser("b"),
      makeUser("c"),
    ]);
    const { error } = await admin
      .from("app_admins")
      .insert({ user_id: alice.id });
    if (error) throw new Error(`seed admin: ${error.message}`);

    await testProfiles(a, b);
    await testAdmins(alice, a);
    await testInvites(alice, a);
    await testRedeem(alice, b, c);
    await testRace(alice);
  } finally {
    await deleteTestUsers();
  }

  console.log(
    `\n${passed} passed, ${failures.length} failed` +
      (failures.length ? `\n  ${failures.join("\n  ")}` : ""),
  );
  process.exit(failures.length ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
