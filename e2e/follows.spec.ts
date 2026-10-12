import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import {
  createTestUser,
  deleteCreatedUsers,
  localSupabaseAvailable,
  signIn,
} from "./helpers/local-auth";
import {
  addSoftwareWatchProfile,
  deleteCompaniesNamed,
  finishOnboarding,
} from "./helpers/local-postings";

/*
 * Companies happy path against local Supabase: paste a Greenhouse careers
 * link for a company Shipmate has never seen → it's followed and gets a
 * source → a hand-run of the worker (against the mock board in
 * helpers/ats-mock-server.mjs) puts its internship in the Inbox of a user
 * whose watch profile matches. The worker is limited to this test's source
 * (WATCH_SOURCES) so nothing else is fetched.
 */
test.skip(
  !localSupabaseAvailable,
  "needs local Supabase (npm run test:e2e:local)",
);

const MOCK_ORIGIN = `http://localhost:${process.env.ATS_MOCK_PORT ?? 3101}`;
const prefix = "Harbor Mock";
/** This worker's companies only; the other project's test is still running. */
const createdCompanies: string[] = [];

test.afterAll(async () => {
  await deleteCreatedUsers();
  await deleteCompaniesNamed(createdCompanies.splice(0));
});

/** One Watch run, as GitHub Actions does it, for just these sources. */
function runWorker(sourceKeys: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx", "worker/run.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WATCH_SOURCES: sourceKeys.join(","),
      E2E_ATS_ORIGIN: MOCK_ORIGIN,
    },
    encoding: "utf8",
    timeout: 60_000,
  });
}

test("follow a company by its careers page, then its jobs reach the Inbox", async ({
  page,
}, info) => {
  const tag = `${info.project.name.length}${Date.now().toString(36)}`;
  const slug = `e2e-harbor-${tag}`;
  const company = `${prefix} ${tag}`;
  createdCompanies.push(company);

  const user = await createTestUser("follows");
  await finishOnboarding(user.id);
  await addSoftwareWatchProfile(user.id);
  await signIn(page, user, "/profile");

  await page.getByRole("link", { name: /Followed companies/ }).click();
  await expect(page).toHaveURL(/\/profile\/companies$/);
  await expect(
    page.getByRole("heading", { name: "Companies", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Nothing followed yet")).toBeVisible();

  // A site Shipmate can't read is a message, not a crash.
  await page
    .getByRole("textbox", { name: "Careers page link" })
    .fill("https://careers.example.com/jobs");
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(page.getByText("Not a supported careers page.")).toBeVisible();

  // A Greenhouse board for a company that has no source yet.
  await page
    .getByRole("textbox", { name: "Careers page link" })
    .fill(`https://boards.greenhouse.io/${slug}`);
  await page.getByRole("textbox", { name: /Company name/ }).fill(company);
  await page.getByRole("button", { name: "Follow", exact: true }).click();

  const followed = page.getByRole("list", { name: "Followed companies" });
  const row = followed.getByRole("listitem").filter({ hasText: company });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Greenhouse");
  await expect(row).toContainText(slug);

  // Priority is stored and survives a reload.
  const star = row.getByRole("button", { name: `Priority: ${company}` });
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page
      .getByRole("list", { name: "Followed companies" })
      .getByRole("button", { name: `Priority: ${company}` }),
  ).toHaveAttribute("aria-pressed", "true");

  // The followed company is found by search, as already followed.
  await page.getByRole("searchbox", { name: "Search companies" }).fill(company);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(
    page
      .getByRole("list", { name: "Search results" })
      .getByText("Following", { exact: true }),
  ).toBeVisible();

  // Nothing in the Inbox until the worker has looked at the board.
  await page.goto("/inbox");
  const card = page.getByRole("article", {
    name: `Software Engineer Intern at ${company}`,
  });
  await expect(card).toHaveCount(0);

  runWorker([`greenhouse:${slug}`]);
  await page.reload();
  await expect(card).toBeVisible();
  // The title filter dropped the other two jobs.
  await expect(
    page.getByRole("article", { name: `Staff Engineer at ${company}` }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: `Internal Audit Manager at ${company}` }),
  ).toHaveCount(0);

  // A second check changes nothing: still one card.
  runWorker([`greenhouse:${slug}`]);
  await page.reload();
  await expect(card).toHaveCount(1);

  // Unfollow from Companies.
  await page.goto("/profile/companies");
  await page.getByRole("button", { name: `Unfollow ${company}` }).click();
  await expect(page.getByText("Nothing followed yet")).toBeVisible();
});
