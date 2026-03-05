// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatWarning, loadWorkerConfig } from "./config";

describe("loadWorkerConfig", () => {
  it("returns config when both secrets are set", () => {
    expect(
      loadWorkerConfig({
        SUPABASE_URL: "https://abc.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
      }),
    ).toEqual({
      ok: true,
      config: {
        supabaseUrl: "https://abc.supabase.co",
        serviceRoleKey: "sb_secret_x",
      },
    });
  });

  it("falls back to NEXT_PUBLIC_SUPABASE_URL for local runs", () => {
    const result = loadWorkerConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://local.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "k",
    });
    expect(result.ok && result.config.supabaseUrl).toBe(
      "https://local.supabase.co",
    );
  });

  it("prefers SUPABASE_URL over the public fallback", () => {
    const result = loadWorkerConfig({
      SUPABASE_URL: "https://worker.supabase.co",
      NEXT_PUBLIC_SUPABASE_URL: "https://app.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "k",
    });
    expect(result.ok && result.config.supabaseUrl).toBe(
      "https://worker.supabase.co",
    );
  });

  it("lists every missing secret instead of throwing", () => {
    expect(loadWorkerConfig({})).toEqual({
      ok: false,
      missing: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    });
  });

  it("treats empty strings as missing (unset Actions secrets expand to '')", () => {
    expect(
      loadWorkerConfig({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }),
    ).toEqual({
      ok: false,
      missing: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    });
  });
});

describe("formatWarning", () => {
  it("emits a GitHub annotation inside Actions", () => {
    expect(formatWarning("hi", { GITHUB_ACTIONS: "true" })).toBe(
      "::warning title=Worker skipped::hi",
    );
  });

  it("emits plain text elsewhere", () => {
    expect(formatWarning("hi", {})).toBe("[worker] warning: hi");
  });
});
