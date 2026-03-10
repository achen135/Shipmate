// @vitest-environment node
import { describe, expect, it } from "vitest";

import { originFromHeaders } from "./origin";

describe("originFromHeaders", () => {
  it("prefers the forwarded host and proto (Vercel)", () => {
    const headers = new Headers({
      host: "internal",
      "x-forwarded-host": "shipmate-jobs.vercel.app",
      "x-forwarded-proto": "https",
    });
    expect(originFromHeaders(headers)).toBe("https://shipmate-jobs.vercel.app");
  });

  it("uses http for localhost", () => {
    expect(originFromHeaders(new Headers({ host: "localhost:3000" }))).toBe(
      "http://localhost:3000",
    );
  });

  it("defaults to https elsewhere", () => {
    expect(originFromHeaders(new Headers({ host: "example.com" }))).toBe(
      "https://example.com",
    );
  });
});
