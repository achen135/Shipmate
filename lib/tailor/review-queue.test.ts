// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { rows } = vi.hoisted(() => ({ rows: { current: [] as unknown[] } }));
vi.mock("@/lib/supabase/server", () => {
  // Every query method returns the same builder; awaiting it gives the rows.
  const query = {
    select: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    then: (resolve: (r: { data: unknown; error: null }) => void) =>
      resolve({ data: rows.current, error: null }),
  };
  return { createClient: async () => ({ from: () => query }) };
});

import { SHARED_BACKUP_MODEL } from "@/lib/ai/models";

import { QUEUE_LIMIT, listReviewQueue } from "./review-queue";

const tailoring = (over: Record<string, unknown> = {}) => ({
  id: "t",
  state: "done",
  created_at: "2026-10-18T10:00:00Z",
  finished_at: "2026-10-18T10:05:00Z",
  rate_limited_at: null,
  score_before: 40,
  score_after: 80,
  matched: ["Python"],
  missing: [],
  changes: [{ what: "Moved Python up", why: "asked for" }],
  suggestions: [],
  notes: [],
  warnings: [],
  pdf_path: "u/p/a.pdf",
  pdf_requested_at: null,
  edited_at: null,
  key_source: "shared",
  model: "flash",
  est_cost: 0,
  error: null,
  ...over,
});

const row = (id: string, tailorings: unknown[], status = "new") => ({
  id,
  status,
  posting: {
    id: `p-${id}`,
    title: `Role ${id}`,
    status: "open",
    locations: ["Boston, MA"],
    company: { name: "Tidewater" },
  },
  tailorings,
});

describe("listReviewQueue: only finished results", () => {
  beforeEach(() => {
    rows.current = [];
  });

  it("lists a posting whose latest tailoring is done, parsed like the review page's", async () => {
    rows.current = [row("a", [tailoring()], "saved")];
    const [item] = await listReviewQueue();
    expect(item).toMatchObject({
      id: "a",
      status: "saved",
      posting: { id: "p-a", title: "Role a", company: "Tidewater" },
      onBackupModel: false,
    });
    expect(item.tailoring).toMatchObject({
      scoreBefore: 40,
      scoreAfter: 80,
      changes: [{ what: "Moved Python up", why: "asked for" }],
      hasPdf: true,
    });
  });

  it.each(["queued", "running", "failed"])(
    "leaves out one whose latest tailoring is %s",
    async (state) => {
      rows.current = [row("a", [tailoring({ state })]), row("b", [])];
      expect(await listReviewQueue()).toEqual([]);
    },
  );

  it("marks a result from the shared key's backup model", async () => {
    rows.current = [
      row("a", [tailoring({ model: SHARED_BACKUP_MODEL.id })]),
      row("b", [
        tailoring({ model: SHARED_BACKUP_MODEL.id, key_source: "own" }),
      ]),
    ];
    const items = await listReviewQueue();
    expect(items.map((i) => [i.id, i.onBackupModel])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("puts the most recently finished first, and caps the list", async () => {
    rows.current = [
      row("old", [tailoring({ finished_at: "2026-10-17T09:00:00Z" })]),
      row("new", [tailoring({ finished_at: "2026-10-18T09:00:00Z" })]),
    ];
    expect((await listReviewQueue()).map((i) => i.id)).toEqual(["new", "old"]);

    rows.current = Array.from({ length: QUEUE_LIMIT + 10 }, (_, i) =>
      row(`r${i}`, [tailoring()]),
    );
    expect(await listReviewQueue()).toHaveLength(QUEUE_LIMIT);
  });
});

/**
 * "It's a faster way to see results, not a different way to produce them."
 * The guarantee that matters is in the database (users have SELECT only on
 * tailorings; supabase/tests/rls.ts "A can't update a tailoring directly"),
 * and this pins the other half: nothing the queue is made of can reach the
 * AI, the edit checks, the pipeline, or write to a tailoring.
 */
describe("the fast-review queue never produces or changes a tailoring", () => {
  const files = [
    "components/review/fast-review.tsx",
    "lib/tailor/review-queue.ts",
    "app/(app)/to-apply/review/page.tsx",
  ];
  const source = (file: string) =>
    readFileSync(join(process.cwd(), file), "utf8");

  it.each(files)("%s imports nothing that tailors", (file) => {
    const imports = [...source(file).matchAll(/from "([^"]+)"/g)].map(
      (m) => m[1],
    );
    for (const path of imports) {
      expect(path).not.toMatch(
        /^@\/lib\/ai(?!\/models$)(\/|$)|lib\/tailor\/(pipeline|edits|trace|batch|score|second-look|prompts|research|posting-text|fit)|^@\/worker|@anthropic-ai|openai|@google\/genai/,
      );
    }
  });

  it.each(files)("%s writes no tailoring and queues none", (file) => {
    const text = source(file);
    expect(text).not.toMatch(
      /\.from\("tailorings"\)|save_tailored_copy|tailor_all|\/api\/tailor(?![a-z])/,
    );
  });

  it("the queue's only write is the cards' own changeStatus", () => {
    const text = source("components/review/fast-review.tsx");
    expect(text).toMatch(
      /import \{ changeStatus \} from "@\/app\/\(app\)\/postings\/actions"/,
    );
    expect(text).not.toMatch(/fetch\(|\.insert\(|\.update\(|\.rpc\(/);
  });
});
