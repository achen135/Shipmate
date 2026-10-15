import { join } from "node:path";

import { type Page, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { applyAndReturn, blockExternal } from "./helpers/actions";
import {
  createTestUser,
  deleteCreatedUsers,
  localSupabaseAvailable,
  signIn,
} from "./helpers/local-auth";
import {
  addApplied,
  addToInbox,
  deleteSeededPostings,
  finishOnboarding,
  seedPostings,
  setProfile,
} from "./helpers/local-postings";

/*
 * Review page against local Supabase: upload a resume → open a posting to see
 * the warnings, keyword match, resume, and answer sheet (the application form
 * comes from helpers/ats-mock-server.mjs) → Apply → "Did you submit?" →
 * Yes → the Tracker has it. Also: No leaves it alone, and a form Shipmate
 * can't read gets the paste box.
 */
test.skip(
  !localSupabaseAvailable,
  "needs local Supabase (npm run test:e2e:local)",
);

const RESUME = join(__dirname, "../lib/resume/__fixtures__/sample-resume.pdf");

test.afterAll(async () => {
  await deleteCreatedUsers();
  await deleteSeededPostings();
});

function runTag(project: string): string {
  return `r${project.length}${Date.now().toString(36)}`;
}

/** A job id the mock Greenhouse board answers for (any digits will do). */
function jobId(): number {
  return 7_000_000 + Math.floor(Math.random() * 1_000_000);
}

async function member(page: Page, label: string, next: string) {
  const user = await createTestUser(label);
  await finishOnboarding(user.id);
  await signIn(page, user, next);
  return user;
}

test("upload a resume, review a posting, apply, and find it in the Tracker", async ({
  page,
}, info) => {
  const tag = runTag(info.project.name);
  const company = `Harbor Mock Review ${tag}`;
  const title = `Backend Intern (${tag})`;
  const user = await createTestUser("review");
  await finishOnboarding(user.id);
  await setProfile(user.id, {
    school: "State University",
    degree: "bachelors",
    major: "Computer Science",
    grad_month: 5,
    grad_year: 2027,
    needs_sponsorship: true,
    work_authorized: true,
  });
  await blockExternal(page);

  const [postingId, earlierId] = await seedPostings(company, [
    {
      title,
      category: "Software",
      daysAgo: 1,
      url: `https://boards.greenhouse.io/e2e-harbor/jobs/${jobId()}`,
      sponsorship: "no_sponsorship",
      degrees: ["Master's"],
      description:
        "Build REST APIs in Python and Java with PostgreSQL. Deploy services on AWS using Docker and Kubernetes. " +
        "Strong algorithms and data structures. Open to the class of 2030.",
    },
    {
      title: `Earlier Platform Intern (${tag})`,
      category: "Software",
      daysAgo: 30,
    },
  ]);
  await addToInbox(user.id, postingId);
  await addApplied(user.id, earlierId, "2026-03-20");

  // Before a resume exists the page says where to put one.
  await signIn(page, user, `/postings/${postingId}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Upload your resume" }),
  ).toBeVisible();

  // Upload on the Profile page. The file input is server-rendered, so a pick
  // made before hydration is lost; clear it and pick again until it sticks.
  await page.goto("/profile/application");
  const picker = page.locator('input[type="file"]');
  await expect(async () => {
    await picker.setInputFiles([]);
    await picker.setInputFiles(RESUME);
    await expect(page.getByText("sample-resume.pdf")).toBeVisible({
      timeout: 1500,
    });
  }).toPass();

  await page.goto(`/postings/${postingId}`);

  // Warnings: every rule that applies, none blocking.
  const warnings = page.getByRole("region", { name: "Warnings" });
  await expect(warnings).toContainText(
    "You've applied to this company before:",
  );
  await expect(
    warnings.getByRole("link", {
      name: `Earlier Platform Intern (${tag}), 3/20 (Applied)`,
    }),
  ).toBeVisible();
  await expect(warnings).toContainText(
    "The posting mentions graduating in 2030; you graduate in 2027.",
  );
  await expect(warnings).toContainText("The posting lists Master's");
  await expect(warnings).toContainText(
    "doesn't offer visa sponsorship, and you've said you need it",
  );
  await expect(warnings).toContainText("before Summer 2027 starts");

  // Keyword match, labelled as such.
  const match = page.getByRole("region", { name: "Keyword match" });
  await expect(match).toContainText(/\d+%\s*of this posting's words/);
  await expect(match).toContainText("python");

  await expect(page.getByRole("region", { name: "Resume" })).toContainText(
    "sample-resume.pdf",
  );

  // Answer sheet: standard answers prefilled, written and anti-bot flagged.
  const standard = page.getByRole("list", {
    name: "Questions your profile answers",
  });
  // The mock form asks for first and last name separately.
  await expect(standard).toContainText("Inbox");
  await expect(standard).toContainText("Tester");
  await expect(standard).toContainText("e2e.shipmate.invalid");
  await expect(
    standard.getByRole("button", { name: "Copy Email" }),
  ).toBeVisible();
  await expect(standard).toContainText("Add your phone number in Profile.");
  await expect(
    page.getByRole("heading", { name: /Written questions/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Why do you want to work at Harbor Mock?"),
  ).toBeVisible();
  const antibot = page.getByRole("region", { name: "Answer these yourself" });
  await expect(antibot).toContainText("Anti-bot question");
  await expect(antibot).toContainText("decode this base64 string");

  // Apply → back to the tab → "Did you submit?" → Yes.
  await applyAndReturn(page);
  await page.getByRole("button", { name: "Yes, I applied" }).click();
  await expect(page.getByText("In your Tracker: Applied")).toBeVisible();

  // The exact PDF that went with it is recorded and opens from the Tracker.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: applied } = await admin
    .from("user_postings")
    .select("id, resume_used")
    .eq("user_id", user.id)
    .eq("posting_id", postingId)
    .single();
  expect(applied?.resume_used).toMatchObject({
    kind: "uploaded",
    bucket: "uploads",
    file_name: "sample-resume.pdf",
  });
  await page.goto(`/tracker/${applied!.id}`);
  await expect(page.getByTestId("resume-used")).toContainText(
    "Resume sent: Your uploaded resume (sample-resume.pdf)",
  );
  const sent = await page.request.get(
    `/api/applications/${applied!.id}/resume`,
  );
  expect(sent.headers()["content-type"]).toBe("application/pdf");

  await page.goto("/tracker");
  await expect(page.getByRole("link", { name: company }).first()).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Counts" }).getByRole("button", {
      name: /^2\s*Applied/,
    }),
  ).toBeVisible();
});

test("'Not yet' leaves the posting where it was", async ({ page }, info) => {
  const tag = runTag(info.project.name);
  const company = `Harbor Mock Later ${tag}`;
  const title = `Data Intern (${tag})`;
  const [postingId] = await seedPostings(company, [
    {
      title,
      category: "Software",
      daysAgo: 1,
      url: `https://boards.greenhouse.io/e2e-harbor/jobs/${jobId()}`,
    },
  ]);
  const user = await member(page, "review-no", "/inbox");
  await addToInbox(user.id, postingId);
  await blockExternal(page);

  await page.goto(`/postings/${postingId}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await applyAndReturn(page);
  await page.getByRole("button", { name: "Not yet" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Did you submit?" }),
  ).toHaveCount(0);

  // Still in the Inbox: Skip and Save are still offered, nothing is applied.
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  await expect(page.getByText("In your Tracker")).toHaveCount(0);
});

test("a form Shipmate can't read gets a paste box that keeps what you paste", async ({
  page,
}, info) => {
  const tag = runTag(info.project.name);
  const company = `Harbor Mock Closed ${tag}`;
  const title = `Ops Intern (${tag})`;
  const [postingId] = await seedPostings(company, [
    {
      title,
      category: "Software",
      daysAgo: 1,
      url: `https://harbor-mock.wd5.myworkdayjobs.com/en-US/External/job/Ops-Intern_R${jobId()}`,
    },
  ]);
  const user = await member(page, "review-paste", "/inbox");
  await addToInbox(user.id, postingId);

  await page.goto(`/postings/${postingId}`);
  await expect(
    page.getByText("Shipmate can't see this application's questions yet"),
  ).toBeVisible();

  const box = page.getByRole("textbox", { name: "Paste the questions" });
  await expect(async () => {
    await box.fill("1. Why this company?\n2. Tell us about a team project.");
    await expect(box).toHaveValue(/Why this company/);
    await page.getByRole("button", { name: "Save questions" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 1500 });
  }).toPass();

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Paste the questions" }),
  ).toHaveValue(/Tell us about a team project/);
});
