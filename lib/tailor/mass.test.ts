import { describe, expect, it } from "vitest";

import { dayLabel, planText, resultText } from "./mass";

describe("Tailor all: what it will do", () => {
  it("everything fits today", () => {
    expect(planText({ eligible: 3, remainingToday: 5, dailyCap: 10 })).toBe(
      "Tailors all 3 today.",
    );
    expect(planText({ eligible: 1, remainingToday: 5, dailyCap: 10 })).toBe(
      "Tailors it today.",
    );
  });

  it("more than today's cap: what fits now, the rest over the next days", () => {
    expect(planText({ eligible: 7, remainingToday: 3, dailyCap: 3 })).toBe(
      "Tailors 3 today; the other 4 wait for the next 2 days (your daily cap is 3).",
    );
    expect(planText({ eligible: 4, remainingToday: 0, dailyCap: 10 })).toBe(
      "Today's cap is used up; all 4 wait for the next day (your daily cap is 10).",
    );
  });

  it("nothing to do", () => {
    expect(planText({ eligible: 0, remainingToday: 5, dailyCap: 10 })).toMatch(
      /already tailored/,
    );
  });
});

describe("Tailor all: what it did", () => {
  it("says what started now, what waits and until when, and why", () => {
    expect(
      resultText({
        queuedToday: 1,
        queuedLater: 2,
        lastDay: "2026-10-19",
        already: 1,
        dailyCap: 2,
      }),
    ).toBe(
      "Tailoring 1 now. 2 more are queued for later days, the last on Mon, Oct 19, because your daily cap is 2. 1 posting was already tailored or being tailored.",
    );
  });

  it("all today", () => {
    expect(
      resultText({
        queuedToday: 4,
        queuedLater: 0,
        lastDay: null,
        already: 0,
        dailyCap: 10,
      }),
    ).toBe("Tailoring 4 now.");
  });

  it("nothing new", () => {
    expect(
      resultText({
        queuedToday: 0,
        queuedLater: 0,
        lastDay: null,
        already: 3,
        dailyCap: 10,
      }),
    ).toMatch(/^Nothing new to tailor/);
  });

  it("days read the same anywhere: the date, not the viewer's time zone", () => {
    expect(dayLabel("2026-10-20")).toBe("Tue, Oct 20");
  });
});
