import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";
import webpush from "web-push";

import {
  createTestUser,
  deleteCreatedUsers,
  localSupabaseAvailable,
  mailTo,
  signIn,
} from "./helpers/local-auth";
import {
  addBoardFollow,
  addPushSubscription,
  addWatchProfileForPlace,
  deleteSeededPostings,
  finishOnboarding,
  setMemberSince,
} from "./helpers/local-postings";

/*
 * Notifications against local Supabase. A hand-run of the Watch worker (for
 * one mock Greenhouse board, helpers/ats-mock-server.mjs) finds a new
 * internship: a subscribed user gets exactly one push (the mock records what
 * a browser vendor's push service would have received), and a second run with
 * nothing new sends nothing. A member with no device gets the email fallback
 * after a day; a brand-new member doesn't. The settings page covers the iPhone
 * Add to Home Screen steps and the email switch.
 */
test.skip(
  !localSupabaseAvailable,
  "needs local Supabase (npm run test:e2e:local)",
);

const MOCK_ORIGIN = `http://localhost:${process.env.ATS_MOCK_PORT ?? 3101}`;
const SMTP_URL = process.env.E2E_SMTP_URL ?? "smtp://127.0.0.1:54425";
const DAY = 24 * 60 * 60 * 1000;

test.afterAll(async () => {
  await deleteCreatedUsers();
  await deleteSeededPostings();
});

function runWorker(sourceKeys: string[]): string {
  const vapid = webpush.generateVAPIDKeys();
  return execFileSync(process.execPath, ["--import", "tsx", "worker/run.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WATCH_SOURCES: sourceKeys.join(","),
      E2E_ATS_ORIGIN: MOCK_ORIGIN,
      // The run also drains the tailoring queue: AI calls go to the mock.
      E2E_AI_ORIGIN: MOCK_ORIGIN,
      E2E_PUSH_ORIGIN: MOCK_ORIGIN,
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      SMTP_URL,
      EMAIL_FROM: "Shipmate <shipmate@e2e.shipmate.invalid>",
      APP_URL: "https://shipmate.e2e.invalid",
    },
    encoding: "utf8",
    timeout: 90_000,
  });
}

async function received(endpoint: string) {
  const response = await fetch(
    `${MOCK_ORIGIN}/push?endpoint=${encodeURIComponent(endpoint)}`,
  );
  return (await response.json()) as {
    endpoint: string;
    payload: { title: string; body: string; url: string };
  }[];
}

test("a new match sends one push, a quiet run sends none", async ({}, info) => {
  const tag = `${info.project.name.length}${Date.now().toString(36)}`;
  const slug = `e2e-harbor-push-${tag}`;
  const company = `Harbor Mock Push ${tag}`;
  const endpoint = `https://push.e2e.invalid/${tag}`;

  const user = await createTestUser("push");
  await finishOnboarding(user.id);
  await addWatchProfileForPlace(user.id, slug);
  const key = await addBoardFollow(user.id, slug, company, true);
  await addPushSubscription(user.id, endpoint);
  // Long enough a member that the email fallback would apply if push didn't.
  await setMemberSince(user.id, new Date(Date.now() - 3 * DAY));

  runWorker([key]);
  const first = await received(endpoint);
  expect(first).toHaveLength(1);
  expect(first[0].payload).toEqual({
    title: "Shipmate",
    body: `1 new match at ${company}`,
    url: "/inbox",
  });
  // Push worked, so no email on top of it.
  expect(await mailTo(user.email)).toHaveLength(0);

  // Nothing new: the board is unchanged, so nobody is told again.
  runWorker([key]);
  expect(await received(endpoint)).toHaveLength(1);
});

test("a member with no device gets the email fallback; a brand-new one doesn't", async ({}, info) => {
  const tag = `${info.project.name.length}${Date.now().toString(36)}`;
  const slug = `e2e-harbor-mail-${tag}`;
  const company = `Harbor Mock Mail ${tag}`;

  const settled = await createTestUser("mail-old");
  await finishOnboarding(settled.id);
  await addWatchProfileForPlace(settled.id, slug);
  await setMemberSince(settled.id, new Date(Date.now() - 3 * DAY));

  const fresh = await createTestUser("mail-new");
  await finishOnboarding(fresh.id);
  await addWatchProfileForPlace(fresh.id, slug);
  await setMemberSince(fresh.id, new Date(Date.now() - 60 * 60 * 1000));

  const key = await addBoardFollow(settled.id, slug, company);

  runWorker([key]);

  const mail = await mailTo(settled.email);
  expect(mail).toHaveLength(1);
  expect(mail[0].subject).toBe(`Shipmate: 1 new match at ${company}`);
  expect(mail[0].text).toContain("https://shipmate.e2e.invalid/inbox");
  expect(mail[0].text).toContain("Profile → Notifications");
  // Counts and company names only.
  expect(mail[0].text).not.toMatch(/resume|answer/i);

  expect(await mailTo(fresh.email)).toHaveLength(0);
});

test.describe("settings page", () => {
  test("shows the Add to Home Screen steps on an iPhone", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      viewport: { width: 390, height: 844 },
      baseURL: "http://localhost:3000",
    });
    const page = await context.newPage();
    const user = await createTestUser("ios");
    await finishOnboarding(user.id);
    await signIn(page, user, "/profile/notifications");

    await expect(
      page.getByText("Add Shipmate to your Home Screen first"),
    ).toBeVisible();
    await expect(page.getByText("Choose “Add to Home Screen”")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Turn on notifications" }),
    ).toHaveCount(0);
    await context.close();
  });

  test("the email switch is remembered", async ({ page }) => {
    const user = await createTestUser("email-switch");
    await finishOnboarding(user.id);
    await signIn(page, user, "/profile/notifications");

    const box = page.getByRole("checkbox", {
      name: /Email me when I have new matches/,
    });
    await expect(box).toBeChecked();
    // The checkbox is server-rendered; click until the handler is attached,
    // and wait for the Server Action's POST so the reload sees what it saved.
    await expect(async () => {
      const saved = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().includes("/profile/notifications"),
        { timeout: 1500 },
      );
      await box.setChecked(false, { timeout: 1500 });
      await saved;
    }).toPass();
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: /Email me when I have new matches/ }),
    ).not.toBeChecked();
  });
});
