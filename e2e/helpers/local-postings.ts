import { createClient } from "@supabase/supabase-js";

import { localSupabaseAvailable } from "./local-auth";

/**
 * Seed postings straight into the LOCAL database for Inbox E2E (what the
 * worker would have written). Every title carries a per-run suffix so tests
 * can find their own rows among anything else in the local stack.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function admin() {
  if (!localSupabaseAvailable) {
    throw new Error(`Refusing to seed postings against ${url || "<unset>"}.`);
  }
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SeedPosting = {
  title: string;
  category: string | null;
  daysAgo: number;
  status?: "open" | "closed";
  terms?: string[];
  locations?: string[];
  /** Defaults to a unique example.com link. */
  url?: string;
  description?: string;
  sponsorship?: "unknown" | "offers" | "no_sponsorship" | "citizens_only";
  degrees?: string[];
};

const companyIds: string[] = [];

/** Insert postings for a new company; returns their ids in order. */
export async function seedPostings(
  company: string,
  postings: SeedPosting[],
): Promise<string[]> {
  const db = admin();
  const { data: row, error } = await db
    .from("companies")
    .insert({ name: company, normalized_name: company.toLowerCase() })
    .select("id")
    .single();
  if (error) throw new Error(`seed company: ${error.message}`);
  companyIds.push(row.id);

  const rows = postings.map((p, i) => {
    const slug = `${company}-${i}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const link = p.url ?? `https://example.com/jobs/${slug}`;
    return {
      company_id: row.id,
      title: p.title,
      url: link,
      canonical_url: link,
      category: p.category,
      terms: p.terms ?? ["Summer 2027"],
      locations: p.locations ?? ["NYC"],
      posted_at: new Date(Date.now() - p.daysAgo * 86_400_000).toISOString(),
      source_names: ["E2E fixture"],
      content_hash: slug,
      status: p.status ?? "open",
      description: p.description ?? null,
      sponsorship: p.sponsorship ?? "unknown",
      degrees: p.degrees ?? [],
    };
  });
  const { data: inserted, error: postingsError } = await db
    .from("postings")
    .insert(rows)
    .select("id");
  if (postingsError) throw new Error(`seed postings: ${postingsError.message}`);
  return inserted.map((p) => p.id as string);
}

/**
 * Mark a user invited with Basics done, as if steps 1-2 already happened.
 * They land on step 3 (resume and mode).
 */
export async function finishBasics(
  userId: string,
  needsSponsorship = false,
): Promise<void> {
  const { error } = await admin()
    .from("profiles")
    .update({
      invited_at: new Date().toISOString(),
      onboarding_step: 3,
      name: "Inbox Tester",
      needs_sponsorship: needsSponsorship,
    })
    .eq("user_id", userId);
  if (error) throw new Error(`finish basics: ${error.message}`);
}

/** Invited, Basics and What to watch done: a member with an empty Inbox. */
export async function finishOnboarding(userId: string): Promise<void> {
  await finishBasics(userId);
  const { error } = await admin()
    .from("profiles")
    .update({ onboarding_step: 6 })
    .eq("user_id", userId);
  if (error) throw new Error(`finish onboarding: ${error.message}`);
}

/** Simple or AI mode (new accounts start in AI mode since M7). */
export async function setMode(
  userId: string,
  mode: "simple" | "ai",
): Promise<void> {
  const { error } = await admin()
    .from("profiles")
    .update({ mode })
    .eq("user_id", userId);
  if (error) throw new Error(`set mode: ${error.message}`);
}

/** A "software" watch profile, as if picked in onboarding. */
export async function addSoftwareWatchProfile(userId: string): Promise<void> {
  const { error } = await admin()
    .from("watch_profiles")
    .insert({
      user_id: userId,
      name: "SWE",
      preset: "swe",
      categories: ["Software"],
      include_keywords: ["software"],
      terms: ["Summer 2027"],
    });
  if (error) throw new Error(`watch profile: ${error.message}`);
}

/**
 * A software watch profile that only matches jobs in `place`. The mock
 * Greenhouse board puts its slug in its jobs' location, so a profile for that
 * slug matches that board's jobs and nothing another test's worker creates.
 */
export async function addWatchProfileForPlace(
  userId: string,
  place: string,
): Promise<void> {
  const { error } = await admin()
    .from("watch_profiles")
    .insert({
      user_id: userId,
      name: "SWE here",
      preset: "swe",
      categories: ["Software"],
      include_keywords: ["software"],
      terms: ["Summer 2027"],
      locations: [place],
      remote_ok: false,
    });
  if (error) throw new Error(`watch profile: ${error.message}`);
}

/**
 * Delete the companies a test created by following, by exact name: their
 * postings first, then the company, which takes its sources and follows with
 * it. Exact names, not a prefix: the mobile and desktop projects run the same
 * spec in parallel, and a prefix match would delete the other project's
 * company in the middle of its test.
 */
export async function deleteCompaniesNamed(names: string[]): Promise<void> {
  if (names.length === 0) return;
  const db = admin();
  const { data } = await db.from("companies").select("id").in("name", names);
  for (const { id } of data ?? []) {
    await db.from("postings").delete().eq("company_id", id);
    await db.from("companies").delete().eq("id", id);
  }
}

/** Fill in the profile fields the review page's warnings read. */
export async function setProfile(
  userId: string,
  fields: {
    school?: string;
    degree?: "associate" | "bachelors" | "masters" | "phd" | "other";
    major?: string;
    grad_month?: number;
    grad_year?: number;
    needs_sponsorship?: boolean;
    work_authorized?: boolean;
  },
): Promise<void> {
  const { error } = await admin()
    .from("profiles")
    .update(fields)
    .eq("user_id", userId);
  if (error) throw new Error(`set profile: ${error.message}`);
}

/** An application already in a user's Tracker (a row for a seeded posting). */
export async function addApplied(
  userId: string,
  postingId: string,
  appliedAt: string,
  status: "applied" | "rejected" = "applied",
): Promise<void> {
  const { error } = await admin().from("user_postings").insert({
    user_id: userId,
    posting_id: postingId,
    status,
    applied_at: appliedAt,
  });
  if (error) throw new Error(`tracker row: ${error.message}`);
}

/** Put a posting in a user's Inbox, as the worker's matching would. */
export async function addToInbox(
  userId: string,
  postingId: string,
): Promise<void> {
  const { error } = await admin()
    .from("user_postings")
    .insert({ user_id: userId, posting_id: postingId });
  if (error) throw new Error(`inbox row: ${error.message}`);
}

/** Delete seeded companies (their postings and inbox rows cascade). */
export async function deleteSeededPostings(): Promise<void> {
  const db = admin();
  for (const id of companyIds.splice(0)) {
    await db.from("postings").delete().eq("company_id", id);
    await db.from("companies").delete().eq("id", id);
  }
}

/**
 * Follow a company's Greenhouse board as if the user had pasted its careers
 * link (company + hot-tier source + follow), without the UI. Returns the
 * source key the worker takes in WATCH_SOURCES.
 */
export async function addBoardFollow(
  userId: string,
  slug: string,
  company: string,
  priority = false,
): Promise<string> {
  const db = admin();
  const { data: row, error } = await db
    .from("companies")
    .insert({ name: company, normalized_name: company.toLowerCase() })
    .select("id")
    .single();
  if (error) throw new Error(`board company: ${error.message}`);
  companyIds.push(row.id);
  const key = `greenhouse:${slug}`;
  const { error: sourceError } = await db.from("sources").insert({
    key,
    kind: "greenhouse",
    name: `${company} (Greenhouse)`,
    config: { slug, company },
    company_id: row.id,
    tier: "hot",
  });
  if (sourceError) throw new Error(`board source: ${sourceError.message}`);
  const { error: followError } = await db.from("follows").insert({
    user_id: userId,
    company_id: row.id,
    board_kind: "greenhouse",
    board_ref: slug,
    priority,
  });
  if (followError) throw new Error(`follow: ${followError.message}`);
  return key;
}

/** Say when the user joined (the email fallback waits a day after this). */
export async function setMemberSince(
  userId: string,
  when: Date,
): Promise<void> {
  const { error } = await admin()
    .from("profiles")
    .update({ invited_at: when.toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(`member since: ${error.message}`);
}

/** A device's push subscription, as the browser would have registered it. */
export async function addPushSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  const { error } = await admin()
    .from("push_subscriptions")
    .insert({
      user_id: userId,
      endpoint,
      keys: { p256dh: "e2e-p256dh", auth: "e2e-auth" },
      user_agent: "e2e",
    });
  if (error) throw new Error(`push subscription: ${error.message}`);
}
