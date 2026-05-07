import { describe, expect, it } from "vitest";

import { pdfPathFor, sharedModel } from "./tailor";

describe("the shared key's backup model (Flash-Lite)", () => {
  it("Flash until it says 429, then Flash-Lite, then wait for the next run", () => {
    expect(sharedModel({ mainBusy: false, backupBusy: false })).toBe("main");
    expect(sharedModel({ mainBusy: true, backupBusy: false })).toBe("backup");
    expect(sharedModel({ mainBusy: true, backupBusy: true })).toBe("wait");
  });
});

describe("tailored PDF paths", () => {
  it("every print gets its own path in the user's folder, under the posting", () => {
    const a = pdfPathFor("user", "posting", 1_000);
    const b = pdfPathFor("user", "posting", 2_000);
    expect(a).toMatch(/^user\/posting\/[a-z0-9]+\.pdf$/);
    expect(a).not.toBe(b);
  });
});
