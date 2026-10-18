// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { loadQuestions } = vi.hoisted(() => ({ loadQuestions: vi.fn() }));
vi.mock("./load", () => ({ loadQuestions }));

import { prefetchQuestions } from "./prefetch";

const posting = {
  id: "p1",
  url: "https://boards.greenhouse.io/tidewater/jobs/1",
  canonical_url: "https://boards.greenhouse.io/tidewater/jobs/1",
  questions: null,
  questions_status: null,
  questions_fetched_at: null,
  company: { name: "Tidewater" },
};

function clientReturning(result: { data: unknown; error: unknown }) {
  const eq = vi.fn(() => ({ maybeSingle: async () => result }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, from, eq };
}

describe("prefetchQuestions (M9 §3)", () => {
  beforeEach(() => {
    loadQuestions
      .mockReset()
      .mockResolvedValue({ status: "ok", questions: [] });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("runs the review page's own load for that posting, on the client it was given", async () => {
    const { client, from, eq } = clientReturning({
      data: { posting },
      error: null,
    });
    expect(await prefetchQuestions(client, "up1")).toBe("fetched");
    expect(from).toHaveBeenCalledWith("user_postings");
    expect(eq).toHaveBeenCalledWith("id", "up1");
    expect(loadQuestions).toHaveBeenCalledExactlyOnceWith(posting, client);
  });

  it("does nothing for a row it can't see", async () => {
    const { client } = clientReturning({ data: null, error: null });
    expect(await prefetchQuestions(client, "gone")).toBe("missing");
    expect(loadQuestions).not.toHaveBeenCalled();
  });

  it("never throws: a failed read or a failed fetch is logged and left for the review page", async () => {
    const readFails = clientReturning({
      data: null,
      error: { code: "PGRST000" },
    });
    expect(await prefetchQuestions(readFails.client, "up1")).toBe("failed");

    loadQuestions.mockRejectedValue(new Error("boom"));
    const fetchFails = clientReturning({ data: { posting }, error: null });
    expect(await prefetchQuestions(fetchFails.client, "up1")).toBe("failed");
    // Codes and names only: nothing from the posting or the error message.
    for (const [message, detail] of vi.mocked(console.error).mock.calls) {
      expect(`${message} ${detail}`).not.toMatch(/greenhouse|Tidewater|boom/);
    }
  });
});
