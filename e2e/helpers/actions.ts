import { type Page, expect } from "@playwright/test";

/**
 * Run `act` (a click that fires a Server Action) and wait until the action's
 * response is back.
 *
 * Posting cards show their new state straight away (the UI is optimistic) and
 * the write finishes a moment later. A test that treats "Saved to To Apply" as
 * proof and navigates at once can reach the next page before the write has
 * committed, and that page then correctly shows the old data. Under load this
 * was the cause of the tracker and inbox specs' occasional failures: the
 * database was right, the test was early. Waiting for the action's POST
 * (Next marks it with a `next-action` header) removes the race without a sleep.
 */
export async function andWaitForAction(
  page: Page,
  act: () => Promise<unknown>,
): Promise<void> {
  const done = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().headers()["next-action"] !== undefined,
  );
  await act();
  await done;
}

/** Keep the application tabs the tests open from reaching the real sites. */
export async function blockExternal(page: Page): Promise<void> {
  await page
    .context()
    .route(/^https:\/\/(boards\.greenhouse\.io|example\.com)\//, (route) =>
      route.fulfill({ status: 200, body: "an application page" }),
    );
}

/** Click Apply (opens a tab), close it, come back: what a person does. */
export async function applyAndReturn(page: Page): Promise<void> {
  await expect(async () => {
    const popup = page.waitForEvent("popup");
    await page.getByRole("link", { name: "Apply", exact: true }).click();
    await (await popup).close();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("alertdialog", { name: "Did you submit?" }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass();
}
