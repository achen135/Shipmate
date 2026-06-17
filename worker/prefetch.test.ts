// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MIN_POSTING_CHARS } from "@/lib/tailor/score";

import type { Db } from "./db";
import {
  MAX_PER_RUN,
  RETRY_AFTER_MS,
  needingText,
  prefetchSavedText,
} from "./prefetch";

const { fetchPostingText } = vi.hoisted(() => ({ fetchPostingText: vi.fn() }));
vi.mock("@/lib/tailor/posting-text", () => ({ fetchPostingText }));

const NOW = Date.UTC(2026, 9, 18, 12);
const LONG = "x".repeat(MIN_POSTING_CHARS);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const posting = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  url: `https://example.com/${id}`,
  canonical_url: `https://example.com/${id}`,
  company: { name: "Tidewater" },
  description: null,
  fetched_description: null,
  description_fetched_at: null,
  ...over,
});

describe("needingText: which postings still want their text fetched", () => {
  it("skips ones the source already described, or an earlier fetch filled", () => {
    const wanted = needingText(
      [
        posting("a", { description: LONG }),
        posting("b", { fetched_description: LONG }),
        posting("c", { description: "short blurb" }),
        posting("d"),
      ],
      NOW,
    );
    expect(wanted.map((p) => p.id).sort()).toEqual(["c", "d"]);
  });

  it("doesn't retry an empty fetch for a few hours, then does", () => {
    const fresh = posting("a", { description_fetched_at: ago(60_000) });
    const edge = posting("b", {
      description_fetched_at: ago(RETRY_AFTER_MS - 1),
    });
    const due = posting("c", { description_fetched_at: ago(RETRY_AFTER_MS) });
    expect(needingText([fresh, edge, due], NOW).map((p) => p.id)).toEqual([
      "c",
    ]);
  });

  it("goes never-tried first, then the longest waiting", () => {
    const order = needingText(
      [
        posting("old", { description_fetched_at: ago(RETRY_AFTER_MS * 3) }),
        posting("never"),
        posting("older", { description_fetched_at: ago(RETRY_AFTER_MS * 5) }),
      ],
      NOW,
    ).map((p) => p.id);
    expect(order).toEqual(["never", "older", "old"]);
  });
});

/**
 * A stand-in for the service-role client: each table answers its select with
 * what the test set, and every update is recorded. (The real filters are
 * PostgREST's; E2E runs the whole thing against the local database.)
 */
function fakeDb(tables: {
  user_postings: { user_id: string; posting_id: string | null }[];
  profiles: { user_id: string }[];
  postings: ReturnType<typeof posting>[];
}) {
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  const db = {
    from(table: keyof typeof tables) {
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          if (column === "id") {
            return {
              then: (resolve: (r: { error: null }) => void) =>
                resolve({ error: null }),
              _id: value,
            };
          }
          return builder;
        },
        in: () => builder,
        limit: () => builder,
        update: (values: Record<string, unknown>) => ({
          eq: async (_: string, id: string) => {
            updates.push({ id, values });
            return { error: null };
          },
        }),
        then: (resolve: (r: { data: unknown; error: null }) => void) =>
          resolve({ data: tables[table], error: null }),
      };
      return builder;
    },
    rpc: async () => ({ data: [] }),
  };
  return { db: db as unknown as Db, updates };
}

describe("prefetchSavedText", () => {
  // Braces matter: beforeEach calls whatever function its callback returns,
  // and mockReset() returns the mock itself.
  beforeEach(() => {
    fetchPostingText.mockReset();
  });

  it("fetches and stores the text, and records a miss so it isn't retried at once", async () => {
    fetchPostingText.mockImplementation(async (p: { url: string }) =>
      p.url.endsWith("/hit") ? "The full posting." : null,
    );
    const { db, updates } = fakeDb({
      user_postings: [
        { user_id: "u1", posting_id: "hit" },
        { user_id: "u1", posting_id: "miss" },
      ],
      profiles: [{ user_id: "u1" }],
      postings: [posting("hit"), posting("miss")],
    });
    const stats = await prefetchSavedText(db, {
      fetch,
      deadline: Date.now() + 60_000,
      now: NOW,
    });
    expect(stats).toEqual({ due: 2, fetched: 1, empty: 1, left: 0 });
    expect(updates.map((u) => u.id).sort()).toEqual(["hit", "miss"]);
    const hit = updates.find((u) => u.id === "hit")!;
    expect(hit.values.fetched_description).toBe("The full posting.");
    expect(typeof hit.values.description_fetched_at).toBe("string");
    const miss = updates.find((u) => u.id === "miss")!;
    expect(miss.values.fetched_description).toBeNull();
    expect(typeof miss.values.description_fetched_at).toBe("string");
  });

  it("only looks at postings saved by people in AI mode", async () => {
    const { db } = fakeDb({
      user_postings: [
        { user_id: "simple", posting_id: "a" },
        { user_id: "ai", posting_id: "b" },
      ],
      profiles: [{ user_id: "ai" }],
      postings: [posting("a"), posting("b")],
    });
    // The fake's postings table ignores .in(), so check the ids asked for.
    const asked: string[][] = [];
    const real = db.from.bind(db);
    db.from = ((table: string) => {
      const builder = real(table as never) as unknown as {
        in: (c: string, v: string[]) => unknown;
      };
      const original = builder.in;
      builder.in = (column, values) => {
        if (table === "postings") asked.push(values);
        return original(column, values);
      };
      return builder;
    }) as never;
    fetchPostingText.mockResolvedValue(null);
    await prefetchSavedText(db, { fetch, deadline: Date.now() + 60_000 });
    expect(asked).toEqual([["b"]]);
  });

  it("does nothing when nothing is saved", async () => {
    const { db, updates } = fakeDb({
      user_postings: [],
      profiles: [],
      postings: [],
    });
    expect(
      await prefetchSavedText(db, { fetch, deadline: Date.now() + 60_000 }),
    ).toEqual({ due: 0, fetched: 0, empty: 0, left: 0 });
    expect(fetchPostingText).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it(`takes at most ${MAX_PER_RUN} a run, and says how many are left`, async () => {
    const ids = Array.from({ length: MAX_PER_RUN + 5 }, (_, i) => `p${i}`);
    fetchPostingText.mockResolvedValue("text");
    const { db, updates } = fakeDb({
      user_postings: ids.map((id) => ({ user_id: "u", posting_id: id })),
      profiles: [{ user_id: "u" }],
      postings: ids.map((id) => posting(id)),
    });
    const stats = await prefetchSavedText(db, {
      fetch,
      deadline: Date.now() + 60_000,
      now: NOW,
    });
    expect(stats.fetched).toBe(MAX_PER_RUN);
    expect(stats.left).toBe(5);
    expect(updates).toHaveLength(MAX_PER_RUN);
  });

  it("stops at its deadline", async () => {
    fetchPostingText.mockResolvedValue("text");
    const { db, updates } = fakeDb({
      user_postings: [{ user_id: "u", posting_id: "a" }],
      profiles: [{ user_id: "u" }],
      postings: [posting("a")],
    });
    const stats = await prefetchSavedText(db, {
      fetch,
      deadline: Date.now() - 1,
      now: NOW,
    });
    expect(stats).toEqual({ due: 1, fetched: 0, empty: 0, left: 1 });
    expect(updates).toEqual([]);
  });
});
