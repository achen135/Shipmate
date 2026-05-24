// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { retryOverloaded } from "./retry";
import { AiError } from "./types";

const overloaded = () =>
  new AiError("rate_limited", "Google's servers are briefly overloaded.", 503);

/** A clock that only moves when the retry sleeps. */
function fakeTime() {
  let t = 0;
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      t += ms;
    }),
  };
}

describe("retryOverloaded", () => {
  it("a 503 then an answer: the answer, after one retry it announced", async () => {
    const time = fakeTime();
    const onRetry = vi.fn();
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(overloaded())
      .mockResolvedValueOnce("resume");
    await expect(retryOverloaded(run, { ...time, onRetry })).resolves.toBe(
      "resume",
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(1);
    expect(time.sleep).toHaveBeenCalledExactlyOnceWith(3_000);
  });

  it("gives up after two retries and throws the overload, a few seconds apart", async () => {
    const time = fakeTime();
    const run = vi.fn(async () => {
      throw overloaded();
    });
    const error = await retryOverloaded(run, time).catch((e: unknown) => e);
    expect((error as AiError).status).toBe(503);
    expect(run).toHaveBeenCalledTimes(3);
    expect(time.sleep.mock.calls).toEqual([[3_000], [6_000]]);
  });

  it("never retries a 429 or a real failure", async () => {
    for (const error of [
      new AiError("rate_limited", "quota", 429),
      new AiError("invalid_key", "bad key", 401),
      new Error("crash"),
    ]) {
      const run = vi.fn(async () => {
        throw error;
      });
      await expect(retryOverloaded(run, fakeTime())).rejects.toBe(error);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });

  it("starts no retry past the time budget", async () => {
    let t = 0;
    const run = vi.fn(async () => {
      t += 118_000; // a long import that ended in a 503
      throw overloaded();
    });
    await expect(
      retryOverloaded(run, { now: () => t, sleep: async () => {} }),
    ).rejects.toBeInstanceOf(AiError);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
