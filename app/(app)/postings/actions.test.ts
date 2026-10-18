// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  prefetchQuestions: vi.fn(),
  client: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/auth/viewer", () => ({ requireMember: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mocks.client,
}));
vi.mock("@/lib/questions/prefetch", () => ({
  prefetchQuestions: mocks.prefetchQuestions,
}));

import { changeStatus } from "./actions";

const ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  mocks.after.mockReset();
  mocks.prefetchQuestions.mockReset();
  mocks.client.rpc.mockReset().mockResolvedValue({ error: null });
  mocks.client.from.mockReset().mockReturnValue({
    update: () => ({
      eq: () => ({ select: async () => ({ data: [{ id: ID }], error: null }) }),
    }),
  });
});

describe("changeStatus and the early prep (M9 §3)", () => {
  it("saving schedules the application form's fetch for after the response", async () => {
    expect(await changeStatus({ id: ID, status: "saved" })).toEqual({
      ok: true,
    });
    expect(mocks.after).toHaveBeenCalledOnce();
    // Nothing runs until Next runs the callback, after the answer has gone.
    expect(mocks.prefetchQuestions).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.prefetchQuestions).toHaveBeenCalledExactlyOnceWith(
      mocks.client,
      ID,
    );
  });

  it.each([
    { id: ID, status: "new" },
    { id: ID, status: "applied" },
    { id: ID, status: "skipped", skipReason: null },
  ] as const)("$status starts nothing", async (change) => {
    await changeStatus(change);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("a save that didn't happen starts nothing", async () => {
    mocks.client.from.mockReturnValue({
      update: () => ({
        eq: () => ({
          select: async () => ({ data: null, error: { message: "denied" } }),
        }),
      }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await changeStatus({ id: ID, status: "saved" })).toMatchObject({
      ok: false,
    });
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
