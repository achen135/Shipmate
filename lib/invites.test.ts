// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  formatInviteCode,
  isRedeemResult,
  normalizeInviteCode,
  redeemErrorMessage,
} from "./invites";

describe("invite codes", () => {
  it("normalises what people type", () => {
    expect(normalizeInviteCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizeInviteCode("ab cd\tef gh")).toBe("ABCDEFGH");
  });

  it("formats stored codes in two groups", () => {
    expect(formatInviteCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(formatInviteCode("SHORT")).toBe("SHORT");
  });

  it("maps every failure to a message and success to none", () => {
    expect(redeemErrorMessage("ok")).toBeNull();
    expect(redeemErrorMessage("already_invited")).toBeNull();
    for (const failure of [
      "invalid",
      "used",
      "revoked",
      "not_signed_in",
    ] as const) {
      expect(redeemErrorMessage(failure)).toMatch(/\w/);
    }
  });

  it("recognises only known results", () => {
    expect(isRedeemResult("used")).toBe(true);
    expect(isRedeemResult("nope")).toBe(false);
    expect(isRedeemResult(null)).toBe(false);
  });
});
