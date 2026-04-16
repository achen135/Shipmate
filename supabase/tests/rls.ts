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

// ---------------------------------------------------------------- M2

async function seedPosting(title: string): Promise<string> {
  const name = `RLS Test Co ${crypto.randomUUID().slice(0, 8)}`;
  const { data: company, error } = await admin
    .from("companies")
    .insert({ name, normalized_name: name.toLowerCase() })
    .select("id")
    .single();
  if (error) throw new Error(`seed company: ${error.message}`);
  const url = `https://example.com/rls/${crypto.randomUUID()}`;
  const { data: posting, error: postingError } = await admin
    .from("postings")
    .insert({
      company_id: company.id,
      title,
      url,
      canonical_url: url,
      content_hash: "rls",
      category: "Software",
      terms: ["Summer 2027"],
      posted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (postingError) throw new Error(`seed posting: ${postingError.message}`);
  return posting.id;
}

async function deleteSeededPostings(): Promise<void> {
  // postings.company_id doesn't cascade, so the postings go first; then the
  // companies, which take their sources and follows with them.
  const { data: companies } = await admin
    .from("companies")
    .select("id")
    .like("name", "RLS Test Co %");
  const ids = (companies ?? []).map((c) => c.id);
  for (let i = 0; i < ids.length; i += 50) {
    await admin
      .from("postings")
      .delete()
      .in("company_id", ids.slice(i, i + 50));
  }
  await admin.from("companies").delete().like("name", "RLS Test Co %");
}

async function testWatcherTables(alice: TestUser, a: TestUser): Promise<void> {
  console.log(
    "\nwatcher tables: members read postings; only the worker writes",
  );

  const postingId = await seedPosting("RLS Software Engineer Intern");

  const read = await a.client
    .from("postings")
    .select("id, title")
    .eq("id", postingId);
  eq("a signed-in user can read postings", read.data?.length, 1);
  const companies = await a.client.from("companies").select("id").limit(1);
  eq("…and companies", companies.data?.length, 1);

  const anon = createClient<Database>(url, publishableKey, NO_SESSION);
  const anonRead = await anon.from("postings").select("id");
  check(
    "anonymous requests read no postings",
    anonRead.error !== null || anonRead.data?.length === 0,
    anonRead.error?.message,
  );

  const insert = await a.client.from("postings").insert({
    company_id: crypto.randomUUID(),
    title: "fake",
    url: "https://x",
    canonical_url: "https://x",
    content_hash: "x",
  });
  check(
    "users can't insert postings",
    insert.error !== null,
    insert.error?.message,
  );

  const update = await a.client
    .from("postings")
    .update({ title: "hijacked" })
    .eq("id", postingId)
    .select("id");
  check(
    "users can't update postings",
    update.error !== null || update.data?.length === 0,
    update.error?.message,
  );
  const del = await a.client
    .from("postings")
    .delete()
    .eq("id", postingId)
    .select("id");
  check(
    "users can't delete postings",
    del.error !== null || del.data?.length === 0,
    del.error?.message,
  );
  const { data: stillThere } = await admin
    .from("postings")
    .select("title")
    .eq("id", postingId)
    .single();
  eq(
    "the posting is unchanged",
    stillThere?.title,
    "RLS Software Engineer Intern",
  );

  const companyWrite = await a.client
    .from("companies")
    .insert({ name: "Fake", normalized_name: "fake" });
  check(
    "users can't write companies",
    companyWrite.error !== null,
    companyWrite.error?.message,
  );

  const links = await a.client.from("posting_sources").select("id");
  check(
    "users can't read posting_sources (raw upstream rows)",
    links.error !== null || links.data?.length === 0,
    links.error?.message,
  );

  const sourcesA = await a.client.from("sources").select("id");
  eq("a non-admin sees no sources", sourcesA.data?.length, 0);
  const runsA = await a.client.from("runs").select("id");
  eq("…and no runs", runsA.data?.length, 0);
  const sourcesAlice = await alice.client
    .from("sources")
    .select("id, last_error");
  eq("the admin sees all three sources", sourcesAlice.data?.length, 3);
  const sourceWrite = await alice.client
    .from("sources")
    .update({ enabled: false })
    .neq("id", crypto.randomUUID())
    .select("id");
  check(
    "even an admin can't write sources",
    sourceWrite.error !== null || sourceWrite.data?.length === 0,
    sourceWrite.error?.message,
  );

  for (const [fn, args] of [
    ["touch_seen", { p_link_ids: [] }],
    ["update_links", { p_links: [] }],
    ["dispatch_watch", {}],
  ] as const) {
    const call = await a.client.rpc(fn as never, args as never);
    check(`users can't call ${fn}()`, call.error !== null, call.error?.message);
  }
}

async function testInbox(a: TestUser, b: TestUser): Promise<void> {
  console.log("\nwatch_profiles + user_postings: own rows only");

  const profile = {
    name: "SWE",
    preset: "swe",
    categories: ["Software"],
    terms: ["Summer 2027"],
  };
  const { data: aProfile, error: aError } = await a.client
    .from("watch_profiles")
    .insert(profile)
    .select("id, user_id")
    .single();
  check("A creates a watch profile", aError === null, aError?.message);
  eq("…owned by A (user_id defaults to the caller)", aProfile?.user_id, a.id);
  const { data: bProfile } = await b.client
    .from("watch_profiles")
    .insert(profile)
    .select("id")
    .single();

  const forged = await a.client
    .from("watch_profiles")
    .insert({ ...profile, user_id: b.id } as never);
  check(
    "A can't create a profile for B (user_id not granted)",
    forged.error !== null,
    forged.error?.message,
  );

  const readB = await a.client
    .from("watch_profiles")
    .select("id")
    .eq("id", bProfile!.id);
  eq("A can't read B's watch profiles", readB.data?.length, 0);
  const editB = await a.client
    .from("watch_profiles")
    .update({ name: "hijacked" })
    .eq("id", bProfile!.id)
    .select("id");
  eq("A's update of B's profile touches 0 rows", editB.data?.length, 0);
  const deleteB = await a.client
    .from("watch_profiles")
    .delete()
    .eq("id", bProfile!.id)
    .select("id");
  eq("A's delete of B's profile touches 0 rows", deleteB.data?.length, 0);

  const postingId = await seedPosting("RLS Backend Intern");
  const otherPostingId = await seedPosting("RLS Frontend Intern");

  // The backfill path: insert own rows, ignore duplicates.
  const backfill = await a.client
    .from("user_postings")
    .upsert([{ posting_id: postingId, watch_profile_id: aProfile!.id }], {
      onConflict: "user_id,posting_id",
      ignoreDuplicates: true,
    })
    .select("id, user_id, status");
  check(
    "A backfills their own Inbox",
    backfill.error === null,
    backfill.error?.message,
  );
  eq("…as status new", backfill.data?.[0]?.status, "new");
  eq("…owned by A", backfill.data?.[0]?.user_id, a.id);
  const again = await a.client
    .from("user_postings")
    .upsert([{ posting_id: postingId, watch_profile_id: aProfile!.id }], {
      onConflict: "user_id,posting_id",
      ignoreDuplicates: true,
    })
    .select("id");
  check(
    "a second backfill of the same posting is a no-op",
    again.error === null && again.data?.length === 0,
    again.error?.message,
  );

  const viaB = await a.client
    .from("user_postings")
    .insert({ posting_id: otherPostingId, watch_profile_id: bProfile!.id });
  check(
    "A can't attribute a row to B's watch profile",
    viaB.error !== null,
    viaB.error?.message,
  );
  const forB = await a.client
    .from("user_postings")
    .insert({ posting_id: otherPostingId, user_id: b.id } as never);
  check(
    "A can't insert rows for B (user_id not granted)",
    forB.error !== null,
    forB.error?.message,
  );
  const withReason = await a.client
    .from("user_postings")
    .insert({ posting_id: otherPostingId, skip_reason: "other" } as never);
  check(
    "A can't set a skip reason on insert (column not granted)",
    withReason.error !== null,
    withReason.error?.message,
  );

  const rowId = backfill.data![0].id;
  const { data: bRow } = await admin
    .from("user_postings")
    .insert({ user_id: b.id, posting_id: postingId })
    .select("id")
    .single();

  const readOther = await a.client
    .from("user_postings")
    .select("id")
    .eq("id", bRow!.id);
  eq("A can't read B's user_postings", readOther.data?.length, 0);
  const saveOther = await a.client
    .from("user_postings")
    .update({ status: "skipped" })
    .eq("id", bRow!.id)
    .select("id");
  eq("A's update of B's row touches 0 rows", saveOther.data?.length, 0);

  const skip = await a.client
    .from("user_postings")
    .update({
      status: "skipped",
      skip_reason: "location",
      seen_at: new Date().toISOString(),
    })
    .eq("id", rowId)
    .select("status, skip_reason");
  eq(
    "A can skip their own row with a reason",
    skip.data?.[0]?.skip_reason,
    "location",
  );

  const reasonWithoutSkip = await a.client
    .from("user_postings")
    .update({ status: "saved" })
    .eq("id", rowId);
  check(
    "a skip reason can't outlive the skip (check constraint)",
    reasonWithoutSkip.error !== null,
    reasonWithoutSkip.error?.message,
  );

  const moveUser = await a.client
    .from("user_postings")
    .update({ user_id: b.id } as never)
    .eq("id", rowId);
  check(
    "A can't change user_postings.user_id",
    moveUser.error !== null,
    moveUser.error?.message,
  );
  const movePosting = await a.client
    .from("user_postings")
    .update({ posting_id: otherPostingId } as never)
    .eq("id", rowId);
  check(
    "A can't change user_postings.posting_id",
    movePosting.error !== null,
    movePosting.error?.message,
  );

  const deleteOwn = await a.client
    .from("user_postings")
    .delete()
    .eq("id", rowId)
    .select("id");
  check(
    "A can't delete Inbox rows (skip instead)",
    deleteOwn.error !== null || deleteOwn.data?.length === 0,
    deleteOwn.error?.message,
  );

  const deleteProfile = await a.client
    .from("watch_profiles")
    .delete()
    .eq("id", aProfile!.id)
    .select("id");
  eq("A can delete their own watch profile", deleteProfile.data?.length, 1);
  const { data: kept } = await admin
    .from("user_postings")
    .select("watch_profile_id")
    .eq("id", rowId)
    .single();
  eq("…and its Inbox rows stay, unattributed", kept?.watch_profile_id, null);
}

// ---------------------------------------------------------------- tracker (M3)

async function eventsOf(client: Client, rowId: string) {
  const { data, error } = await client
    .from("status_events")
    .select("id, from_status, to_status, at")
    .eq("user_posting_id", rowId)
    .order("at");
  if (error) throw new Error(`status_events: ${error.message}`);
  return data;
}

async function testTracker(a: TestUser, b: TestUser): Promise<void> {
  console.log("\nTracker: manual rows, status_events, triggers");

  // Manual add / import: A's own row, any tracker status, first event dated
  // at the applied date.
  const imported = await a.client
    .from("user_postings")
    .insert({
      manual: { company: "Lyft", title: null, url: null, location: null },
      status: "rejected",
      applied_at: "2026-09-19",
      term: "Summer 2027",
      resume_note: "Resume v1",
      notes: "First rejection",
    })
    .select("id, user_id, posting_id, status")
    .single();
  check(
    "A adds a manual tracker row",
    imported.error === null,
    imported.error?.message,
  );
  eq("…owned by A", imported.data?.user_id, a.id);
  eq("…with no posting", imported.data?.posting_id, null);
  const manualId = imported.data!.id;
  const first = await eventsOf(a.client, manualId);
  eq("the insert wrote one event", first.length, 1);
  eq(
    "…null → rejected",
    `${first[0]?.from_status} → ${first[0]?.to_status}`,
    "null → rejected",
  );
  eq(
    "…dated at the applied date (noon Chicago)",
    first[0] && new Date(first[0].at).toISOString(),
    "2026-09-19T17:00:00.000Z",
  );

  const noCompany = await a.client
    .from("user_postings")
    .insert({ manual: { company: "  " }, status: "applied" });
  check(
    "a manual row needs a company (check)",
    noCompany.error !== null,
    noCompany.error?.message,
  );
  const manualInbox = await a.client
    .from("user_postings")
    .insert({ manual: { company: "Acme" } });
  check(
    "a manual row can't sit in the Inbox (status new)",
    manualInbox.error !== null,
    manualInbox.error?.message,
  );

  // Trigger: a status change writes exactly one event; other edits none.
  const noteOnly = await a.client
    .from("user_postings")
    .update({ notes: "edited", status_unsure: true, referral: true })
    .eq("id", manualId)
    .select("id");
  eq("A edits tracker fields", noteOnly.data?.length, 1);
  eq(
    "…and that writes no event",
    (await eventsOf(a.client, manualId)).length,
    1,
  );
  await a.client
    .from("user_postings")
    .update({ status: "oa" })
    .eq("id", manualId);
  const afterChange = await eventsOf(a.client, manualId);
  eq("a status change writes exactly one event", afterChange.length, 2);
  eq(
    "…rejected → oa",
    `${afterChange[1]?.from_status} → ${afterChange[1]?.to_status}`,
    "rejected → oa",
  );
  await a.client
    .from("user_postings")
    .update({ status: "oa", notes: "same status" })
    .eq("id", manualId);
  eq(
    "setting the same status again writes none",
    (await eventsOf(a.client, manualId)).length,
    2,
  );

  // Mark applied on a shared posting stamps today's date.
  const postingId = await seedPosting("RLS Tracker Intern");
  const linked = await a.client
    .from("user_postings")
    .insert({ posting_id: postingId, status: "saved" })
    .select("id, applied_at")
    .single();
  eq("a saved row has no applied date", linked.data?.applied_at, null);
  const applied = await a.client
    .from("user_postings")
    .update({ status: "applied" })
    .eq("id", linked.data!.id)
    .select("applied_at")
    .single();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
  }).format(new Date());
  eq("marking applied stamps today (Chicago)", applied.data?.applied_at, today);
  eq(
    "…and logs saved → applied",
    (await eventsOf(a.client, linked.data!.id)).at(-1)?.to_status,
    "applied",
  );

  // status_events: read through the row's owner; nobody writes directly.
  const bReads = await b.client
    .from("status_events")
    .select("id")
    .eq("user_posting_id", manualId);
  eq("B can't read A's status_events", bReads.data?.length, 0);
  const bRow = await b.client
    .from("user_postings")
    .select("id")
    .eq("id", manualId);
  eq("B can't read A's tracker rows", bRow.data?.length, 0);
  const forged = await a.client.from("status_events").insert({
    user_posting_id: manualId,
    from_status: "oa",
    to_status: "offer",
  });
  check(
    "A can't insert status_events directly",
    forged.error !== null,
    forged.error?.message,
  );
  const rewrite = await a.client
    .from("status_events")
    .update({ to_status: "offer" })
    .eq("user_posting_id", manualId)
    .select("id");
  check(
    "A can't rewrite status_events",
    rewrite.error !== null || rewrite.data?.length === 0,
    rewrite.error?.message,
  );
  const erase = await a.client
    .from("status_events")
    .delete()
    .eq("user_posting_id", manualId)
    .select("id");
  check(
    "A can't delete status_events",
    erase.error !== null || erase.data?.length === 0,
    erase.error?.message,
  );

  // Ownership: no writing B's rows, no re-pointing rows.
  const bManual = await b.client
    .from("user_postings")
    .insert({ manual: { company: "B Co" }, status: "applied" })
    .select("id")
    .single();
  const editB = await a.client
    .from("user_postings")
    .update({ notes: "hijacked", status: "offer" })
    .eq("id", bManual.data!.id)
    .select("id");
  eq("A's update of B's tracker row touches 0 rows", editB.data?.length, 0);
  eq(
    "…and B's timeline is untouched",
    (await eventsOf(b.client, bManual.data!.id)).length,
    1,
  );
  const forB = await a.client.from("user_postings").insert({
    manual: { company: "X" },
    status: "applied",
    user_id: b.id,
  } as never);
  check(
    "A can't add tracker rows for B (user_id not granted)",
    forB.error !== null,
    forB.error?.message,
  );
  const repoint = await a.client
    .from("user_postings")
    .update({ posting_id: postingId } as never)
    .eq("id", manualId);
  check(
    "A can't attach a manual row to a posting (posting_id not granted)",
    repoint.error !== null,
    repoint.error?.message,
  );

  // Delete: own manual rows only; their events go with them.
  const deleteB = await a.client
    .from("user_postings")
    .delete()
    .eq("id", bManual.data!.id)
    .select("id");
  eq("A can't delete B's manual row", deleteB.data?.length, 0);
  const deleteLinked = await a.client
    .from("user_postings")
    .delete()
    .eq("id", linked.data!.id)
    .select("id");
  eq("A can't delete a row for a shared posting", deleteLinked.data?.length, 0);
  const deleteOwn = await a.client
    .from("user_postings")
    .delete()
    .eq("id", manualId)
    .select("id");
  eq("A can delete their own manual row", deleteOwn.data?.length, 1);
  const { data: orphans } = await admin
    .from("status_events")
    .select("id")
    .eq("user_posting_id", manualId);
  eq("…and its status_events are gone", orphans?.length, 0);
}

// ---------------------------------------------------------------- follows (M4)

type FollowResult = {
  status: string;
  company_id?: string;
  source_id?: string;
  created_source?: boolean;
};

async function followBoard(
  client: Client,
  kind: string,
  config: Record<string, unknown>,
  name: string,
): Promise<FollowResult> {
  const { data, error } = await client.rpc("follow_board", {
    p_kind: kind,
    p_config: config as never,
    p_company_name: name,
    p_normalized_name: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  });
  if (error) throw new Error(`follow_board: ${error.message}`);
  return data as FollowResult;
}

async function testFollows(
  alice: TestUser,
  a: TestUser,
  b: TestUser,
): Promise<void> {
  console.log("\nfollows + follow_board: own rows, shared sources");

  const now = new Date().toISOString();
  for (const user of [a, b]) {
    await admin
      .from("profiles")
      .update({ invited_at: now })
      .eq("user_id", user.id);
  }
  const outsider = await makeUser("outsider");

  const tag = crypto.randomUUID().slice(0, 8);
  const company = `RLS Test Co Harbor ${tag}`;
  const slug = `rls-harbor-${tag}`;

  // Only invited members follow anything.
  const denied = await followBoard(
    outsider.client,
    "greenhouse",
    { slug },
    company,
  );
  eq(
    "a user who isn't invited can't follow a board",
    denied.status,
    "not_member",
  );
  const deniedCompany = await outsider.client.rpc("follow_company", {
    p_company_id: crypto.randomUUID(),
  });
  eq(
    "…or a company",
    (deniedCompany.data as FollowResult | null)?.status,
    "not_member",
  );

  const anon = createClient<Database>(url, publishableKey, NO_SESSION);
  const anonCall = await anon.rpc("follow_company", {
    p_company_id: crypto.randomUUID(),
  });
  check("signed-out callers can't run follow_company", anonCall.error !== null);

  // First follow creates the company and the hot-tier source.
  const first = await followBoard(a.client, "greenhouse", { slug }, company);
  eq("A follows a new Greenhouse board", first.status, "ok");
  eq("…which creates its source", first.created_source, true);
  const { data: source } = await admin
    .from("sources")
    .select("key, kind, name, tier, enabled, config, company_id")
    .eq("id", first.source_id!)
    .single();
  eq("…keyed by kind and slug", source?.key, `greenhouse:${slug}`);
  eq("…hot tier and enabled", `${source?.tier}/${source?.enabled}`, "hot/true");
  eq("…named for the company", source?.name, `${company} (Greenhouse)`);
  eq("…attached to the company", source?.company_id, first.company_id);

  // A second user following the same board shares the source and company.
  const second = await followBoard(
    b.client,
    "greenhouse",
    { slug: slug.toUpperCase() },
    `  ${company.toUpperCase()}  `,
  );
  eq("B follows the same board", second.status, "ok");
  eq("…without creating another source", second.created_source, false);
  eq("…the same source", second.source_id, first.source_id);
  const { data: sameKey } = await admin
    .from("sources")
    .select("id")
    .eq("key", `greenhouse:${slug}`);
  eq("…one source row for the key", sameKey?.length, 1);

  // Extra keys in the config are not stored.
  const tidy = await followBoard(
    a.client,
    "ashby",
    { slug: `${slug}-a`, company: "Not This", enabled: false, extra: 1 },
    `${company} Ashby`,
  );
  const { data: tidySource } = await admin
    .from("sources")
    .select("config")
    .eq("id", tidy.source_id!)
    .single();
  eq(
    "only slug and company are stored in a source's config",
    JSON.stringify(tidySource?.config),
    JSON.stringify({ slug: `${slug}-a`, company: `${company} Ashby` }),
  );

  const lever = await followBoard(
    a.client,
    "lever",
    { slug: `${slug}-l`, eu: true },
    `${company} Lever`,
  );
  const { data: leverSource } = await admin
    .from("sources")
    .select("key, config")
    .eq("id", lever.source_id!)
    .single();
  eq(
    "an EU Lever board gets its own key",
    leverSource?.key,
    `lever-eu:${slug}-l`,
  );
  eq(
    "…and eu in its config",
    (leverSource?.config as { eu?: boolean }).eu,
    true,
  );

  const workday = await followBoard(
    a.client,
    "workday",
    { tenant: "rlstest", wdNumber: 5, site: "Careers" },
    `${company} Workday`,
  );
  eq("A follows a Workday site", workday.status, "ok");
  const { data: workdaySource } = await admin
    .from("sources")
    .select("key, config")
    .eq("id", workday.source_id!)
    .single();
  eq(
    "…keyed by tenant, site and number",
    workdaySource?.key,
    "workday:rlstest/careers:wd5",
  );
  eq(
    "…with the number stored as a number",
    typeof (workdaySource?.config as { wdNumber?: unknown }).wdNumber,
    "number",
  );

  // Bad input follows nothing and creates nothing.
  const before = (
    await admin.from("sources").select("id", { count: "exact", head: true })
  ).count;
  const bad: [string, string, Record<string, unknown>][] = [
    ["an unknown kind", "taleo", { slug }],
    ["a missing slug", "greenhouse", {}],
    ["a slug with a path in it", "greenhouse", { slug: "a/b" }],
    ["a non-string slug", "lever", { slug: 5 }],
    ["Workday without a site", "workday", { tenant: "x", wdNumber: 1 }],
    ["Workday wd0", "workday", { tenant: "x", wdNumber: 0, site: "y" }],
    [
      "Workday with a string number",
      "workday",
      { tenant: "x", wdNumber: "5", site: "y" },
    ],
  ];
  for (const [label, kind, config] of bad) {
    const result = await followBoard(a.client, kind, config, `${company} Bad`);
    eq(`${label} is invalid`, result.status, "invalid");
  }
  const blankName = await followBoard(
    a.client,
    "greenhouse",
    { slug: `${slug}-n` },
    "   ",
  );
  eq("a blank company name is invalid", blankName.status, "invalid");
  const badNormalized = await a.client.rpc("follow_board", {
    p_kind: "greenhouse",
    p_config: { slug: `${slug}-n` } as never,
    p_company_name: company,
    p_normalized_name: "Not Normalized; drop table",
  });
  eq(
    "a normalized name of the wrong shape is invalid",
    (badNormalized.data as FollowResult | null)?.status,
    "invalid",
  );
  const after = (
    await admin.from("sources").select("id", { count: "exact", head: true })
  ).count;
  eq("…and none of them created a source", after, before);

  // follow_company: an existing company, no board.
  const existing = await seedPosting("Follow target");
  const { data: target } = await admin
    .from("postings")
    .select("company_id")
    .eq("id", existing)
    .single();
  const plain = await a.client.rpc("follow_company", {
    p_company_id: target!.company_id,
  });
  eq(
    "A follows an existing company",
    (plain.data as FollowResult).status,
    "ok",
  );
  const missing = await a.client.rpc("follow_company", {
    p_company_id: crypto.randomUUID(),
  });
  eq(
    "a company that doesn't exist is not_found",
    (missing.data as FollowResult).status,
    "not_found",
  );

  // RLS on the rows themselves.
  const mine = await a.client
    .from("follows")
    .select("company_id, priority, board_kind, board_ref");
  eq("A sees only their own follows", mine.data?.length, 5);
  const bobs = await b.client.from("follows").select("user_id, company_id");
  eq("B sees only their own follow", bobs.data?.length, 1);
  eq("…and it's B's", bobs.data?.[0]?.user_id, b.id);
  const aBoard = mine.data?.find((f) => f.company_id === first.company_id);
  eq("a follow remembers its board kind", aBoard?.board_kind, "greenhouse");
  eq("…and ref", aBoard?.board_ref, slug);
  eq("priority starts off", aBoard?.priority, false);

  const insertDirect = await a.client
    .from("follows")
    .insert({ company_id: target!.company_id } as never);
  check(
    "A can't insert into follows directly (only through the functions)",
    insertDirect.error !== null,
    insertDirect.error?.message,
  );
  const forged = await a.client.rpc("follow_company", {
    p_company_id: target!.company_id,
  });
  check(
    "…and the function can't be pointed at another user",
    forged.error === null,
  );

  const flip = await a.client
    .from("follows")
    .update({ priority: true })
    .eq("company_id", first.company_id!)
    .select("priority");
  eq(
    "A turns on priority for their own follow",
    flip.data?.[0]?.priority,
    true,
  );
  const flipB = await a.client
    .from("follows")
    .update({ priority: true })
    .eq("user_id", b.id)
    .select("priority");
  eq("A can't change B's follow", flipB.data?.length, 0);
  const retag = await a.client
    .from("follows")
    .update({ board_kind: "lever" })
    .eq("company_id", first.company_id!);
  check(
    "A can't edit board_kind by hand (column not granted)",
    retag.error !== null,
    retag.error?.message,
  );
  const steal = await a.client
    .from("follows")
    .update({ user_id: b.id } as never)
    .eq("company_id", first.company_id!);
  check(
    "A can't hand a follow to B (user_id not granted)",
    steal.error !== null,
  );

  const sourcesVisible = await a.client.from("sources").select("id");
  eq(
    "members still can't read the sources table",
    sourcesVisible.data?.length,
    0,
  );
  const adminSources = await alice.client
    .from("sources")
    .select("id")
    .eq("key", `greenhouse:${slug}`);
  eq("admins can", adminSources.data?.length, 1);

  const deleteB = await a.client
    .from("follows")
    .delete()
    .eq("user_id", b.id)
    .select("user_id");
  eq("A can't unfollow for B", deleteB.data?.length, 0);
  const unfollow = await a.client
    .from("follows")
    .delete()
    .eq("company_id", first.company_id!)
    .select("company_id");
  eq("A can unfollow their own", unfollow.data?.length, 1);
  const stillThere = await admin
    .from("sources")
    .select("id")
    .eq("key", `greenhouse:${slug}`);
  eq(
    "…and the shared source stays (B still follows it)",
    stillThere.data?.length,
    1,
  );

  // The cap, with B topped up to the limit by the service role.
  const { data: limit } = await b.client.rpc("max_follows");
  const cap = Number(limit);
  const capCompanies = Array.from({ length: cap }, (_, i) => ({
    name: `RLS Test Co cap ${tag} ${i}`,
    normalized_name: `rls test co cap ${tag} ${i}`,
  }));
  const { data: made } = await admin
    .from("companies")
    .insert(capCompanies)
    .select("id");
  const { count: bHas } = await admin
    .from("follows")
    .select("company_id", { count: "exact", head: true })
    .eq("user_id", b.id);
  const fill = (made ?? []).slice(0, cap - (bHas ?? 0)).map((c) => ({
    user_id: b.id,
    company_id: c.id,
  }));
  await admin.from("follows").insert(fill);
  const over = await b.client.rpc("follow_company", {
    p_company_id: made![made!.length - 1].id,
  });
  eq(
    `B at ${cap} follows can't add another`,
    (over.data as FollowResult).status,
    "limit",
  );
  const overBoard = await followBoard(
    b.client,
    "greenhouse",
    { slug: `${slug}-over` },
    `${company} Over`,
  );
  eq("…nor a new board", overBoard.status, "limit");
  const refollow = await followBoard(b.client, "greenhouse", { slug }, company);
  eq("…but can re-follow one they already have", refollow.status, "ok");
}

// ---------------------------------------------------------------- review + notifications (M5)

async function testResumesAndStorage(a: TestUser, b: TestUser): Promise<void> {
  console.log("\nresumes + the uploads bucket: own folder only");

  const pdf = () =>
    new Blob(["%PDF-1.4 rls test"], { type: "application/pdf" });
  const aPath = `${a.id}/resume.pdf`;

  const created = await a.client.from("resumes").insert({
    kind: "uploaded_pdf",
    file_path: aPath,
    file_name: "Alex.pdf",
    text_content: "python java sql",
  });
  eq("A saves their resume row", created.error, null);

  const bSees = await b.client.from("resumes").select("user_id");
  eq("B sees no resume rows", bSees.data?.length, 0);

  const stolen = await b.client
    .from("resumes")
    .insert({ kind: "uploaded_pdf", file_path: aPath, user_id: a.id } as never);
  check(
    "B can't write a row for A (user_id isn't granted)",
    stolen.error !== null,
  );

  const hijack = await b.client
    .from("resumes")
    .update({ file_name: "Evil.pdf" })
    .eq("user_id", a.id)
    .select("user_id");
  eq("B can't update A's resume row", hijack.data?.length ?? 0, 0);
  const erase = await b.client
    .from("resumes")
    .delete()
    .eq("user_id", a.id)
    .select("user_id");
  eq("B can't delete A's resume row", erase.data?.length ?? 0, 0);
  const still = await admin
    .from("resumes")
    .select("file_name")
    .eq("user_id", a.id)
    .single();
  eq("…A's row is untouched", still.data?.file_name, "Alex.pdf");

  const noFile = await b.client
    .from("resumes")
    .insert({ kind: "uploaded_pdf" });
  check("an uploaded_pdf row needs a file path", noFile.error !== null);

  // Storage: the bucket policies, not just the table's.
  const upload = await a.client.storage.from("uploads").upload(aPath, pdf(), {
    contentType: "application/pdf",
    upsert: true,
  });
  eq("A uploads to their own folder", upload.error, null);

  const bRead = await b.client.storage.from("uploads").download(aPath);
  check("B can't download A's file", bRead.error !== null);
  const bSigned = await b.client.storage
    .from("uploads")
    .createSignedUrl(aPath, 60);
  check("B can't get a signed link to A's file", bSigned.error !== null);
  const bWrite = await b.client.storage
    .from("uploads")
    .upload(`${a.id}/planted.pdf`, pdf(), { contentType: "application/pdf" });
  check("B can't add a file to A's folder", bWrite.error !== null);
  const bOverwrite = await b.client.storage
    .from("uploads")
    .upload(aPath, pdf(), { contentType: "application/pdf", upsert: true });
  check("B can't overwrite A's resume", bOverwrite.error !== null);
  await b.client.storage.from("uploads").remove([aPath]);
  const afterRemove = await admin.storage.from("uploads").download(aPath);
  eq("…and B's delete didn't remove it", afterRemove.error, null);

  const anon = createClient<Database>(url, publishableKey, NO_SESSION);
  const anonRead = await anon.storage.from("uploads").download(aPath);
  check("a signed-out visitor can't download it", anonRead.error !== null);

  const aSigned = await a.client.storage
    .from("uploads")
    .createSignedUrl(aPath, 60);
  eq("A gets a signed link to their own file", aSigned.error, null);

  const notPdf = await a.client.storage
    .from("uploads")
    .upload(`${a.id}/note.txt`, new Blob(["hello"], { type: "text/plain" }), {
      contentType: "text/plain",
    });
  check("the bucket only takes PDFs", notPdf.error !== null);
  const tooBig = await a.client.storage
    .from("uploads")
    .upload(
      `${a.id}/big.pdf`,
      new Blob([new Uint8Array(4_300_000)], { type: "application/pdf" }),
      {
        contentType: "application/pdf",
      },
    );
  check("…and nothing over 4 MB", tooBig.error !== null);

  await admin.storage.from("uploads").remove([aPath]);
  await admin.from("resumes").delete().eq("user_id", a.id);
}

async function testStandardAnswers(a: TestUser, b: TestUser): Promise<void> {
  console.log("\nprofiles: phone, standard answers, notification prefs");

  const saved = await a.client
    .from("profiles")
    .update({
      phone: "555-0100",
      standard_answers: {
        linkedin: "https://linkedin.com/in/a",
        howHeard: "Friend",
      },
      notify_prefs: { email: false },
    })
    .eq("user_id", a.id)
    .select("phone");
  eq(
    "A edits their phone, answers, and prefs",
    saved.data?.[0]?.phone,
    "555-0100",
  );

  const others = await b.client
    .from("profiles")
    .update({ phone: "000" })
    .eq("user_id", a.id)
    .select("user_id");
  eq("B can't edit A's profile", others.data?.length ?? 0, 0);

  const huge = await a.client
    .from("profiles")
    .update({ standard_answers: { notes: "x".repeat(9000) } })
    .eq("user_id", a.id);
  check("standard answers are capped in size", huge.error !== null);
  const notObject = await a.client
    .from("profiles")
    .update({ standard_answers: [1, 2] as never })
    .eq("user_id", a.id);
  check("…and must be an object", notObject.error !== null);
}

async function testPostingQuestions(a: TestUser, b: TestUser): Promise<void> {
  console.log("\npostings.questions: one narrow door");

  const outsider = await makeUser("outsider2");
  const questions = [
    { label: "Email", required: true, input: "text", options: [] },
    { label: "Why us?", required: true, input: "textarea", options: [] },
  ];
  const save = (client: Client, id: string, status: string, q: unknown) =>
    client.rpc("save_posting_questions", {
      p_posting_id: id,
      p_status: status,
      p_questions: q as never,
    });

  const posting = await seedPosting("Questions Intern");
  eq(
    "a user who isn't invited can't cache questions",
    (await save(outsider.client, posting, "ok", questions)).data,
    "not_member",
  );
  eq(
    "a member caches them",
    (await save(a.client, posting, "ok", questions)).data,
    "saved",
  );
  eq(
    "a second fetch doesn't overwrite the cache",
    (await save(b.client, posting, "ok", [{ label: "Other" }])).data,
    "skipped",
  );
  const read = await b.client
    .from("postings")
    .select("questions, questions_status")
    .eq("id", posting)
    .single();
  eq("every member reads the cached status", read.data?.questions_status, "ok");
  eq(
    "…and the questions",
    (read.data?.questions as { label: string }[])[1].label,
    "Why us?",
  );

  const direct = await a.client
    .from("postings")
    .update({ questions: [] })
    .eq("id", posting)
    .select("id");
  check(
    "members can't write postings directly",
    (direct.data?.length ?? 0) === 0,
  );

  const bad = await seedPosting("Bad Questions Intern");
  eq(
    "not-an-array is invalid",
    (await save(a.client, bad, "ok", { label: "x" })).data,
    "invalid",
  );
  eq(
    "an item without a label is invalid",
    (await save(a.client, bad, "ok", [{ required: true }])).data,
    "invalid",
  );
  eq(
    "an enormous list is invalid",
    (
      await save(
        a.client,
        bad,
        "ok",
        Array.from({ length: 151 }, () => ({ label: "q" })),
      )
    ).data,
    "invalid",
  );
  eq(
    "an unknown status is invalid",
    (await save(a.client, bad, "weird", [])).data,
    "invalid",
  );
  const badRow = await admin
    .from("postings")
    .select("questions_status")
    .eq("id", bad)
    .single();
  eq("…and none of those cached anything", badRow.data?.questions_status, null);

  // A failure is retried after a short wait; a success after a week.
  const flaky = await seedPosting("Flaky Questions Intern");
  eq(
    "a failed fetch is recorded",
    (await save(a.client, flaky, "failed", null)).data,
    "saved",
  );
  eq(
    "…and not overwritten straight away",
    (await save(b.client, flaky, "ok", questions)).data,
    "skipped",
  );
  await admin
    .from("postings")
    .update({
      questions_fetched_at: new Date(Date.now() - 11 * 60_000).toISOString(),
    })
    .eq("id", flaky);
  eq(
    "…but may be after ten minutes",
    (await save(b.client, flaky, "ok", questions)).data,
    "saved",
  );
  await admin
    .from("postings")
    .update({
      questions_fetched_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    })
    .eq("id", flaky);
  eq(
    "a success holds for a week",
    (await save(a.client, flaky, "unknown", null)).data,
    "skipped",
  );
  await admin
    .from("postings")
    .update({
      questions_fetched_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    })
    .eq("id", flaky);
  eq(
    "…then may be refreshed",
    (await save(a.client, flaky, "unknown", null)).data,
    "saved",
  );

  // posting_boards: the public boards behind a posting, members only.
  const { data: boardPosting } = await admin
    .from("postings")
    .select("company_id")
    .eq("id", posting)
    .single();
  const boardKey = `greenhouse:rls-board-${crypto.randomUUID().slice(0, 8)}`;
  const { data: boardSource, error: sourceError } = await admin
    .from("sources")
    .insert({
      key: boardKey,
      kind: "greenhouse",
      name: "RLS Board",
      config: { slug: "RlsBoard", company: "RLS Test Co" },
      company_id: boardPosting!.company_id,
    })
    .select("id")
    .single();
  if (sourceError) throw new Error(`seed source: ${sourceError.message}`);
  await admin.from("posting_sources").insert({
    posting_id: posting,
    source_id: boardSource!.id,
    source_job_id: "1",
    data: {},
    raw: {},
    content_hash: "rls",
  });
  const boards = await a.client.rpc("posting_boards", {
    p_posting_id: posting,
  });
  eq(
    "a member learns the boards behind a posting",
    JSON.stringify(boards.data),
    JSON.stringify([{ eu: false, kind: "greenhouse", slug: "RlsBoard" }]),
  );
  const outsiderBoards = await outsider.client.rpc("posting_boards", {
    p_posting_id: posting,
  });
  eq("…an outsider gets none", JSON.stringify(outsiderBoards.data), "[]");

  const anon = createClient<Database>(url, publishableKey, NO_SESSION);
  const anonCall = await anon.rpc("save_posting_questions", {
    p_posting_id: posting,
    p_status: "ok",
    p_questions: [] as never,
  });
  check("signed-out callers can't run it", anonCall.error !== null);

  // The user's own pasted questions live on their user_postings row.
  const { data: row } = await admin
    .from("user_postings")
    .insert({ user_id: a.id, posting_id: posting })
    .select("id")
    .single();
  const rowId = row!.id;
  const paste = await a.client
    .from("user_postings")
    .update({ answer_sheet: { pastedQuestions: "1. Why us?" } })
    .eq("id", rowId)
    .select("answer_sheet");
  eq(
    "A saves pasted questions on their row",
    (paste.data?.[0]?.answer_sheet as { pastedQuestions: string })
      ?.pastedQuestions,
    "1. Why us?",
  );
  const peek = await b.client
    .from("user_postings")
    .select("answer_sheet")
    .eq("id", rowId);
  eq("B can't read them", peek.data?.length, 0);
  const tamper = await b.client
    .from("user_postings")
    .update({ answer_sheet: { pastedQuestions: "x" } })
    .eq("id", rowId)
    .select("id");
  eq("…or change them", tamper.data?.length ?? 0, 0);
  const arrayish = await a.client
    .from("user_postings")
    .update({ answer_sheet: [1] as never })
    .eq("id", rowId);
  check("the answer sheet must be an object", arrayish.error !== null);
  const bigSheet = await a.client
    .from("user_postings")
    .update({ answer_sheet: { pastedQuestions: "x".repeat(41000) } })
    .eq("id", rowId);
  check("…and under 40 KB", bigSheet.error !== null);
}

async function testPushAndNotifications(
  a: TestUser,
  b: TestUser,
): Promise<void> {
  console.log("\npush_subscriptions + notifications");

  const outsider = await makeUser("outsider3");
  const keys = { p256dh: "BPublicKeyForTests", auth: "authSecret" };
  const save = (client: Client, endpoint: string, k: unknown = keys) =>
    client.rpc("save_push_subscription", {
      p_endpoint: endpoint,
      p_keys: k as never,
      p_user_agent: "rls-test",
    });
  const endpoint = `https://push.example.com/send/${crypto.randomUUID()}`;

  eq(
    "a user who isn't invited can't subscribe",
    (await save(outsider.client, endpoint)).data,
    "not_member",
  );
  eq("A subscribes a device", (await save(a.client, endpoint)).data, "ok");
  eq(
    "A sees it",
    (await a.client.from("push_subscriptions").select("id")).data?.length,
    1,
  );
  eq(
    "B sees none",
    (await b.client.from("push_subscriptions").select("id")).data?.length,
    0,
  );

  const direct = await a.client.from("push_subscriptions").insert({
    endpoint: `https://push.example.com/${crypto.randomUUID()}`,
    keys,
  });
  check("there's no direct insert", direct.error !== null);

  eq(
    "B signs in on the same browser",
    (await save(b.client, endpoint)).data,
    "ok",
  );
  eq(
    "…the device moves to B",
    (await b.client.from("push_subscriptions").select("id")).data?.length,
    1,
  );
  eq(
    "…and A no longer has it",
    (await a.client.from("push_subscriptions").select("id")).data?.length,
    0,
  );

  const aDelete = await a.client
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .select("id");
  eq("A can't delete B's device", aDelete.data?.length ?? 0, 0);
  const bDelete = await b.client
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .select("id");
  eq("B can delete their own", bDelete.data?.length, 1);

  eq(
    "an http:// endpoint is invalid",
    (await save(a.client, "http://push.example.com/x")).data,
    "invalid",
  );
  eq(
    "keys without p256dh are invalid",
    (await save(a.client, endpoint, { auth: "x" })).data,
    "invalid",
  );

  for (let i = 0; i < 10; i += 1) {
    await save(
      a.client,
      `https://push.example.com/device/${crypto.randomUUID()}`,
    );
  }
  eq(
    "a user can have ten devices, not eleven",
    (
      await save(
        a.client,
        `https://push.example.com/device/${crypto.randomUUID()}`,
      )
    ).data,
    "limit",
  );
  await admin.from("push_subscriptions").delete().eq("user_id", a.id);

  const anon = createClient<Database>(url, publishableKey, NO_SESSION);
  check(
    "signed-out callers can't subscribe",
    (await save(anon, endpoint)).error !== null,
  );

  // notifications: the worker's ledger. Users get nothing from it.
  const { data: run } = await admin
    .from("runs")
    .insert({ trigger: "rls-test" })
    .select("id")
    .single();
  const note = {
    user_id: a.id,
    run_id: run!.id,
    channel: "push",
    payload: { count: 2 },
  };
  eq(
    "the worker records a digest",
    (await admin.from("notifications").insert(note)).error,
    null,
  );
  check(
    "…once per user, run, and channel",
    (await admin.from("notifications").insert(note)).error !== null,
  );
  eq(
    "…email is a separate channel",
    (await admin.from("notifications").insert({ ...note, channel: "email" }))
      .error,
    null,
  );
  const read = await a.client.from("notifications").select("id");
  check(
    "users can't read notifications",
    read.error !== null || (read.data?.length ?? 0) === 0,
  );
  const write = await a.client.from("notifications").insert(note);
  check("…or write them", write.error !== null);
  await admin.from("runs").delete().eq("id", run!.id);
}

// ---------------------------------------------------------------- AI foundation (M6)

/** A stand-in encrypted key: the database never sees anything else. */
function sealedRow(userId: string, provider: "anthropic" | "openai") {
  return {
    user_id: userId,
    provider,
    ciphertext: Buffer.from(`sealed-${userId}`).toString("base64"),
    iv: Buffer.alloc(12, 7).toString("base64"),
    last4: "7f3a",
  };
}

async function testApiKeys(a: TestUser, b: TestUser): Promise<void> {
  console.log(
    "\napi_keys: the secret columns can't be read by anyone signed in",
  );

  const direct = await a.client
    .from("api_keys")
    .insert(sealedRow(a.id, "anthropic"));
  check(
    "A can't insert a key row (only the server writes keys)",
    direct.error !== null,
  );

  const seeded = await admin
    .from("api_keys")
    .insert(sealedRow(a.id, "anthropic"));
  eq("the service role stores A's sealed key", seeded.error, null);

  for (const column of ["ciphertext", "iv", "*", "user_id, ciphertext"]) {
    const res = await a.client.from("api_keys").select(column);
    check(
      `A can't select ${column} from their own key`,
      res.error !== null && (res.data ?? []).length === 0,
      { error: res.error?.message, rows: res.data?.length },
    );
  }
  const filtered = await a.client
    .from("api_keys")
    .select("last4")
    .like("ciphertext", "c2Vh%");
  check(
    "A can't filter on ciphertext either (no guessing it a prefix at a time)",
    filtered.error !== null,
    filtered.error?.message,
  );
  const ordered = await a.client.from("api_keys").select("last4").order("iv");
  check("…or sort by iv", ordered.error !== null, ordered.error?.message);

  const own = await a.client.from("api_keys").select("provider, last4");
  eq("A reads their own provider", own.data?.[0]?.provider, "anthropic");
  eq("…and last4", own.data?.[0]?.last4, "7f3a");

  const view = await a.client.from("api_keys_public").select("*");
  eq("api_keys_public shows A one row", view.data?.length, 1);
  eq(
    "…with only user_id, provider, last4, created_at",
    Object.keys(view.data?.[0] ?? {})
      .sort()
      .join(","),
    "created_at,last4,provider,user_id",
  );

  const bTable = await b.client.from("api_keys").select("last4");
  eq("B sees no key rows", bTable.data?.length ?? 0, 0);
  const bView = await b.client.from("api_keys_public").select("last4");
  eq("B sees nothing in api_keys_public", bView.data?.length ?? 0, 0);

  const anon = createClient<Database>(url, publishableKey, NO_SESSION);
  const anonTable = await anon.from("api_keys").select("ciphertext");
  check(
    "a signed-out visitor can't read ciphertext",
    anonTable.error !== null && (anonTable.data ?? []).length === 0,
  );
  const anonView = await anon.from("api_keys_public").select("last4");
  check(
    "…or the public view",
    anonView.error !== null || (anonView.data ?? []).length === 0,
  );

  const rewrite = await a.client
    .from("api_keys")
    .update({ last4: "0000" })
    .eq("user_id", a.id)
    .select("user_id");
  check("A can't edit their key row", rewrite.error !== null);
  const bDelete = await b.client
    .from("api_keys")
    .delete()
    .eq("user_id", a.id)
    .select("user_id");
  eq("B can't delete A's key", bDelete.data?.length ?? 0, 0);

  const tooShort = await admin
    .from("api_keys")
    .insert({ ...sealedRow(b.id, "openai"), iv: "short" });
  check("the nonce must be 12 bytes", tooShort.error !== null);
}

async function testAiMode(a: TestUser, b: TestUser): Promise<void> {
  console.log("\nprofiles: AI mode needs a key, and removing the key ends it");

  const noKey = await b.client
    .from("profiles")
    .update({ mode: "ai" })
    .eq("user_id", b.id);
  check("B can't turn on AI mode without a key", noKey.error !== null);

  const provider = await a.client
    .from("profiles")
    .update({ ai_provider: "openai" })
    .eq("user_id", a.id);
  check(
    "ai_provider isn't user-editable (it follows the key)",
    provider.error !== null,
  );

  const on = await a.client
    .from("profiles")
    .update({ mode: "ai", daily_cap: 25, auto_tailor: true })
    .eq("user_id", a.id)
    .select("mode, daily_cap, auto_tailor");
  eq("A (who has a key) turns on AI mode", on.data?.[0]?.mode, "ai");
  eq("…and sets a daily cap", on.data?.[0]?.daily_cap, 25);

  const cap = await a.client
    .from("profiles")
    .update({ daily_cap: 1000 })
    .eq("user_id", a.id);
  check("the daily cap stays within 0–100", cap.error !== null);

  const removed = await a.client
    .from("api_keys")
    .delete()
    .eq("user_id", a.id)
    .select("user_id");
  eq("A removes their key", removed.data?.length, 1);
  const after = await admin
    .from("profiles")
    .select("mode, ai_provider")
    .eq("user_id", a.id)
    .single();
  eq("…which puts them back in Simple mode", after.data?.mode, "simple");
  eq("…and clears ai_provider", after.data?.ai_provider, null);
}

async function testStructuredResume(a: TestUser, b: TestUser): Promise<void> {
  console.log("\nresumes.content: the structured resume");

  const content = {
    header: { name: "A", email: "", phone: "", links: [] },
    sections: [{ title: "Research", layout: "text", text: "Lab work." }],
  };
  const saved = await a.client
    .from("resumes")
    .insert({ kind: "structured", content });
  eq("A saves a structured resume", saved.error, null);
  const bRead = await b.client.from("resumes").select("content");
  eq("B can't read it", bRead.data?.length ?? 0, 0);
  const empty = await b.client.from("resumes").insert({ kind: "structured" });
  check("a structured resume needs content", empty.error !== null);
  const huge = await a.client
    .from("resumes")
    .update({ content: { blob: "x".repeat(120_000) } })
    .eq("user_id", a.id);
  check("content is capped in size", huge.error !== null);
  await admin.from("resumes").delete().eq("user_id", a.id);
}

async function testFactBank(a: TestUser, b: TestUser): Promise<void> {
  console.log("\nfact_bank: own rows only");

  const added = await a.client
    .from("fact_bank")
    .insert({ kind: "skill", content: { text: "Rust" } })
    .select("id, source")
    .single();
  eq("A adds a fact", added.error, null);
  eq("…marked manual by default", added.data?.source, "manual");
  const id = added.data?.id ?? "";

  const bSees = await b.client.from("fact_bank").select("id");
  eq("B sees none of A's facts", bSees.data?.length ?? 0, 0);
  const bEdit = await b.client
    .from("fact_bank")
    .update({ content: { text: "COBOL" } })
    .eq("id", id)
    .select("id");
  eq("B can't edit A's fact", bEdit.data?.length ?? 0, 0);
  const bDelete = await b.client
    .from("fact_bank")
    .delete()
    .eq("id", id)
    .select("id");
  eq("B can't delete A's fact", bDelete.data?.length ?? 0, 0);
  const planted = await b.client
    .from("fact_bank")
    .insert({ kind: "skill", content: { text: "x" }, user_id: a.id } as never);
  check("B can't add a fact for A", planted.error !== null);

  const badKind = await a.client
    .from("fact_bank")
    .insert({ kind: "hobby", content: { text: "x" } });
  check("kind must be one of the six", badKind.error !== null);
  const notObject = await a.client
    .from("fact_bank")
    .insert({ kind: "skill", content: ["x"] as never });
  check("content must be an object", notObject.error !== null);

  const filler = Array.from({ length: 199 }, (_, i) => ({
    user_id: a.id,
    kind: "other",
    content: { text: `fact ${i}` },
  }));
  await admin.from("fact_bank").insert(filler);
  const over = await a.client
    .from("fact_bank")
    .insert({ kind: "skill", content: { text: "one too many" } });
  check("at most 200 facts per person", over.error !== null);
  await admin.from("fact_bank").delete().eq("user_id", a.id);
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
    await testWatcherTables(alice, a);
    await testInbox(a, b);
    await testTracker(a, b);
    await testFollows(alice, a, b);
    await testResumesAndStorage(a, b);
    await testStandardAnswers(a, b);
    await testPostingQuestions(a, b);
    await testPushAndNotifications(a, b);
    await testApiKeys(a, b);
    await testAiMode(a, b);
    await testStructuredResume(a, b);
    await testFactBank(a, b);
  } finally {
    await deleteSeededPostings();
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
