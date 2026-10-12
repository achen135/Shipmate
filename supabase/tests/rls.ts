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
