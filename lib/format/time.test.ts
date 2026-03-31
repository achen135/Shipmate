// @vitest-environment node
import { describe, expect, it } from "vitest";

import { dayKey, dayLabel, formatCalendarDate, formatRelative } from "./time";

// 2026-10-10 15:00 UTC = 10:00 in Chicago (CDT).
const NOW = Date.UTC(2026, 9, 10, 15, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("formatRelative", () => {
  it("scales from minutes to days, then a date", () => {
    expect(formatRelative(ago(20_000), NOW)).toBe("just now");
    expect(formatRelative(ago(12 * 60_000), NOW)).toBe("12m ago");
    expect(formatRelative(ago(3 * 3_600_000 + 1), NOW)).toBe("3h ago");
    expect(formatRelative(ago(5 * 86_400_000), NOW)).toBe("5d ago");
    expect(formatRelative("2026-03-04T18:00:00Z", NOW)).toBe("Mar 4");
  });
});

describe("dayKey / dayLabel", () => {
  it("groups by the app time zone's calendar day", () => {
    // 03:00 UTC on Oct 10 is still Oct 9 in Chicago.
    expect(dayKey("2026-10-10T03:00:00Z")).toBe("2026-10-09");
    expect(dayKey("2026-10-10T06:00:00Z")).toBe("2026-10-10");
  });

  it("labels today, yesterday, and older days", () => {
    expect(dayLabel("2026-10-10", NOW)).toBe("Today");
    expect(dayLabel("2026-10-09", NOW)).toBe("Yesterday");
    expect(dayLabel("2026-10-05", NOW)).toBe("Monday, Oct 5");
  });
});

describe("formatCalendarDate", () => {
  it("keeps the calendar day whatever the time zone", () => {
    expect(formatCalendarDate("2026-09-19")).toBe("Sep 19");
    expect(formatCalendarDate("2026-01-01", true)).toBe("Jan 1, 2026");
  });
});
