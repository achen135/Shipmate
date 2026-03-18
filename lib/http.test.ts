// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { USER_AGENT, createPoliteFetch, retryAfterMs } from "./http";

const noSleep = vi.fn(async () => {});

describe("createPoliteFetch", () => {
  it("sends an identifying User-Agent", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await createPoliteFetch({ fetchImpl })("https://example.com/a");
    const init = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(new Headers(init[1].headers).get("user-agent")).toBe(USER_AGENT);
  });

  it("retries 429 and 5xx with exponential backoff, then succeeds", async () => {
    const responses = [
      new Response("", { status: 503 }),
      new Response("", { status: 429 }),
      new Response("ok"),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const sleep = vi.fn(async () => {});
    const res = await createPoliteFetch({ fetchImpl, sleep, baseDelayMs: 100 })(
      "https://example.com",
    );
    expect(await res.text()).toBe("ok");
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it("honours Retry-After", async () => {
    const responses = [
      new Response("", { status: 429, headers: { "retry-after": "3" } }),
      new Response("ok"),
    ];
    const sleep = vi.fn(async () => {});
    await createPoliteFetch({
      fetchImpl: async () => responses.shift()!,
      sleep,
    })("https://example.com");
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("returns the last error response once retries run out", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const res = await createPoliteFetch({
      fetchImpl,
      sleep: noSleep,
      retries: 2,
    })("https://example.com");
    expect(res.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("doesn't retry other client errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const res = await createPoliteFetch({ fetchImpl, sleep: noSleep })(
      "https://example.com",
    );
    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries network errors, then throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      createPoliteFetch({ fetchImpl, sleep: noSleep, retries: 1 })(
        "https://example.com",
      ),
    ).rejects.toThrow("fetch failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("limits concurrent requests per host", async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return new Response("ok");
    });
    const politeFetch = createPoliteFetch({ fetchImpl, perHost: 2 });
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => politeFetch(`https://a.com/${i}`)),
    );
    expect(peak).toBe(2);
  });
});

describe("retryAfterMs", () => {
  it("reads seconds and HTTP dates", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(
      retryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", Date.UTC(2026, 0, 1)),
    ).toBe(10_000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
  });
});
