// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports ok with the short commit on Vercel", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef");
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, commit: "0123456" });
  });

  it("reports a null commit outside Vercel", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    expect(await GET().json()).toEqual({ ok: true, commit: null });
  });
});
