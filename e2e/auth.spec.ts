import { type Page, expect, test } from "@playwright/test";

import {
  type TestUser,
  adoptUser,
  createInviteCode as createInviteCodeDirectly,
  createTestUser,
  deleteCreatedUsers,
  localSupabaseAvailable,
  magicLinkFor,
  makeAdmin,
  signIn,
  testEmail,
} from "./helpers/local-auth";

/*
 * Auth + invites + onboarding, end to end against local Supabase.
 * Skipped when no local stack is configured (e.g. the env-less CI build job);
 * the `db` CI job and `npm run test:e2e:local` run it.
 */
test.skip(
  !localSupabaseAvailable,
  "needs local Supabase (npm run test:e2e:local)",
);
test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await deleteCreatedUsers();
});

async function createInviteCode(page: Page, note: string): Promise<string> {
  await page.goto("/admin/invites");
  await page.getByRole("textbox", { name: /who is it for/i }).fill(note);
  await page.getByRole("button", { name: "Create invite code" }).click();
  const code = await page.getByTestId("new-invite-code").textContent();
  expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  return code!;
}

async function choose(page: Page, label: string | RegExp, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

let code: string;

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/tracker");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Ftracker$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Privacy" }),
  ).toBeVisible();
});

test("an un-invited user can't reach the Inbox", async ({ page }) => {
  const user = await createTestUser("uninvited");
  await signIn(page, user, "/inbox");
  await expect(page).toHaveURL(/\/onboarding\/invite$/);
  await expect(
    page.getByRole("heading", { name: "Enter your invite code" }),
  ).toBeVisible();

  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/onboarding\/invite$/);
  await expect(page.getByText("Calm seas.")).toHaveCount(0);

  // Admin pages don't exist for non-admins. (The not-found UI streams in
  // after the static shell, so the status stays 200; the content is what
  // matters.)
  await page.goto("/admin/invites");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create invite code" }),
  ).toHaveCount(0);
});

test("admin creates a code; an invited user completes Basics and lands on Inbox", async ({
  browser,
}) => {
  const admin = await createTestUser("admin");
  await makeAdmin(admin);
  const adminPage = await (await browser.newContext()).newPage();
  await signIn(adminPage, admin, "/admin/invites");
  code = await createInviteCode(adminPage, "e2e friend");
  await expect(adminPage.getByTestId("invite-row").first()).toContainText(
    "Available",
  );

  const friend: TestUser = await createTestUser("friend");
  const page = await (await browser.newContext()).newPage();
  await signIn(page, friend, "/inbox");
  await expect(page).toHaveURL(/\/onboarding\/invite$/);

  await page
    .getByRole("textbox", { name: "Invite code" })
    .fill(code.toLowerCase());
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/basics$/);

  // Submitting empty shows the shared zod schema's messages.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter your school.")).toBeVisible();

  await page.getByRole("textbox", { name: "Full name" }).fill("Sam Rivera");
  await page.getByRole("textbox", { name: "School" }).fill("Georgia Tech");
  await choose(page, "Degree", "Bachelor's");
  await page
    .getByRole("textbox", { name: "Major" })
    .fill("Industrial Engineering");
  await choose(page, "Graduation month", "May");
  await choose(page, "Graduation year", "2028");
  await page
    .getByRole("radiogroup", { name: /authorized to work/i })
    .getByRole("radio", { name: "Yes" })
    .check();
  await page
    .getByRole("radiogroup", { name: /sponsorship/i })
    .getByRole("radio", { name: "No" })
    .check();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByText("Calm seas.")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const tab of ["Inbox", "To Apply", "Tracker", "Profile"]) {
    await expect(nav.getByRole("link", { name: tab })).toBeVisible();
  }

  // Profile shows the saved Basics and can edit them.
  await nav.getByRole("link", { name: "Profile" }).click();
  await expect(page.getByRole("textbox", { name: "School" })).toHaveValue(
    "Georgia Tech",
  );
  await page
    .getByRole("textbox", { name: "Major" })
    .fill("Supply Chain Engineering");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Major" })).toHaveValue(
    "Supply Chain Engineering",
  );
  await expect(page.getByRole("link", { name: "Manage invites" })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/sign-in/);

  await adminPage.reload();
  await expect(adminPage.getByTestId("invite-row").first()).toContainText(
    "Used",
  );
});

test("the same code fails for a third account", async ({ page }) => {
  const third = await createTestUser("third");
  await signIn(page, third, "/inbox");
  await page.getByRole("textbox", { name: "Invite code" }).fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("That code has already been used."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/invite$/);
});

test("a magic link with an invite code typed before sign-in", async ({
  page,
}) => {
  test.skip(!process.env.MAILPIT_URL, "needs Mailpit (local Supabase)");
  const invite = await createInviteCodeDirectly("magic link e2e");
  const email = testEmail("magic");

  // The copied invite link prefills the code.
  await page.goto(`/sign-in?invite=${invite}`);
  await expect(page.getByRole("textbox", { name: "Invite code" })).toHaveValue(
    invite,
  );
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  // Same browser, so the PKCE verifier cookie is there for /auth/callback,
  // which also redeems the code kept in the short-lived cookie.
  await page.goto(await magicLinkFor(email));
  await adoptUser(email);
  await expect(page).toHaveURL(/\/onboarding\/basics$/);
  await expect(page.getByRole("heading", { name: "The basics" })).toBeVisible();
});
