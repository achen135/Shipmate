import { describe, expect, it } from "vitest";

import { tailoringDay } from "@/lib/tailor/mass";

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

describe("tailoring days", () => {
  it("are Eastern dates, like the cap", () => {
    // 03:30 UTC on 19 Oct is still 18 Oct in New York (EDT, UTC-4).
    expect(tailoringDay(Date.UTC(2026, 9, 19, 3, 30))).toBe("2026-10-18");
    expect(tailoringDay(Date.UTC(2026, 9, 19, 4, 30))).toBe("2026-10-19");
  });
});
