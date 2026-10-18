import { join } from "node:path";

import {
  type Page,
  expect,
  request as playwrightRequest,
  test,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { andWaitForAction } from "./helpers/actions";
import {
  createTestUser,
  deleteCreatedUsers,
  localSupabaseAvailable,
  signIn,
} from "./helpers/local-auth";
import { finishBasics, finishOnboarding } from "./helpers/local-postings";

/*
 * AI foundation against local Supabase, with the AI providers mocked
 * (helpers/ats-mock-server.mjs; no real key, no real calls):
 * - a new account is in AI mode on the shared free key, with no key of its
 *   own (M7);
 * - add a key → the test call passes → "Anthropic key ending ####" → remove
 *   it → gone, still in AI mode on the shared key (and the database never
 *   held the key in the clear);
 * - a rejected key shows the provider's error and isn't saved, and an
 *   OpenAI error that echoes the key shows it redacted;
 * - import a Word resume with no key of your own (the shared Gemini key) →
 *   the editor has the same section names as the file, and the preview
 *   prints them;
 * - onboarding: resume step → fact bank step → What to watch.
 */
test.skip(
  !localSupabaseAvailable,
  "needs local Supabase (npm run test:e2e:local)",
);

const DOCX = join(__dirname, "../lib/resume/__fixtures__/sample-resume.docx");
const GOOD_KEY = "sk-ant-api03-e2e-valid-0000000000000000-7f3a";
const BAD_KEY = "sk-ant-api03-e2e-wrong-0000000000000000-0000";

const db = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

test.afterAll(async () => {
  await deleteCreatedUsers();
});

async function addKey(page: Page, key: string) {
  await page.getByRole("radio", { name: "Anthropic" }).click();
  const field = page.getByLabel("Anthropic API key");
  await field.fill(key);
  await andWaitForAction(page, () =>
    page.getByRole("button", { name: "Check and save" }).click(),
  );
}

test("add an Anthropic key, see it as 'ending ####', remove it", async ({
  page,
}) => {
  const user = await createTestUser("ai-key");
  await finishOnboarding(user.id);
  await signIn(page, user, "/profile/ai");

  await expect(
    page.getByRole("heading", { name: "AI", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("ai-mode")).toHaveText("AI mode is on");
  await expect(
    page.getByText(/Using Shipmate's shared free AI \(Google Gemini\)/),
  ).toBeVisible();
  await expect(page.getByText("What it costs")).toBeVisible();
  await expect(page.getByText(/What gets sent to Google/)).toBeVisible();
  await expect(page.getByText(/improve its products/)).toBeVisible();
  // On the shared key: a key of their own, offered as the next step.
  const nudge = page.getByTestId("own-key-nudge");
  await expect(nudge).toContainText("about 2 minutes, still $0");
  await expect(
    nudge.getByRole("link", { name: "Google AI Studio" }),
  ).toHaveAttribute("href", "https://aistudio.google.com/app/apikey");

  // A key the provider rejects: its error, and nothing saved.
  await addKey(page, BAD_KEY);
  await expect(
    page.getByText(/Anthropic didn't accept this key.*invalid x-api-key/),
  ).toBeVisible();
  const none = await db()
    .from("api_keys")
    .select("user_id")
    .eq("user_id", user.id);
  expect(none.data).toEqual([]);

  // A good one.
  await addKey(page, GOOD_KEY);
  await expect(page.getByTestId("saved-key")).toHaveText(
    "Anthropic key ending 7f3a",
  );
  await expect(
    page.getByText(/Using your Anthropic key ending 7f3a\./),
  ).toBeVisible();
  await expect(page.getByTestId("own-key-nudge")).toHaveCount(0);
  expect(await page.content()).not.toContain(GOOD_KEY);

  const stored = await db()
    .from("api_keys")
    .select("provider, ciphertext, iv, last4")
    .eq("user_id", user.id)
    .single();
  expect(stored.data?.provider).toBe("anthropic");
  expect(stored.data?.last4).toBe("7f3a");
  expect(stored.data?.ciphertext).not.toContain("e2e-valid");
  expect(
    Buffer.from(stored.data?.ciphertext ?? "", "base64").toString("latin1"),
  ).not.toContain("sk-ant");
  const profile = await db()
    .from("profiles")
    .select("mode, ai_provider")
    .eq("user_id", user.id)
    .single();
  expect(profile.data).toEqual({ mode: "ai", ai_provider: "anthropic" });

  // The daily cap saves.
  await page.getByLabel("Daily cap").fill("4");
  await andWaitForAction(page, () =>
    page.getByRole("button", { name: "Save", exact: true }).click(),
  );
  await expect(page.getByText("Saved.")).toBeVisible();

  // Remove it.
  await andWaitForAction(page, () =>
    page.getByRole("button", { name: "Remove key" }).click(),
  );
  await expect(page.getByTestId("saved-key")).toHaveCount(0);
  await expect(page.getByLabel("Anthropic API key")).toBeVisible();
  const gone = await db()
    .from("api_keys")
    .select("user_id")
    .eq("user_id", user.id);
  expect(gone.data).toEqual([]);
  const after = await db()
    .from("profiles")
    .select("mode")
    .eq("user_id", user.id)
    .single();
  expect(after.data?.mode).toBe("ai");
  await expect(page.getByText(/Using Shipmate's shared free AI/)).toBeVisible();
});

test("an OpenAI error that echoes the key shows it redacted", async ({
  page,
}) => {
  const user = await createTestUser("ai-openai");
  await finishOnboarding(user.id);
  await signIn(page, user, "/profile/ai");

  await page.getByRole("radio", { name: "OpenAI" }).click();
  const key = "sk-proj-e2e-wrong-0000000000000000-9c1e";
  await page.getByLabel("OpenAI API key").fill(key);
  await andWaitForAction(page, () =>
    page.getByRole("button", { name: "Check and save" }).click(),
  );
  await expect(
    page.getByText(
      /OpenAI didn't accept this key.*Incorrect API key provided: \[key\]/,
    ),
  ).toBeVisible();
  await expect(page.getByText(/sk-proj/)).toHaveCount(0);
});

test("import a Word resume with no key of your own (shared Gemini): same section names as the file", async ({
  page,
}) => {
  const user = await createTestUser("ai-import");
  await finishOnboarding(user.id);
  // The preview's first render fetches its font: listen from the start.
  const font = page.waitForResponse(
    (r) => r.url().endsWith("/fonts/cmu-serif/cmu-serif-500-roman.woff2"),
    { timeout: 60_000 },
  );
  await signIn(page, user, "/profile/resume");
  await expect(
    page.getByRole("heading", { name: "Structured resume" }),
  ).toBeVisible();
  const picker = page.locator('input[type="file"]');
  await expect(async () => {
    await picker.setInputFiles([]);
    await picker.setInputFiles(DOCX);
    await expect(page.getByLabel("Section title").first()).toBeVisible({
      timeout: 5000,
    });
  }).toPass({ timeout: 30_000 });

  const titles = page.getByLabel("Section title");
  await expect(titles).toHaveCount(2);
  await expect(titles.nth(0)).toHaveValue("Selected Work");
  await expect(titles.nth(1)).toHaveValue("Where I've Studied");

  // The preview prints the same headings (desktop shows it alongside; the
  // phone layout behind the Preview tab).
  const previewTab = page.getByRole("tab", { name: "Preview" });
  if (await previewTab.isVisible()) await previewTab.click();
  const preview = page.frameLocator('iframe[title="Resume preview"]');
  await expect(preview.getByRole("heading", { level: 2 })).toHaveText([
    "Selected Work",
    "Where I've Studied",
  ]);
  // It loads the PDF's own font (CMU Serif) from /fonts, from the sandbox's
  // opaque origin and without the session, so it looks like the PDF anywhere.
  const fontResponse = await font;
  expect(fontResponse.status()).toBe(200);
  expect(fontResponse.headers()["access-control-allow-origin"]).toBe("*");
  expect(fontResponse.headers()["content-type"]).toContain("font/woff2");
  const signedOut = await playwrightRequest.newContext({
    baseURL: page.url(),
  });
  const direct = await signedOut.get(
    "/fonts/cmu-serif/cmu-serif-700-roman.woff2",
    {
      maxRedirects: 0,
    },
  );
  expect(direct.status()).toBe(200);
  await signedOut.dispose();

  const row = await db()
    .from("resumes")
    .select("kind, content")
    .eq("user_id", user.id)
    .single();
  expect(row.data?.kind).toBe("structured");
  expect(
    (row.data?.content as { sections: { title: string }[] }).sections.map(
      (s) => s.title,
    ),
  ).toEqual(["Selected Work", "Where I've Studied"]);

  // Edit and save.
  const editTab = page.getByRole("tab", { name: "Edit" });
  if (await editTab.isVisible()) await editTab.click();
  await titles.nth(0).fill("Selected Projects");
  await andWaitForAction(page, () =>
    page.getByRole("button", { name: "Save resume" }).click(),
  );
  await expect(page.getByText("All changes saved")).toBeVisible();
  const saved = await db()
    .from("resumes")
    .select("content")
    .eq("user_id", user.id)
    .single();
  expect(
    (saved.data?.content as { sections: { title: string }[] }).sections[0]
      .title,
  ).toBe("Selected Projects");
});

test("onboarding: resume step in AI mode, then the fact bank, then What to watch", async ({
  page,
}) => {
  const user = await createTestUser("ai-onboard");
  await finishBasics(user.id);
  await signIn(page, user, "/inbox");

  await expect(page).toHaveURL(/\/onboarding\/resume$/);
  await expect(page.getByText("Step 3")).toBeVisible();
  await expect(page.getByTestId("ai-mode")).toHaveText("AI mode is on");
  const picker = page.locator('input[type="file"]').last();
  await expect(async () => {
    await picker.setInputFiles([]);
    await picker.setInputFiles(DOCX);
    await expect(page.getByText(/Read 2 sections/)).toBeVisible({
      timeout: 5000,
    });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/facts$/);
  await expect(page.getByText("Step 4")).toBeVisible();
  await page.getByLabel("What is it?").fill("Figma prototyping");
  await andWaitForAction(page, () =>
    page.getByRole("button", { name: "Add", exact: true }).click(),
  );
  await expect(page.getByText("Figma prototyping")).toBeVisible();
  const facts = await db()
    .from("fact_bank")
    .select("kind, content, source")
    .eq("user_id", user.id);
  expect(facts.data).toEqual([
    { kind: "skill", content: { text: "Figma prototyping" }, source: "manual" },
  ]);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/watch$/);
  await expect(page.getByText("Step 5")).toBeVisible();
});
