import type { Page } from "@playwright/test";

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
