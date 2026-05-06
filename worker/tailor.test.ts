import { describe, expect, it } from "vitest";

import { sharedModel } from "./tailor";

describe("the shared key's backup model (Flash-Lite)", () => {
  it("Flash until it says 429, then Flash-Lite, then wait for the next run", () => {
    expect(sharedModel({ mainBusy: false, backupBusy: false })).toBe("main");
    expect(sharedModel({ mainBusy: true, backupBusy: false })).toBe("backup");
    expect(sharedModel({ mainBusy: true, backupBusy: true })).toBe("wait");
  });
});
