// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Db } from "./db";
import { type InboxRow, insertInboxRows, planMatches } from "./match";

function profile(id: string, userId: string, categories: string[]) {
  return {
    id,
    user_id: userId,
    name: id,
    preset: "custom",
    categories,
    include_keywords: [],
    exclude_keywords: [],
    terms: ["Summer 2027"],
    locations: [],
    remote_ok: true,
    needs_sponsorship: false,
  };
}

const swePosting = {
  id: "p1",
  title: "Software Engineer Intern",
  category: "Software",
  terms: ["Summer 2027"],
  locations: ["NYC"],
};
const quantPosting = {
  ...swePosting,
  id: "p2",
  title: "Quant Trader Intern",
  category: "Quant",
};

describe("planMatches", () => {
  it("one row per user per matching posting, credited to the first match", () => {
    const rows = planMatches(
      [swePosting, quantPosting],
      [
        profile("alex-swe", "alex", ["Software"]),
        profile("alex-all", "alex", ["Software", "Quant"]),
        profile("sam-quant", "sam", ["Quant"]),
      ],
    );
    expect(rows).toEqual([
      { user_id: "alex", posting_id: "p1", watch_profile_id: "alex-swe" },
      { user_id: "alex", posting_id: "p2", watch_profile_id: "alex-all" },
      { user_id: "sam", posting_id: "p2", watch_profile_id: "sam-quant" },
    ]);
  });

  it("no profiles, no rows", () => {
    expect(planMatches([swePosting], [])).toEqual([]);
  });
});

/**
 * Stand-in for the service-role client: the upsert answers from `results` in
 * order (and records what it was sent); the two re-check selects return
 * whichever users and watch profiles still exist.
 */
function fakeDb(
  results: { code: string; message: string }[],
  live: { users: string[]; profiles: string[] },
) {
  const sent: InboxRow[][] = [];
  const db = {
    from(table: string) {
      return {
        upsert: (rows: InboxRow[]) => ({
          select: async () => {
            sent.push(rows);
            const error = results[sent.length - 1] ?? null;
            return error
              ? { data: null, error }
              : {
                  data: rows.map((r) => ({
                    user_id: r.user_id,
                    posting_id: r.posting_id,
                  })),
                  error: null,
                };
          },
        }),
        select: () => ({
          in: async (_col: string, ids: string[]) => ({
            data:
              table === "profiles"
                ? ids
                    .filter((id) => live.users.includes(id))
                    .map((user_id) => ({ user_id }))
                : ids
                    .filter((id) => live.profiles.includes(id))
                    .map((id) => ({ id })),
            error: null,
          }),
        }),
      };
    },
  };
  return { db: db as unknown as Db, sent };
}

const fkError = {
  code: "23503",
  message:
    'insert or update on table "user_postings" violates foreign key constraint "user_postings_user_id_fkey"',
};
const row = (user: string, posting: string, profile = `${user}-swe`) => ({
  user_id: user,
  posting_id: posting,
  watch_profile_id: profile,
});

describe("insertInboxRows", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts the batch as is when nothing went missing", async () => {
    const { db, sent } = fakeDb([], { users: [], profiles: [] });
    const rows = await insertInboxRows(db, [row("alex", "p1")]);
    expect(rows).toEqual([{ user_id: "alex", posting_id: "p1" }]);
    expect(sent).toHaveLength(1);
  });

  it("drops a deleted user's rows and retries, so everyone else still gets theirs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, sent } = fakeDb([fkError], {
      users: ["alex"],
      profiles: ["alex-swe", "gone-swe"],
    });
    const rows = await insertInboxRows(db, [
      row("alex", "p1"),
      row("gone", "p1"),
      row("alex", "p2"),
    ]);
    expect(rows).toEqual([
      { user_id: "alex", posting_id: "p1" },
      { user_id: "alex", posting_id: "p2" },
    ]);
    expect(sent[1]).toEqual([row("alex", "p1"), row("alex", "p2")]);
  });

  it("drops rows credited to a watch profile deleted mid-run", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, sent } = fakeDb([fkError], {
      users: ["alex", "sam"],
      profiles: ["alex-swe"],
    });
    const rows = await insertInboxRows(db, [
      row("alex", "p1"),
      row("sam", "p1"),
    ]);
    expect(rows).toEqual([{ user_id: "alex", posting_id: "p1" }]);
    expect(sent).toHaveLength(2);
  });

  it("doesn't retry when every row's user is gone", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, sent } = fakeDb([fkError], { users: [], profiles: [] });
    expect(await insertInboxRows(db, [row("gone", "p1")])).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("still throws any other error, without retrying", async () => {
    const { db, sent } = fakeDb(
      [
        {
          code: "57014",
          message: "canceling statement due to statement timeout",
        },
      ],
      { users: ["alex"], profiles: ["alex-swe"] },
    );
    await expect(insertInboxRows(db, [row("alex", "p1")])).rejects.toThrow(
      "insert user_postings: canceling statement due to statement timeout",
    );
    expect(sent).toHaveLength(1);
  });

  it("retries only once: a second failure throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, sent } = fakeDb([fkError, fkError], {
      users: ["alex"],
      profiles: ["alex-swe"],
    });
    await expect(insertInboxRows(db, [row("alex", "p1")])).rejects.toThrow(
      "insert user_postings: insert or update",
    );
    expect(sent).toHaveLength(2);
  });
});
