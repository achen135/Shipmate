import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { andWaitForAction } from "./helpers/actions";
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
      },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
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
  const log = runTailorWorker();
  expect(log).toContain(`[tailor] ${queued.data!.id}: done`);

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

  const row = await admin
    .from("tailorings")
    .select(
      "state, score_before, score_after, missing, key_source, provider, est_cost, pdf_path, resume_content",
    )
    .eq("id", queued.data!.id)
    .single();
  expect(row.data).toMatchObject({
    state: "done",
    missing: ["Kafka"],
    key_source: "shared",
    provider: "google",
    est_cost: 0,
    pdf_path: `${user.id}/${postingId}.pdf`,
  });
  expect(row.data!.score_after).toBeGreaterThan(row.data!.score_before);
  expect(JSON.stringify(row.data!.resume_content)).not.toContain("Kafka");

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
