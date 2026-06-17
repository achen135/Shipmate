import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import {
  createTestUser,
  deleteCreatedUsers,
  localSupabaseAvailable,
  signIn,
} from "./helpers/local-auth";
import {
  addToInbox,
  deleteSeededPostings,
  finishOnboarding,
  seedPostings,
} from "./helpers/local-postings";

/*
 * M9 §3, against local Supabase and the ATS mock: the no-AI prep for a saved
 * posting starts before anyone asks for it.
 * - Saving from the Inbox reads the application form right away, so the
 *   posting's review page (and a later "Tailor all") finds it cached.
 * - The Watch run fetches the full text of postings saved by people in AI
 *   mode that have none, and leaves Simple-mode users' postings alone.
 */
test.skip(
  !localSupabaseAvailable,
  "needs local Supabase (npm run test:e2e:local)",
);

const MOCK_ORIGIN = `http://localhost:${process.env.ATS_MOCK_PORT ?? 3101}`;

const db = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

test.afterAll(async () => {
  await deleteCreatedUsers();
  await deleteSeededPostings();
});

/** Greenhouse job ids the mock answers for (any number does). */
let nextJob = 700_000_000 + (Date.now() % 10_000_000);
const greenhouseUrl = () =>
  `https://boards.greenhouse.io/e2e-harbor/jobs/${nextJob++}`;

test("saving a posting reads its application form without opening it", async ({
  page,
}, info) => {
  const tag = `${info.project.name.length}${Date.now().toString(36)}`;
  const user = await createTestUser(`prefetch-q-${tag}`);
  await finishOnboarding(user.id);
  const [postingId] = await seedPostings(`Quayside ${tag}`, [
    {
      title: "Systems Intern",
      category: "Software",
      daysAgo: 1,
      url: greenhouseUrl(),
    },
  ]);
  await addToInbox(user.id, postingId);

  const admin = db();
  const read = async () =>
    (
      await admin
        .from("postings")
        .select("questions_status, questions")
        .eq("id", postingId)
        .single()
    ).data;
  expect((await read())?.questions_status).toBeNull();

  await signIn(page, user, "/inbox");
  const card = page
    .getByTestId("posting-card")
    .filter({ hasText: "Systems Intern" });
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Saved to To Apply")).toBeVisible();

  // Fetched after the response, by the app, with nobody on the review page.
  await expect.poll(async () => (await read())?.questions_status).toBe("ok");
  expect(JSON.stringify((await read())?.questions)).toContain("First Name");
});

test("skipping or putting back fetches nothing", async ({ page }, info) => {
  const tag = `${info.project.name.length}${Date.now().toString(36)}`;
  const user = await createTestUser(`prefetch-skip-${tag}`);
  await finishOnboarding(user.id);
  const [postingId] = await seedPostings(`Quayside ${tag}`, [
    {
      title: "Hardware Intern",
      category: "Software",
      daysAgo: 1,
      url: greenhouseUrl(),
    },
  ]);
  await addToInbox(user.id, postingId);

  await signIn(page, user, "/inbox");
  const card = page
    .getByTestId("posting-card")
    .filter({ hasText: "Hardware Intern" });
  await card.getByRole("button", { name: "Skip" }).click();
  await expect(card.getByText("Skipped.")).toBeVisible();
  // Give anything wrongly started time to land, then check.
  await page.waitForTimeout(2_000);
  const { data } = await db()
    .from("postings")
    .select("questions_status")
    .eq("id", postingId)
    .single();
  expect(data?.questions_status).toBeNull();
});

function runWatch(): string {
  return execFileSync(process.execPath, ["--import", "tsx", "worker/run.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      // No source: this run is for what happens after the sources.
      WATCH_SOURCES: "greenhouse:e2e-harbor-none",
      E2E_ATS_ORIGIN: MOCK_ORIGIN,
      E2E_AI_ORIGIN: MOCK_ORIGIN,
    },
    encoding: "utf8",
    timeout: 90_000,
  });
}

test("the Watch run fetches saved postings' text for AI-mode users only", async ({}, info) => {
  const tag = `${info.project.name.length}${Date.now().toString(36)}`;
  const ai = await createTestUser(`prefetch-ai-${tag}`);
  const simple = await createTestUser(`prefetch-simple-${tag}`);
  await finishOnboarding(ai.id);
  await finishOnboarding(simple.id);
  const admin = db();
  await admin.from("profiles").update({ mode: "ai" }).eq("user_id", ai.id);
  await admin
    .from("profiles")
    .update({ mode: "simple" })
    .eq("user_id", simple.id);

  const [forAi, forSimple, notSaved] = await seedPostings(`Quayside ${tag}`, [
    {
      title: "AI Saved",
      category: "Software",
      daysAgo: 1,
      url: greenhouseUrl(),
    },
    {
      title: "Simple Saved",
      category: "Software",
      daysAgo: 1,
      url: greenhouseUrl(),
    },
    {
      title: "Unsaved",
      category: "Software",
      daysAgo: 1,
      url: greenhouseUrl(),
    },
  ]);
  for (const [user, id] of [
    [ai, forAi],
    [simple, forSimple],
    [ai, notSaved],
  ] as const) {
    await addToInbox(user.id, id);
  }
  for (const [user, id] of [
    [ai, forAi],
    [simple, forSimple],
  ] as const) {
    await admin
      .from("user_postings")
      .update({ status: "saved" })
      .eq("user_id", user.id)
      .eq("posting_id", id);
  }

  const out = runWatch();
  expect(out).toMatch(/\[worker\] prefetch: \{"due":\d+,"fetched":\d+/);

  const text = async (id: string) =>
    (
      await admin
        .from("postings")
        .select("fetched_description, description_fetched_at")
        .eq("id", id)
        .single()
    ).data;
  // The AI user's saved posting now has its text, as tailoring would have
  // fetched it, and is stamped so a miss wouldn't be retried every run.
  const fetched = await text(forAi);
  expect(fetched?.fetched_description).toContain("About the role");
  expect(fetched?.description_fetched_at).not.toBeNull();
  // Simple mode never tailors; an unsaved posting isn't anyone's yet.
  expect((await text(forSimple))?.description_fetched_at).toBeNull();
  expect((await text(notSaved))?.description_fetched_at).toBeNull();
});
