// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isGatedPath, safeRedirectPath } from "./routes";

describe("isGatedPath", () => {
  it.each([
    "/inbox",
    "/to-apply",
    "/tracker",
    "/profile",
    "/onboarding",
    "/onboarding/basics",
    "/admin/invites",
  ])("gates %s", (path) => {
    expect(isGatedPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/sign-in",
    "/auth/callback",
    "/api/health",
    "/inboxes",
    "/administrator",
  ])("leaves %s public", (path) => {
    expect(isGatedPath(path)).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeRedirectPath("/tracker?term=summer")).toBe(
      "/tracker?term=summer",
    );
  });

  it.each([
    null,
    undefined,
    "",
    "inbox",
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
  ])("falls back for %j", (value) => {
    expect(safeRedirectPath(value)).toBe("/inbox");
  });

  it("uses the given fallback", () => {
    expect(safeRedirectPath("//x", "/onboarding")).toBe("/onboarding");
  });
});
