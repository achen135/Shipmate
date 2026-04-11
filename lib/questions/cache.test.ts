import { describe, expect, it } from "vitest";

import { questionsAreFresh } from "./cache";

const now = Date.parse("2026-04-10T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe("questionsAreFresh", () => {
  it("is never fresh with nothing cached", () => {
    expect(questionsAreFresh(null, null, now)).toBe(false);
    expect(questionsAreFresh("ok", null, now)).toBe(false);
  });

  it("holds a success for a week", () => {
    expect(questionsAreFresh("ok", ago(6 * DAY), now)).toBe(true);
    expect(questionsAreFresh("ok", ago(8 * DAY), now)).toBe(false);
    expect(questionsAreFresh("unknown", ago(6 * DAY), now)).toBe(true);
    expect(questionsAreFresh("unknown", ago(8 * DAY), now)).toBe(false);
  });

  it("retries a failure after ten minutes", () => {
    expect(questionsAreFresh("failed", ago(5 * MIN), now)).toBe(true);
    expect(questionsAreFresh("failed", ago(11 * MIN), now)).toBe(false);
  });

  it("treats a bad timestamp as stale", () => {
    expect(questionsAreFresh("ok", "not a date", now)).toBe(false);
  });
});
