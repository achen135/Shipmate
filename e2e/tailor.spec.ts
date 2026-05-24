import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { lastFour, sealApiKey } from "../lib/ai/crypto";

import {
  andWaitForAction,
  applyAndReturn,
  blockExternal,
} from "./helpers/actions";
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
 * Tailoring against local Supabase, with the AI mocked
 * (helpers/ats-mock-server.mjs answers like Gemini): a user with no key of
 * their own (the shared free key) presses "Tailor this" → the worker runs
 * (by hand here; in production the database starts tailor.yml) → the review
 * page shows the before → after score, what changed, and the PDF →
 * "Edit this copy" changes the copy and never the master resume → at the
 * daily cap, "Tailor again" is refused before anything is spent.
 */
test.skip(
  !localSupabaseAvailable,
  "needs local Supabase (npm run test:e2e:local)",
);

const MOCK_ORIGIN = "http://localhost:3101";

/**
 * The worker's master key for keys sealed in these tests (the web server
 * never opens them, so it needn't match the server's). Fixed, not random:
 * every worker run, from any Playwright worker process, gets the same one,
 * so any run can take any row.
 */
const WORKER_MASTER_KEY = Buffer.from(
  "e2e-only-worker-master-key-32-b!",
  "utf8",
);

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

function runTailorWorker(): string {
  return execFileSync(
    process.execPath,
    ["--import", "tsx", "worker/tailor-main.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        E2E_ATS_ORIGIN: MOCK_ORIGIN,
        E2E_AI_ORIGIN: MOCK_ORIGIN,
        API_KEY_ENCRYPTION_KEY: WORKER_MASTER_KEY.toString("base64"),
      },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
}

/**
 * Run the worker until this row is finished. The queue is shared, so a
 * worker another test (or the other viewport) started may take this row:
 * the row's state is what's checked, not one run's log.
 */
async function tailorUntilFinished(id: string): Promise<string> {
  let log = "";
  for (let i = 0; i < 4; i += 1) {
    log += runTailorWorker();
    const { data } = await db()
      .from("tailorings")
      .select("state")
      .eq("id", id)
      .single();
    if (data?.state === "done" || data?.state === "failed") return log;
  }
  throw new Error(`tailoring ${id} didn't finish:\n${log}`);
}

const MASTER = {
  header: {
    name: "Jordan Lee",
    email: "jordan@example.edu",
    phone: "",
    links: [],
  },
  sections: [
    {
      title: "Experience",
      layout: "entries",
      items: [
        {
          heading: "Harbor Labs",
          subheading: "Software Engineering Intern (Python, Git)",
          dates: "Summer 2025",
          location: "Boston, MA",
          bullets: [
            "Built REST APIs in Python for the pricing service",
            "Wrote SQL reports for the finance team",
          ],
        },
      ],
    },
    {
      title: "Technical Skills",
      layout: "list",
      items: [{ label: "Tools", values: ["Docker", "Git", "SQL", "Python"] }],
    },
  ],
};

const DESCRIPTION = `About the role
Join our platform team as a Backend Intern. You will design REST APIs in Python, write SQL, and ship with Git and Docker.

Requirements
- Python and SQL
- REST APIs and Git

Nice to have
- Kubernetes and Kafka
- Docker
${"We move cargo across the world's ports. ".repeat(6)}`;

test("tailor a posting on the shared key: score, changes, PDF, edit the copy, daily cap", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const tag = `t${info.project.name.length}${Date.now().toString(36)}`;
  const user = await createTestUser(`tailor-${tag}`);
  await finishOnboarding(user.id);
  const admin = db();
  await admin
    .from("profiles")
    .update({ mode: "ai", daily_cap: 1, name: "Jordan Lee" })
    .eq("user_id", user.id);
  await admin
    .from("resumes")
    .insert({ user_id: user.id, kind: "structured", content: MASTER });
  await admin.from("fact_bank").insert({
    user_id: user.id,
    kind: "skill",
    content: { text: "Kubernetes" },
  });
  const [postingId] = await seedPostings(`Tidewater ${tag}`, [
    {
      title: "Backend Intern",
      category: "Software",
      daysAgo: 1,
      description: DESCRIPTION,
    },
  ]);
  await addToInbox(user.id, postingId);

  await signIn(page, user, `/postings/${postingId}`);
  await page.getByRole("button", { name: "Tailor this" }).click();
  await expect(page.getByText(/Charting course/)).toBeVisible();

  const queued = await admin
    .from("tailorings")
    .select("id, state")
    .eq("user_id", user.id)
    .single();
  expect(queued.data?.state).toBe("queued");

  // The worker (the database would have started tailor.yml in production).
  await tailorUntilFinished(queued.data!.id);

  // The page refreshes itself while it waits.
  await expect(page.getByTestId("fit-score")).toHaveText(/^\d+% → \d+%$/, {
    timeout: 15_000,
  });
  const changes = page.getByTestId("changes");
  await expect(changes).toContainText("Added “Kubernetes” to Tools");
  await expect(changes).toContainText("from your profile facts");
  // Kafka is MISSING: the mock model tried to add it; the check dropped it.
  await expect(changes).not.toContainText("Kafka");
  await expect(
    page.getByText(/The posting asks for Kafka.*Shipmate didn't add it/),
  ).toBeVisible();
  // A second look: noticed, shown apart from what changed, never applied.
  const look = page.getByTestId("second-look");
  await expect(look).toContainText("A second look");
  await expect(look).toContainText("start with “Built”");
  await expect(changes).not.toContainText("Designed");

  const row = await admin
    .from("tailorings")
    .select(
      "state, score_before, score_after, missing, key_source, provider, est_cost, pdf_path, resume_content, suggestions",
    )
    .eq("id", queued.data!.id)
    .single();
  expect(row.data).toMatchObject({
    state: "done",
    missing: ["Kafka"],
    key_source: "shared",
    provider: "google",
    est_cost: 0,
    pdf_path: expect.stringMatching(
      new RegExp(`^${user.id}/${postingId}/[a-z0-9]+\\.pdf$`),
    ),
  });
  expect(row.data!.score_after).toBeGreaterThan(row.data!.score_before);
  expect(JSON.stringify(row.data!.resume_content)).not.toContain("Kafka");
  expect(row.data!.suggestions).toHaveLength(1);
  expect(JSON.stringify(row.data!.resume_content)).not.toContain("Designed");

  // The PDF, named First_Last_Resume_Company.pdf.
  const pdfHref = await page
    .getByRole("link", { name: "Open PDF" })
    .getAttribute("href");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdf.headers()["content-disposition"]).toContain(
    `filename="Jordan_Lee_Resume_Tidewater_${tag}.pdf"`,
  );
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Edit this copy: the copy changes, the master never does.
  await page.getByRole("link", { name: "Edit this copy" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit this copy" }),
  ).toBeVisible();
  const titles = page.getByLabel("Section title");
  await expect(titles.first()).toHaveValue("Experience");
  const bullets = page.getByLabel("Bullets, one per line").first();
  await bullets.fill(
    "Built REST APIs in Python for the pricing service, by hand\nWrote SQL reports for the finance team",
  );
  await andWaitForAction(page, () =>
    page.getByRole("button", { name: "Save this copy" }).click(),
  );
  await expect(page.getByText("All changes saved")).toBeVisible();
  const copy = await admin
    .from("tailorings")
    .select("resume_content, edited_at, pdf_requested_at")
    .eq("id", queued.data!.id)
    .single();
  expect(JSON.stringify(copy.data?.resume_content)).toContain("by hand");
  expect(copy.data?.pdf_requested_at).not.toBeNull();
  const master = await admin
    .from("resumes")
    .select("content")
    .eq("user_id", user.id)
    .single();
  expect(master.data?.content).toEqual(MASTER);

  // The Inbox card shows the fit score after tailoring.
  await page.goto("/inbox");
  const card = page
    .getByTestId("posting-card")
    .filter({ hasText: `Tidewater ${tag}` });
  await expect(card.getByTestId("card-fit-score")).toHaveText(
    `Fit ${row.data!.score_after}%`,
  );

  // Apply → "Did you submit?" → Yes: the tailored PDF is recorded as the
  // one sent, at its own path. (The edited copy above hasn't been printed
  // yet, so what was downloadable, and recorded, is the first print.)
  await blockExternal(page);
  await page.goto(`/postings/${postingId}`);
  await applyAndReturn(page);
  await page.getByRole("button", { name: "Yes, I applied" }).click();
  await expect(page.getByText("In your Tracker: Applied")).toBeVisible();
  const applied = await admin
    .from("user_postings")
    .select("id, resume_used")
    .eq("user_id", user.id)
    .eq("posting_id", postingId)
    .single();
  expect(applied.data?.resume_used).toMatchObject({
    kind: "tailored",
    bucket: "pdfs",
    path: row.data!.pdf_path,
    tailoring_id: queued.data!.id,
  });
  await page.goto(`/tracker/${applied.data!.id}`);
  await expect(page.getByTestId("resume-used")).toContainText(
    "Resume sent: Your tailored resume for this posting",
  );

  // Printing the edited copy writes a new file; the recorded one stays.
  runTailorWorker();
  await expect
    .poll(
      async () =>
        (
          await admin
            .from("tailorings")
            .select("pdf_path, pdf_requested_at")
            .eq("id", queued.data!.id)
            .single()
        ).data,
    )
    .toMatchObject({ pdf_requested_at: null });
  const reprinted = await admin
    .from("tailorings")
    .select("pdf_path")
    .eq("id", queued.data!.id)
    .single();
  expect(reprinted.data?.pdf_path).not.toBe(row.data!.pdf_path);
  const sent = await page.request.get(
    `/api/applications/${applied.data!.id}/resume`,
  );
  expect(sent.headers()["content-type"]).toBe("application/pdf");
  const kept = await admin.storage.from("pdfs").download(row.data!.pdf_path);
  expect(kept.error).toBeNull();

  // Usage today, on the AI screen.
  await page.goto("/profile/ai");
  await expect(page.getByTestId("used-today")).toHaveText(
    /^Today: 1 of 1 tailored\./,
  );

  // At the cap (1 a day): refused before anything is queued.
  await page.goto(`/postings/${postingId}`);
  await page.getByRole("button", { name: "Tailor again" }).click();
  await expect(
    page.getByText(/You've reached your daily cap of 1 tailored posting/),
  ).toBeVisible();
  const count = await admin
    .from("tailorings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  expect(count.count).toBe(1);
});

// Out of quota (429) and overloaded (503) are the same "come back later":
// either way the backup model takes the row at once.
for (const [why, marker] of [
  ["out of quota (429)", "E2E-FLASH-BUSY"],
  ["overloaded (503)", "E2E-FLASH-OVERLOADED"],
] as const) {
  test(`the shared key's main model is ${why}: the backup model tailors it, and the page says so`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const tag = `b${info.project.name.length}${Date.now().toString(36)}`;
    const user = await createTestUser(`tailor-${tag}`);
    await finishOnboarding(user.id);
    const admin = db();
    await admin
      .from("profiles")
      .update({ mode: "ai", daily_cap: 2, name: "Jordan Lee" })
      .eq("user_id", user.id);
    await admin
      .from("resumes")
      .insert({ user_id: user.id, kind: "structured", content: MASTER });
    await admin.from("fact_bank").insert({
      user_id: user.id,
      kind: "skill",
      content: { text: "Kubernetes" },
    });
    const [postingId] = await seedPostings(`Seaway ${tag}`, [
      {
        title: "Backend Intern",
        category: "Software",
        daysAgo: 1,
        // The mock answers 429 or 503 for gemini-3.8-flash on this posting.
        description: `${DESCRIPTION}\n${marker}`,
      },
    ]);
    await addToInbox(user.id, postingId);

    await signIn(page, user, `/postings/${postingId}`);
    await page.getByRole("button", { name: "Tailor this" }).click();
    await expect(page.getByText(/Charting course/)).toBeVisible();

    let rowId = "";
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("tailorings")
          .select("id")
          .eq("user_id", user.id);
        rowId = data?.[0]?.id ?? "";
        return data?.length;
      })
      .toBe(1);
    await tailorUntilFinished(rowId);

    const row = await admin
      .from("tailorings")
      .select("state, model, key_source, est_cost, rate_limited_at")
      .eq("user_id", user.id)
      .single();
    expect(row.data).toMatchObject({
      state: "done",
      model: "gemini-3.5-flash-lite",
      key_source: "shared",
      est_cost: 0,
      rate_limited_at: null,
    });
    await expect(page.getByTestId("fit-score")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("own-key-hint")).toContainText(
      "ran on its backup model (Gemini 3.5 Flash-Lite)",
    );
  });
}

test("a model overloaded (503) past every retry: the tailoring waits for the next run, never failed", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const tag = `o${info.project.name.length}${Date.now().toString(36)}`;
  const user = await createTestUser(`tailor-${tag}`);
  await finishOnboarding(user.id);
  const admin = db();
  await admin
    .from("profiles")
    .update({ mode: "ai", daily_cap: 2, name: "Jordan Lee" })
    .eq("user_id", user.id);
  await admin
    .from("resumes")
    .insert({ user_id: user.id, kind: "structured", content: MASTER });
  // The user's own Gemini key, not the shared one: a shared-key row that
  // can only wait would make whichever run takes it skip every other
  // shared-key row (other tests' too). The same code queues both kinds.
  const ownKey = "AIza-own-e2e-valid-overloaded-0000";
  await admin.from("api_keys").insert({
    user_id: user.id,
    provider: "google",
    ...sealApiKey(
      ownKey,
      { userId: user.id, provider: "google" },
      WORKER_MASTER_KEY,
    ),
    last4: lastFour(ownKey),
  });
  const [postingId] = await seedPostings(`Overcast ${tag}`, [
    {
      title: "Backend Intern",
      category: "Software",
      daysAgo: 1,
      // The mock answers 503 for every Gemini model on this posting.
      description: `${DESCRIPTION}\nE2E-ALL-OVERLOADED`,
    },
  ]);
  await addToInbox(user.id, postingId);

  await signIn(page, user, `/postings/${postingId}`);
  await page.getByRole("button", { name: "Tailor this" }).click();
  await expect(page.getByText(/Charting course/)).toBeVisible();

  let rowId = "";
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("tailorings")
        .select("id")
        .eq("user_id", user.id);
      rowId = data?.[0]?.id ?? "";
      return data?.length;
    })
    .toBe(1);
  runTailorWorker();
  // Whichever run took it (the queue is shared), it's back in the queue as
  // waiting, not failed, and the attempt wasn't spent.
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("tailorings")
        .select("state, error, attempts, key_source, rate_limited_at")
        .eq("id", rowId)
        .single();
      return {
        state: data?.state,
        error: data?.error,
        attempts: data?.attempts,
        key_source: data?.key_source,
        waiting: Boolean(data?.rate_limited_at),
      };
    })
    .toEqual({
      state: "queued",
      error: null,
      attempts: 0,
      key_source: "own",
      waiting: true,
    });
  await page.reload();
  await expect(page.getByText(/^Waiting:/)).toBeVisible({ timeout: 15_000 });
  await admin.from("tailorings").delete().eq("id", rowId);
});
