/**
 * A short retry for a request someone is waiting on (resume import): a 503
 * from an overloaded model often clears within seconds. The SDKs have
 * already retried once by the time an error reaches here, so this adds a
 * couple more tries a few seconds apart, then gives up and lets the caller
 * show an honest "try again in a moment". Only overloads are retried: a 429
 * is a quota that seconds won't fix, and everything else is a real answer.
 */

import { isOverloaded } from "./errors";

export const OVERLOAD_RETRY_DELAYS_MS = [3_000, 6_000] as const;

/**
 * No retry starts once this much time has gone by: an import that ran a
 * minute and then got a 503 shouldn't run two more in a 300 s function.
 */
export const OVERLOAD_RETRY_BUDGET_MS = 120_000;

export type RetryOptions = {
  delaysMs?: readonly number[];
  budgetMs?: number;
  /** Called before each retry: 1 for the first. */
  onRetry?: (attempt: number) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function retryOverloaded<T>(
  run: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const delays = options.delaysMs ?? OVERLOAD_RETRY_DELAYS_MS;
  const budget = options.budgetMs ?? OVERLOAD_RETRY_BUDGET_MS;
  const sleep = options.sleep ?? wait;
  const now = options.now ?? Date.now;
  const start = now();
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const delay = delays[attempt];
      if (
        !isOverloaded(error) ||
        delay === undefined ||
        now() - start + delay > budget
      ) {
        throw error;
      }
      options.onRetry?.(attempt + 1);
      await sleep(delay);
    }
  }
}
