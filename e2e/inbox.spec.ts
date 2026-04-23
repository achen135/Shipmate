import { expect, test } from "@playwright/test";

import { andWaitForAction } from "./helpers/actions";
import {
  createTestUser,
  deleteCreatedUsers,
  localSupabaseAvailable,
  signIn,
} from "./helpers/local-auth";
import {
  deleteSeededPostings,
  finishBasics,
  setMode,
  seedPostings,
} from "./helpers/local-postings";

/*
 * What to watch → backfilled Inbox → Save → To Apply → Skip, against local
 * Supabase with fixture postings (no worker, no network).
 */
test.skip(
  !localSupabaseAvailable,
  "needs local Supabase (npm run test:e2e:local)",
);

test.afterAll(async () => {
  await deleteCreatedUsers();
  await deleteSeededPostings();
});

test("pick a preset, triage the backfilled Inbox", async ({ page }, info) => {
  // Neutral tag: a project name like "mobile" is itself an SWE keyword.
  const tag = `run${info.project.name.length}${Date.now().toString(36)}`;
  const company = `Harbor Labs ${tag}`;
  const title = (role: string) => `${role} (${tag})`;
  await seedPostings(company, [
    {
      title: title("Software Engineer Intern"),
      category: "Software",
      daysAgo: 1,
    },
    {
      title: title("Backend Developer Intern"),
      category: "Software",
      daysAgo: 2,
    },
    {
      title: title("Mechanical Design Intern"),
      category: "Hardware",
      daysAgo: 1,
    },
    {
      title: title("Platform Engineer Intern"),
      category: "Software",
      daysAgo: 10,
    },
    {
      title: title("Frontend Intern"),
      category: "Software",
      daysAgo: 1,
      status: "closed",
    },
    {
      title: title("Mobile Engineer Intern"),
      category: "Software",
      daysAgo: 1,
      terms: ["Fall 2026"],
    },
  ]);

  const user = await createTestUser("inbox");
  await finishBasics(user.id);
  await setMode(user.id, "simple");
  await signIn(page, user, "/inbox");

  // Basics done → the resume step, which can wait for Profile.
  await expect(page).toHaveURL(/\/onboarding\/resume$/);
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/onboarding\/watch$/);
  await expect(
    page.getByRole("heading", { name: "What to watch" }),
  ).toBeVisible();
  // Simple mode has no fact-bank step, so this is step 4 of 4.
  await expect(page.getByText("Step 4")).toBeVisible();

  // Supply chain explains why it finds little; then pick SWE.
  await page.getByText("Supply chain/Ops", { exact: true }).click();
  await expect(page.getByText(/follow supply chain companies/i)).toBeVisible();
  await page.getByText("SWE", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("SWE");
  await expect(page.getByRole("checkbox", { name: "Software" })).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Summer 2027" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Set sail" }).click();

  // Backfill: open, last 7 days, Summer 2027, SWE.
  await expect(page).toHaveURL(/\/inbox$/);
  const card = (role: string) =>
    page.getByRole("article", { name: `${title(role)} at ${company}` });
  await expect(card("Software Engineer Intern")).toBeVisible();
  await expect(card("Backend Developer Intern")).toBeVisible();
  for (const missing of [
    "Mechanical Design Intern", // other category, no SWE keyword
    "Platform Engineer Intern", // posted 10 days ago
    "Frontend Intern", // closed
    "Mobile Engineer Intern", // Fall 2026 only
  ]) {
    await expect(card(missing)).toHaveCount(0);
  }

  // Save → To Apply.
  await andWaitForAction(page, () =>
    card("Software Engineer Intern")
      .getByRole("button", { name: "Save" })
      .click(),
  );
  await expect(card("Software Engineer Intern").getByRole("status")).toHaveText(
    /Saved to To Apply/,
  );

  // Skip with a reason → gone from the Inbox.
  const backend = card("Backend Developer Intern");
  await andWaitForAction(page, () =>
    backend.getByRole("button", { name: "Skip" }).click(),
  );
  await andWaitForAction(page, () =>
    backend.getByRole("button", { name: "Location" }).click(),
  );
  await expect(backend.getByRole("status")).toHaveText(/Skipped: Location/);

  await page.reload();
  await expect(card("Backend Developer Intern")).toHaveCount(0);
  await expect(card("Software Engineer Intern")).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "To Apply" })
    .click();
  await expect(page).toHaveURL(/\/to-apply$/);
  const saved = card("Software Engineer Intern");
  await expect(saved).toBeVisible();
  await expect(saved.getByRole("link", { name: "Apply" })).toHaveAttribute(
    "target",
    "_blank",
  );

  // Posting detail: fields + the Apply link in the sticky actions.
  await saved
    .getByRole("link", { name: title("Software Engineer Intern") })
    .click();
  await expect(page).toHaveURL(/\/postings\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: title("Software Engineer Intern") }),
  ).toBeVisible();
  await expect(page.getByText("Saved to To Apply")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Apply", exact: true }),
  ).toHaveAttribute("href", /^https:\/\/example\.com\/jobs\//);

  // The search shows up in Profile.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Profile" })
    .click();
  await expect(page.getByRole("list", { name: "Your searches" })).toContainText(
    "SWE",
  );
});
