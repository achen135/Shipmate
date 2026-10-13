// @vitest-environment node
import { createECDH, randomBytes } from "node:crypto";

import webpush from "web-push";
import { describe, expect, it, vi } from "vitest";

import {
  EMAIL_GRACE_MS,
  type EmailSender,
  type NotifyUser,
  type Senders,
  sendNotifications,
  sendersFromEnv,
  wantsEmail,
} from "./notify";
import type { PushSender } from "@/lib/notify/types";
import type { Db } from "./db";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-04-12T12:00:00Z");
const user = (over: Partial<NotifyUser> = {}): NotifyUser => ({
  email: "a@example.com",
  invitedAt: new Date(now - 3 * DAY).toISOString(),
  emailEnabled: true,
  devices: 0,
  ...over,
});

describe("wantsEmail (the fallback rule)", () => {
  it("emails a member of over a day with no device", () => {
    expect(wantsEmail(user(), 0, now)).toBe(true);
  });

  it("waits out the grace period for a new member", () => {
    const fresh = user({
      invitedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    });
    expect(wantsEmail(fresh, 0, now)).toBe(false);
    const edge = user({
      invitedAt: new Date(now - EMAIL_GRACE_MS).toISOString(),
    });
    expect(wantsEmail(edge, 0, now)).toBe(true);
  });

  it("doesn't email when push reached a device", () => {
    expect(wantsEmail(user({ devices: 2 }), 1, now)).toBe(false);
  });

  it("does when every device failed, even for a new member", () => {
    const fresh = user({
      devices: 1,
      invitedAt: new Date(now - 60_000).toISOString(),
    });
    expect(wantsEmail(fresh, 0, now)).toBe(true);
  });

  it("respects the switch and a missing address", () => {
    expect(wantsEmail(user({ emailEnabled: false }), 0, now)).toBe(false);
    expect(wantsEmail(user({ email: null }), 0, now)).toBe(false);
  });

  it("doesn't email someone who was never let in", () => {
    expect(wantsEmail(user({ invitedAt: null }), 0, now)).toBe(false);
  });
});

/** A tiny stand-in for the service-role client: just the calls notify.ts makes. */
function fakeDb(data: {
  postings: { id: string; company_id: string; company: { name: string } }[];
  follows?: { user_id: string; company_id: string }[];
  profiles: {
    user_id: string;
    email: string | null;
    invited_at: string | null;
    notify_prefs: unknown;
  }[];
  subs?: { id: string; user_id: string; endpoint: string; keys: unknown }[];
}) {
  const claimed = new Set<string>();
  const deleted: string[] = [];
  const db = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        delete: () => ({
          eq: async (_col: string, id: string) => {
            deleted.push(id);
            return { error: null };
          },
        }),
        upsert: (row: {
          user_id: string;
          run_id: string;
          channel: string;
        }) => ({
          select: async () => {
            const key = `${row.user_id}|${row.run_id}|${row.channel}`;
            if (claimed.has(key)) return { data: [], error: null };
            claimed.add(key);
            return { data: [{ id: key }], error: null };
          },
        }),
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data:
              table === "postings"
                ? data.postings
                : table === "follows"
                  ? (data.follows ?? [])
                  : table === "profiles"
                    ? data.profiles
                    : table === "push_subscriptions"
                      ? (data.subs ?? [])
                      : [],
            error: null,
          }),
      };
      return chain;
    },
  };
  return { db: db as unknown as Db, claimed, deleted };
}

const postings = [
  { id: "p1", company_id: "c1", company: { name: "Stripe" } },
  { id: "p2", company_id: "c1", company: { name: "Stripe" } },
];
const sub = (id: string, userId: string) => ({
  id,
  user_id: userId,
  endpoint: `https://push.example.com/${id}`,
  keys: { p256dh: "k", auth: "a" },
});
const quiet = () => {};

describe("sendNotifications", () => {
  it("sends one push per device, one digest per run, however many postings matched", async () => {
    const { db } = fakeDb({
      postings,
      profiles: [
        {
          user_id: "u1",
          email: "a@example.com",
          invited_at: new Date(now - 5 * DAY).toISOString(),
          notify_prefs: {},
        },
      ],
      subs: [sub("d1", "u1")],
    });
    const push = vi.fn<PushSender>(async () => ({ ok: true }));
    const email = vi.fn<EmailSender>(async () => {});
    const senders: Senders = { push, email };
    const stats = await sendNotifications(
      db,
      "run-1",
      [
        { userId: "u1", postingId: "p1" },
        { userId: "u1", postingId: "p2" },
      ],
      senders,
      now,
      quiet,
    );
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][1]).toEqual({
      title: "Shipmate",
      body: "2 new matches at Stripe",
      url: "/inbox",
    });
    expect(email).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ users: 1, push: 1, email: 0 });
  });

  it("doesn't send twice for the same run", async () => {
    const { db } = fakeDb({
      postings,
      profiles: [
        {
          user_id: "u1",
          email: "a@example.com",
          invited_at: new Date(now - 5 * DAY).toISOString(),
          notify_prefs: {},
        },
      ],
      subs: [sub("d1", "u1")],
    });
    const push = vi.fn<PushSender>(async () => ({ ok: true }));
    const senders: Senders = { push, email: null };
    const matches = [{ userId: "u1", postingId: "p1" }];
    await sendNotifications(db, "run-1", matches, senders, now, quiet);
    await sendNotifications(db, "run-1", matches, senders, now, quiet);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("falls back to email for a member with no device", async () => {
    const { db } = fakeDb({
      postings,
      profiles: [
        {
          user_id: "u1",
          email: "a@example.com",
          invited_at: new Date(now - 5 * DAY).toISOString(),
          notify_prefs: {},
        },
      ],
    });
    const email = vi.fn<EmailSender>(async () => {});
    const stats = await sendNotifications(
      db,
      "run-1",
      [{ userId: "u1", postingId: "p1" }],
      { push: vi.fn<PushSender>(), email },
      now,
      quiet,
    );
    expect(email).toHaveBeenCalledTimes(1);
    expect(email.mock.calls[0][0]).toBe("a@example.com");
    expect(email.mock.calls[0][1]).toBe("Shipmate: 1 new match at Stripe");
    expect(stats.email).toBe(1);
  });

  it("doesn't email a new member, or one who switched it off", async () => {
    const { db } = fakeDb({
      postings,
      profiles: [
        {
          user_id: "new",
          email: "n@example.com",
          invited_at: new Date(now - 3_600_000).toISOString(),
          notify_prefs: {},
        },
        {
          user_id: "off",
          email: "o@example.com",
          invited_at: new Date(now - 9 * DAY).toISOString(),
          notify_prefs: { email: false },
        },
      ],
    });
    const email = vi.fn<EmailSender>(async () => {});
    await sendNotifications(
      db,
      "run-1",
      [
        { userId: "new", postingId: "p1" },
        { userId: "off", postingId: "p1" },
      ],
      { push: null, email },
      now,
      quiet,
    );
    expect(email).not.toHaveBeenCalled();
  });

  it("emails when every device failed, and forgets a device the push service says is gone", async () => {
    const { db, deleted } = fakeDb({
      postings,
      profiles: [
        {
          user_id: "u1",
          email: "a@example.com",
          invited_at: new Date(now - 60_000).toISOString(),
          notify_prefs: {},
        },
      ],
      subs: [sub("dead", "u1")],
    });
    const push = vi.fn<PushSender>(async () => ({
      ok: false,
      gone: true,
      error: "HTTP 410",
    }));
    const email = vi.fn<EmailSender>(async () => {});
    await sendNotifications(
      db,
      "run-1",
      [{ userId: "u1", postingId: "p1" }],
      { push, email },
      now,
      quiet,
    );
    expect(deleted).toEqual(["dead"]);
    expect(email).toHaveBeenCalledTimes(1);
  });

  it("names a priority company", async () => {
    const { db } = fakeDb({
      postings: [
        ...postings,
        { id: "p3", company_id: "c2", company: { name: "Ramp" } },
      ],
      follows: [{ user_id: "u1", company_id: "c2" }],
      profiles: [
        {
          user_id: "u1",
          email: null,
          invited_at: new Date(now - 5 * DAY).toISOString(),
          notify_prefs: {},
        },
      ],
      subs: [sub("d1", "u1")],
    });
    const push = vi.fn<PushSender>(async () => ({ ok: true }));
    await sendNotifications(
      db,
      "run-1",
      [
        { userId: "u1", postingId: "p1" },
        { userId: "u1", postingId: "p3" },
      ],
      { push, email: null },
      now,
      quiet,
    );
    expect(push.mock.calls[0][1].body).toBe("2 new matches, including Ramp");
  });

  it("does nothing, and reads nothing, when there are no new matches", async () => {
    const { db } = fakeDb({ postings: [], profiles: [] });
    const push = vi.fn<PushSender>();
    const stats = await sendNotifications(
      db,
      "run-1",
      [],
      { push, email: null },
      now,
      quiet,
    );
    expect(push).not.toHaveBeenCalled();
    expect(stats).toEqual({
      users: 0,
      push: 0,
      email: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("keeps going when one user's notification throws", async () => {
    const { db } = fakeDb({
      postings,
      profiles: [
        {
          user_id: "u1",
          email: "a@example.com",
          invited_at: new Date(now - 5 * DAY).toISOString(),
          notify_prefs: {},
        },
        {
          user_id: "u2",
          email: "b@example.com",
          invited_at: new Date(now - 5 * DAY).toISOString(),
          notify_prefs: {},
        },
      ],
      subs: [sub("d1", "u1"), sub("d2", "u2")],
    });
    const push = vi.fn<PushSender>(async (device) => {
      if (device.endpoint.endsWith("d1")) throw new Error("boom");
      return { ok: true };
    });
    const stats = await sendNotifications(
      db,
      "run-1",
      [
        { userId: "u1", postingId: "p1" },
        { userId: "u2", postingId: "p1" },
      ],
      { push, email: null },
      now,
      quiet,
    );
    expect(stats.failed).toBe(1);
    expect(stats.push).toBe(1);
  });
});

describe("sendersFromEnv", () => {
  it("warns about each missing piece instead of failing", () => {
    const warnings: string[] = [];
    const senders = sendersFromEnv({}, (m) => warnings.push(m));
    expect(senders).toEqual({ push: null, email: null });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/VAPID/);
    expect(warnings[1]).toMatch(/SMTP_URL/);
  });

  it("builds a real web-push sender whose payload is encrypted for the device", async () => {
    const keys = webpush.generateVAPIDKeys();
    // A device's own key pair, as a browser's PushManager would hold it.
    const device = createECDH("prime256v1");
    device.generateKeys();
    const p256dh = device.getPublicKey().toString("base64url");
    const auth = randomBytes(16).toString("base64url");

    const sent: { body: unknown; headers: Record<string, string> }[] = [];
    const details = webpush.generateRequestDetails(
      { endpoint: "https://push.example.com/abc", keys: { p256dh, auth } },
      JSON.stringify({ title: "Shipmate", body: "1 new match", url: "/inbox" }),
      {
        vapidDetails: {
          subject: "https://shipmate-jobs.vercel.app",
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
      },
    );
    sent.push({
      body: details.body,
      headers: details.headers as Record<string, string>,
    });

    expect(Buffer.isBuffer(sent[0].body)).toBe(true);
    // Encrypted: the plain text doesn't appear on the wire.
    expect((sent[0].body as Buffer).toString("utf8")).not.toContain(
      "new match",
    );
    expect(sent[0].headers["Content-Encoding"]).toBe("aes128gcm");
    expect(sent[0].headers.Authorization).toMatch(/^vapid t=/);

    const warnings: string[] = [];
    const senders = sendersFromEnv(
      {
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        SMTP_URL: "smtp://localhost:1",
        EMAIL_FROM: "Shipmate <a@example.com>",
      },
      (m) => warnings.push(m),
    );
    expect(senders.push).toBeTypeOf("function");
    expect(senders.email).toBeTypeOf("function");
    expect(warnings).toEqual([]);
  });
});
