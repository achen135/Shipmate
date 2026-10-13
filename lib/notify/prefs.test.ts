import { describe, expect, it } from "vitest";

import { readNotifyPrefs } from "./prefs";

describe("readNotifyPrefs", () => {
  it("defaults the email fallback to on", () => {
    expect(readNotifyPrefs({})).toEqual({ email: true });
    expect(readNotifyPrefs(null)).toEqual({ email: true });
    expect(readNotifyPrefs([])).toEqual({ email: true });
    expect(readNotifyPrefs({ email: "no" })).toEqual({ email: true });
  });

  it("honours an explicit off", () => {
    expect(readNotifyPrefs({ email: false })).toEqual({ email: false });
    expect(readNotifyPrefs({ email: true })).toEqual({ email: true });
  });
});
