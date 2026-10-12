import { expect, test } from "@playwright/test";

test("home page loads with the Shipmate brand", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Shipmate");
  await expect(
    page.getByRole("heading", { level: 1, name: /internship season/i }),
  ).toBeVisible();
  await expect(page.getByText("Shipmate", { exact: true })).toBeVisible();
});

test("privacy page is public and reachable from the footer", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Privacy" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Deleting your data" }),
  ).toBeVisible();
});

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ ok: true });
});
