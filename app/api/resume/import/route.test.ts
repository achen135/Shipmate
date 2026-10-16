// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AiError,
  SHARED_BUSY_MESSAGE,
  SHARED_OVERLOADED_MESSAGE,
} from "@/lib/ai";

/**
 * POST /api/resume/import with everything around the AI call stubbed: a
 * signed-in user, a file that reads, the shared key, and an importResume
 * that answers however each test says. The retry's waits are skipped.
 */

const importResume = vi.fn();
const upsert = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/auth/viewer", () => ({
  getInvited: async () => ({ id: "user-1", invitedAt: "2026-10-01" }),
}));
vi.mock("@/lib/ai/keys", () => ({
  providerFor: async () => ({ name: "google", shared: true }),
}));
vi.mock("@/lib/resume/file", () => ({
  readResumeFile: async () => ({
    ok: true,
    text: "Jordan Lee\nExperience",
    kind: "docx",
    bold: [],
  }),
}));
vi.mock("@/lib/resume/import", () => ({
  importResume: (...args: unknown[]) => importResume(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ upsert }) }),
}));
vi.mock("@/lib/ai/retry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/retry")>();
  return {
    ...actual,
    retryOverloaded: <T>(
      run: () => Promise<T>,
      options: Parameters<typeof actual.retryOverloaded>[1] = {},
    ) => actual.retryOverloaded(run, { ...options, sleep: async () => {} }),
  };
});

const { POST } = await import("./route");

const overloaded = () =>
  new AiError(
    "rate_limited",
    "Google Gemini's servers are briefly overloaded. Try again in a moment.",
    503,
  );
const imported = {
  content: {
    header: { name: "Jordan Lee", email: "", phone: "", links: [] },
    sections: [{ title: "Experience", layout: "text", text: "" }],
  },
  notes: [],
  usage: {
    provider: "google",
    model: "gemini-3.8-flash",
    inputTokens: 1,
    outputTokens: 1,
  },
};

async function post() {
  const body = new FormData();
  body.set("file", new File(["x"], "resume.docx"));
  const response = await POST(
    new Request("http://localhost/api/resume/import", { method: "POST", body }),
  );
  const text = await response.text();
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    events: text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

beforeEach(() => {
  importResume.mockReset();
  upsert.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("POST /api/resume/import", () => {
  it("a 503 then an answer: says it's retrying while it happens, then saves", async () => {
    importResume
      .mockRejectedValueOnce(overloaded())
      .mockResolvedValueOnce(imported);
    const { status, type, events } = await post();
    expect(status).toBe(200);
    expect(type).toContain("application/x-ndjson");
    expect(events).toEqual([
      { retrying: "Google" },
      { ok: true, sections: ["Experience"], notes: 0 },
    ]);
    expect(importResume).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("a 503 that doesn't clear: an honest 'overloaded, try again', not an error with your setup", async () => {
    importResume.mockRejectedValue(overloaded());
    const { events } = await post();
    expect(events.filter((e) => "retrying" in e)).toHaveLength(2);
    expect(events.at(-1)).toEqual({
      ok: false,
      message: SHARED_OVERLOADED_MESSAGE,
    });
    expect(importResume).toHaveBeenCalledTimes(3);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("a real failure reads differently from an overload, and isn't retried", async () => {
    const badKey = new AiError(
      "invalid_key",
      "Google Gemini didn't accept this key.",
      400,
    );
    importResume.mockRejectedValue(badKey);
    const failed = await post();
    expect(failed.events).toEqual([{ ok: false, message: badKey.message }]);
    expect(importResume).toHaveBeenCalledTimes(1);

    importResume.mockReset().mockRejectedValue(overloaded());
    const busy = await post();
    expect(busy.events.at(-1)?.message).not.toBe(badKey.message);
  });

  it("a 429 on the shared key keeps its own message, and isn't retried here", async () => {
    importResume.mockRejectedValue(new AiError("rate_limited", "quota", 429));
    const { events } = await post();
    expect(events).toEqual([{ ok: false, message: SHARED_BUSY_MESSAGE }]);
    expect(importResume).toHaveBeenCalledTimes(1);
  });
});
