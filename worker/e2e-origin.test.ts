// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { withE2eOrigin } from "./e2e-origin";

const LOCAL = "http://127.0.0.1:54421";
const MOCK = "http://localhost:3101";

describe("withE2eOrigin", () => {
  it("redirects board APIs to the mock when both E2E and local Supabase", async () => {
    const base = vi.fn<typeof globalThis.fetch>(async () => new Response("ok"));
    const fetch = withE2eOrigin(base, {
      E2E_ATS_ORIGIN: MOCK,
      SUPABASE_URL: LOCAL,
    });
    await fetch(
      "https://boards-api.greenhouse.io/v1/boards/x/jobs?content=true",
    );
    expect(String(base.mock.calls[0][0])).toBe(
      `${MOCK}/v1/boards/x/jobs?content=true`,
    );
  });

  it("leaves GitHub calls alone", async () => {
    const base = vi.fn<typeof globalThis.fetch>(async () => new Response("ok"));
    const fetch = withE2eOrigin(base, {
      E2E_ATS_ORIGIN: MOCK,
      SUPABASE_URL: LOCAL,
    });
    await fetch("https://api.github.com/repos/a/b/commits");
    expect(String(base.mock.calls[0][0])).toBe(
      "https://api.github.com/repos/a/b/commits",
    );
  });

  it("does nothing against a hosted Supabase, even with the variable set", () => {
    const base = vi.fn<typeof globalThis.fetch>(async () => new Response("ok"));
    expect(
      withE2eOrigin(base, {
        E2E_ATS_ORIGIN: MOCK,
        SUPABASE_URL: "https://abc.supabase.co",
      }),
    ).toBe(base);
  });

  it("does nothing without the variable", () => {
    const base = vi.fn<typeof globalThis.fetch>(async () => new Response("ok"));
    expect(withE2eOrigin(base, { SUPABASE_URL: LOCAL })).toBe(base);
  });
});
