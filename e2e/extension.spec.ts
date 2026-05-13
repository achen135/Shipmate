import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type BrowserContext,
  type Page,
  test as base,
  chromium,
  expect,
} from "@playwright/test";
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
import { greenhouseMarkup } from "../extension/src/__fixtures__/forms";
import { parseGreenhouseQuestions } from "../lib/questions/greenhouse";

/*
 * Shipmate Autofill, the real extension in Chromium, against local Supabase
 * and a Greenhouse application page built from the mock board's questions
 * (helpers/ats-mock-server.mjs: the same list the review page shows):
 *
 * connect in Profile → paste the key into the extension's settings →
 * Apply on the review page → the form fills by itself (the #shipmate=
 * marker): standard answers in, the tailored PDF attached, the written and
 * anti-bot questions flagged and untouched, nothing submitted → "I
 * submitted it" → applied, with that PDF recorded. Then the same page
 * opened without the marker: nothing happens until the toolbar button.
 */

const EXTENSION = join(__dirname, "..", "extension", "dist");
const BASE = "http://localhost:3000";
const MOCK = "http://localhost:3101";
const RESUME = join(__dirname, "../lib/resume/__fixtures__/sample-resume.pdf");

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // Playwright's fixture callback, named so the hooks lint rule leaves it be.
  context: async ({}, provide) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      baseURL: BASE,
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
      ],
    });
    await provide(context);
    await context.close();
  },
  extensionId: async ({ context }, provide) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    await provide(new URL(worker.url()).host);
  },
});

test.skip(
  !localSupabaseAvailable,
  "needs local Supabase (npm run test:e2e:local)",
);

test.beforeAll(() => {
  execFileSync(process.execPath, ["extension/build.mjs"], {
    cwd: join(__dirname, ".."),
  });
});

test.afterAll(async () => {
  await deleteCreatedUsers();
  await deleteSeededPostings();
});

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

/** The application page, and a record of anything sent to it. */
async function serveApplication(context: BrowserContext, jobId: string) {
  const questions = parseGreenhouseQuestions(
    await (
      await fetch(`${MOCK}/v1/boards/e2e-harbor/jobs/${jobId}?questions=true`)
    ).json(),
  );
  const html = `<!doctype html><html><head><title>Apply</title></head><body>
    <h1>Mock Systems Intern</h1>${greenhouseMarkup(questions)}
    <script>
      window.__submits = 0;
      document.querySelector("form").addEventListener("submit", (e) => {
        window.__submits += 1; e.preventDefault();
      });
    </script></body></html>`;
  const posts: string[] = [];
  await context.route("https://boards.greenhouse.io/**", (route) => {
    if (route.request().method() !== "GET") posts.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: html });
  });
  return { questions, posts };
}

const panel = (page: Page) =>
  page.getByRole("dialog", { name: "Shipmate Autofill" });

test("Apply in Shipmate fills the form, attaches the tailored PDF, never submits, and records it", async ({
  context,
  extensionId,
}) => {
  // One browser with the extension is enough: there's no phone Chrome
  // extension to emulate.
  test.skip(test.info().project.name !== "desktop", "desktop only");
  test.setTimeout(120_000);
  const db = admin();
  const jobId = String(700_000 + Math.floor(Math.random() * 99_999));
  const url = `https://boards.greenhouse.io/e2e-harbor/jobs/${jobId}`;
  const user = await createTestUser("extension");
  await finishOnboarding(user.id);
  await db
    .from("profiles")
    .update({ mode: "ai", daily_cap: 3, name: "Jordan Lee", phone: "555-0100" })
    .eq("user_id", user.id);
  const [postingId] = await seedPostings(`Harbor Mock Ext ${jobId}`, [
    { title: "Mock Systems Intern", category: "Software", daysAgo: 1, url },
  ]);
  await db
    .from("postings")
    .update({ ats: "greenhouse", ats_job_id: jobId })
    .eq("id", postingId);
  await addToInbox(user.id, postingId);
  const { data: item } = await db
    .from("user_postings")
    .select("id")
    .eq("user_id", user.id)
    .single();

  // A finished tailoring with its PDF, as the worker would leave it.
  const pdfPath = `${user.id}/${postingId}/e2e.pdf`;
  await db.storage
    .from("pdfs")
    .upload(pdfPath, readFileSync(RESUME), { contentType: "application/pdf" });
  const { data: tailoring } = await db
    .from("tailorings")
    .insert({ user_id: user.id, user_posting_id: item!.id })
    .select("id")
    .single();
  await db
    .from("tailorings")
    .update({ state: "done", pdf_path: pdfPath, score_after: 80 })
    .eq("id", tailoring!.id);

  const { posts } = await serveApplication(context, jobId);

  // Connect: Profile → Browser extension → the key, shown once.
  const page = context.pages()[0] ?? (await context.newPage());
  await signIn(page, user, "/profile/extension");
  await page.getByRole("button", { name: "Connect the extension" }).click();
  const token = await page.getByTestId("extension-token").innerText();
  expect(token).toMatch(/^shm_ext_/);

  // Paste it into the extension's settings.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel("Shipmate address").selectOption(BASE);
  await options.getByLabel("Extension key").fill(token);
  await options.getByRole("button", { name: "Save" }).click();
  await expect(options.getByText("Connected ✓")).toBeVisible();
  await options.close();

  // Apply from the review page: a new tab, filled with no further click.
  await page.goto(`/postings/${postingId}`);
  const apply = page.getByRole("link", { name: "Apply", exact: true });
  await expect(apply).toHaveAttribute("href", /#shipmate=/);
  const [form] = await Promise.all([
    context.waitForEvent("page"),
    apply.click(),
  ]);
  await expect(panel(form)).toBeVisible({ timeout: 20_000 });
  await expect(panel(form)).toContainText(
    "Attached Jordan_Lee_Resume_Harbor_Mock_Ext",
  );
  // The marker is out of the address bar at once.
  expect(form.url()).not.toContain("shipmate=");

  const value = (label: string) => form.getByLabel(label, { exact: false });
  await expect(value("First Name")).toHaveValue("Jordan");
  await expect(value("Last Name")).toHaveValue("Lee");
  await expect(value("Email")).toHaveValue(user.email);
  const attached = await form.evaluate(() => {
    const input = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ].find((i) => i.files?.length);
    const file = input?.files?.[0];
    return file ? { name: file.name, type: file.type, size: file.size } : null;
  });
  expect(attached?.name).toMatch(
    /^Jordan_Lee_Resume_Harbor_Mock_Ext_\d+\.pdf$/,
  );
  expect(attached?.type).toBe("application/pdf");
  expect(attached?.size).toBe(readFileSync(RESUME).length);

  // Written and anti-bot questions: flagged, empty.
  await expect(
    form.getByText("A written question: yours to answer.").first(),
  ).toBeVisible();
  await expect(
    form.getByText("Answer this yourself: Shipmate never answers these."),
  ).toBeVisible();
  const antibot = form.getByLabel(/decode this base64/i);
  await expect(antibot).toHaveValue("");
  await expect(form.getByLabel(/Why do you want to work/i)).toHaveValue("");

  // Nothing submitted, nothing sent.
  expect(
    await form.evaluate(() => (window as { __submits?: number }).__submits),
  ).toBe(0);
  expect(posts).toEqual([]);

  // "I submitted it" (the person did, by hand): applied, with this PDF.
  await panel(form).getByRole("button", { name: "I submitted it" }).click();
  await expect(panel(form)).toContainText("Set sail ✓");
  const row = await db
    .from("user_postings")
    .select("status, resume_used")
    .eq("id", item!.id)
    .single();
  expect(row.data?.status).toBe("applied");
  expect(row.data?.resume_used).toMatchObject({
    kind: "tailored",
    path: pdfPath,
    tailoring_id: tailoring!.id,
  });

  // The same page opened directly (no marker): nothing until asked.
  const direct = await context.newPage();
  await direct.goto(url);
  await expect(direct.getByLabel("First Name")).toBeVisible();
  await direct.waitForTimeout(2000);
  await expect(panel(direct)).toHaveCount(0);
  await expect(direct.getByLabel("First Name")).toHaveValue("");

  // The toolbar button (the same handler the popup calls).
  await direct.bringToFront();
  const worker = context.serviceWorkers()[0];
  const report = await worker.evaluate(() =>
    (
      globalThis as unknown as {
        shipmateFillActiveTab: () => Promise<{ ok: boolean; text: string }>;
      }
    ).shipmateFillActiveTab(),
  );
  expect(report).toEqual({
    ok: true,
    text: expect.stringContaining("Filled"),
  });
  await expect(panel(direct)).toBeVisible();
  await expect(direct.getByLabel("First Name")).toHaveValue("Jordan");
  expect(
    await direct.evaluate(() => (window as { __submits?: number }).__submits),
  ).toBe(0);

  // Workday: not supported, and it says so instead of doing anything.
  await context.route("https://acme.wd5.myworkdayjobs.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<form><label>First Name<input></label></form>",
    }),
  );
  const workday = await context.newPage();
  await workday.goto("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1");
  await workday.bringToFront();
  const refused = await worker.evaluate(() =>
    (
      globalThis as unknown as {
        shipmateFillActiveTab: () => Promise<{ ok: boolean; text: string }>;
      }
    ).shipmateFillActiveTab(),
  );
  expect(refused).toEqual({
    ok: false,
    text: expect.stringContaining("Workday forms aren't supported yet"),
  });
});
