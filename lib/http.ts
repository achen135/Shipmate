/**
 * Polite HTTP for the worker (CLAUDE.md "Politeness"): an identifying
 * User-Agent, a per-host concurrency limit, and exponential backoff on 429,
 * 5xx, and network errors (honouring Retry-After).
 */

export const USER_AGENT =
  "Shipmate/0.2 (+https://github.com/achen135/Shipmate; job-watcher)";

export type PoliteFetchOptions = {
  /** Retries after the first attempt. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Concurrent requests per host. */
  perHost?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Retry-After as seconds or an HTTP date → milliseconds, or null. */
export function retryAfterMs(
  header: string | null,
  now = Date.now(),
): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** A counting semaphore per host, so one slow board can't starve the rest. */
function hostLimiter(limit: number) {
  const hosts = new Map<string, { active: number; waiting: (() => void)[] }>();
  return async function run<T>(
    host: string,
    task: () => Promise<T>,
  ): Promise<T> {
    let slot = hosts.get(host);
    if (!slot) {
      slot = { active: 0, waiting: [] };
      hosts.set(host, slot);
    }
    const s = slot;
    if (s.active >= limit) {
      await new Promise<void>((resolve) => s.waiting.push(resolve));
    }
    s.active += 1;
    try {
      return await task();
    } finally {
      s.active -= 1;
      s.waiting.shift()?.();
    }
  };
}

export function createPoliteFetch(
  options: PoliteFetchOptions = {},
): typeof fetch {
  const {
    retries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    perHost = 2,
    timeoutMs = 30_000,
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = options;
  const limit = hostLimiter(perHost);

  return async function politeFetch(input, init) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);

    for (let attempt = 0; ; attempt += 1) {
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      let response: Response;
      try {
        response = await limit(url.host, () =>
          fetchImpl(url, {
            ...init,
            headers,
            signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
          }),
        );
      } catch (error) {
        if (attempt >= retries) throw error;
        await sleep(backoff);
        continue;
      }
      if (!retryable(response.status) || attempt >= retries) return response;
      // Free the connection before waiting.
      await response.body?.cancel();
      const hinted = retryAfterMs(response.headers.get("retry-after"));
      await sleep(Math.min(maxDelayMs, hinted ?? backoff));
    }
  };
}
