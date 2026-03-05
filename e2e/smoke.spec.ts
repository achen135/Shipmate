import { expect, test } from "@playwright/test";

test("home page loads with the ShipMate brand", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("ShipMate");
  await expect(
    page.getByRole("heading", { level: 1, name: /internship season/i }),
  ).toBeVisible();
  await expect(page.getByText("ShipMate", { exact: true })).toBeVisible();
});

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ ok: true });
});
