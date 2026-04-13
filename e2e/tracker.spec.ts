import { expect, type Page, test } from "@playwright/test";

import {
  createTestUser,
  deleteCreatedUsers,
  localSupabaseAvailable,
  signIn,
} from "./helpers/local-auth";
import { andWaitForAction } from "./helpers/actions";
import {
  addToInbox,
  deleteSeededPostings,
  finishOnboarding,
  seedPostings,
} from "./helpers/local-postings";

/*
 * Tracker happy paths against local Supabase: Save → Mark applied → Tracker
 * with a timeline; add by Greenhouse URL (ATS API mocked by
 * helpers/ats-mock-server.mjs); import a pasted table and confirm the
 * preview; re-import skips; export.
 */
test.skip(
  !localSupabaseAvailable,
  "needs local Supabase (npm run test:e2e:local)",
);

test.afterAll(async () => {
  await deleteCreatedUsers();
  await deleteSeededPostings();
});

function runTag(project: string): string {
  return `t${project.length}${Date.now().toString(36)}`;
}

async function member(page: Page, label: string, next: string) {
  const user = await createTestUser(label);
  await finishOnboarding(user.id);
  await signIn(page, user, next);
  return user;
}

function nav(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name });
}

test("save a posting, mark it applied, follow it in the Tracker", async ({
  page,
}, info) => {
  const tag = runTag(info.project.name);
  const company = `Bowsprit ${tag}`;
  const title = `Platform Intern (${tag})`;
  const [postingId] = await seedPostings(company, [
    { title, category: "Software", daysAgo: 1 },
  ]);
  const user = await member(page, "tracker", "/inbox");
  await addToInbox(user.id, postingId);
  await page.reload();

  const card = page.getByRole("article", { name: `${title} at ${company}` });
  await andWaitForAction(page, () =>
    card.getByRole("button", { name: "Save" }).click(),
  );
  await expect(card.getByRole("status")).toHaveText(/Saved to To Apply/);

  await nav(page, "To Apply").click();
  await expect(page).toHaveURL(/\/to-apply$/);
  await andWaitForAction(page, () =>
    card.getByRole("button", { name: "Mark applied" }).click(),
  );
  await expect(card.getByRole("status")).toHaveText(/in your Tracker/);

  await nav(page, "Tracker").click();
  await expect(page).toHaveURL(/\/tracker$/);
  await expect(
    page.getByRole("heading", { name: /^Summer 2027/ }),
  ).toBeVisible();
  const counts = page.getByRole("list", { name: "Counts" });
  await expect(
    counts.getByRole("button", { name: /^1\s*Applied/ }),
  ).toBeVisible();

  // Phone: a card; desktop: the company link in the table.
  await page.getByRole("link", { name: new RegExp(company) }).click();
  await expect(page).toHaveURL(/\/tracker\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const timeline = page.getByRole("list", { name: "Timeline" });
  await expect(timeline.getByRole("listitem")).toHaveText([
    /Inbox → Saved/,
    /Saved → Applied/,
  ]);

  // A status change adds one event; a notes edit adds none.
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Interview" }).click();
  await page.getByRole("textbox", { name: "Notes" }).fill("Recruiter call");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(timeline.getByRole("listitem")).toHaveCount(3);
  await expect(timeline.getByRole("listitem").last()).toHaveText(
    /Applied → Interview/,
  );

  // The posting page knows it's tracked.
  await page.getByRole("link", { name: "Posting details" }).click();
  await expect(page.getByText("In your Tracker: Interview")).toBeVisible();
});

test("add an application by Greenhouse link, and by a known posting's link", async ({
  page,
}, info) => {
  const tag = runTag(info.project.name);
  const jobId = String(Date.now()).slice(-9);
  await member(page, "tracker-add", "/tracker/new");

  // Greenhouse: company, title, location from the (mocked) job API.
  await page
    .getByRole("textbox", { name: "Job link" })
    .fill(`https://boards.greenhouse.io/e2e-harbor/jobs/${jobId}?gh_src=x`);
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByRole("textbox", { name: "Company" })).toHaveValue(
    "Harbor Mock Co",
  );
  await expect(page.getByRole("textbox", { name: "Role" })).toHaveValue(
    `Mock Systems Intern ${jobId}`,
  );
  await expect(page.getByRole("textbox", { name: "Location" })).toHaveValue(
    "Boston, MA",
  );
  await page.getByRole("button", { name: "Add to Tracker" }).click();
  await expect(page).toHaveURL(/\/tracker\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: `Mock Systems Intern ${jobId}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Timeline" }).getByRole("listitem"),
  ).toHaveText([/Added as Applied/]);

  // A link Shipmate already has links the posting instead of a manual row.
  const company = `Capstan ${tag}`;
  await seedPostings(company, [
    { title: `Data Intern (${tag})`, category: "AI/ML/Data", daysAgo: 2 },
  ]);
  const slug = `${company}-0`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await page.goto("/tracker/new");
  await page
    .getByRole("textbox", { name: "Job link" })
    .fill(`https://www.example.com/jobs/${slug}/?utm_source=x`);
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("Found in Shipmate")).toBeVisible();
  await page.getByRole("button", { name: "Add to Tracker as applied" }).click();
  await expect(page).toHaveURL(/\/tracker\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("link", { name: "Posting details" }),
  ).toBeVisible();
});

test("import a pasted table, check the preview, re-import, export", async ({
  page,
}, info) => {
  const tag = runTag(info.project.name);
  await member(page, "tracker-import", "/tracker/import");

  const table = [
    "# Summer 2027",
    "",
    "| Company | Date Applied | Status | Resume Version | Notes |",
    "| --- | --- | --- | --- | --- |",
    `| Alpha ${tag} | 09/19/26 | Waiting | 1 | |`,
    `| ~~Beta ${tag}~~ | 09/20/26 | Rejected | 2 | First rejection |`,
    `| Gamma ${tag} (backend) | 09/27/26 | Waiting, but dnc | 3? | |`,
    `| Delta ${tag} | 10/02/26 | Waiting - Referred | 4 | |`,
    "|  |  |  |  |  |",
  ].join("\n");

  const paste = page.getByRole("textbox", { name: "Paste your tracker" });
  await paste.fill(table);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("status")).toHaveText("4 rows: 4 to import.");
  const rows = page.getByTestId("import-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText(`Beta ${tag}`);
  await expect(rows.nth(1)).toContainText("Rejected");
  await expect(rows.nth(2)).toContainText("backend");
  await expect(rows.nth(2)).toContainText("Resume v3?");
  await expect(rows.nth(2)).toContainText("dnc");
  await expect(rows.nth(3)).toContainText("Yes");

  await page.getByRole("button", { name: "Import 4 rows" }).click();
  await expect(page).toHaveURL(/\/tracker$/);
  const counts = page.getByRole("list", { name: "Counts" });
  await expect(
    counts.getByRole("button", { name: /^3\s*Applied/ }),
  ).toBeVisible();
  await expect(
    counts.getByRole("button", { name: /^1\s*Rejected/ }),
  ).toBeVisible();

  // Filter by search.
  await page
    .getByRole("searchbox", { name: "Search company or role" })
    .fill(`Gamma ${tag}`);
  await expect(page.getByRole("link", { name: /Alpha/ })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: new RegExp(`Gamma ${tag}`) }),
  ).toBeVisible();

  // Same file again: everything is already there.
  await page.goto("/tracker/import");
  await paste.fill(table);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "4 rows: 0 to import, 4 already in tracker.",
  );
  await expect(
    page.getByRole("button", { name: "Import 0 rows" }),
  ).toBeDisabled();

  // Export uses the import's column names.
  const csv = await (await page.request.get("/api/tracker/export")).text();
  expect(csv).toContain(
    "Company,Role,Term,Date Applied,Status,Referral,Referrer,Resume Version,Notes,URL",
  );
  expect(csv).toContain(
    `Gamma ${tag},backend,Summer 2027,2026-09-27,Applied,,,Resume v3?,dnc,`,
  );
});
