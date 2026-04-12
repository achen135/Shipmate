/**
 * Step "notify" of the Watch run (CLAUDE.md "Worker run order"): one
 * notification per user per run, for the matches this run just put in their
 * Inbox. The worker sends (it has the matches and the service-role key);
 * the web app only stores subscriptions.
 *
 * Channels:
 * - Web Push to each of the user's subscribed devices.
 * - Email, only as a fallback: the user has no subscribed device and has been
 *   a member for over a day (long enough to have set push up), or every
 *   device they have just failed. Switchable off in Profile.
 *
 * `notifications` (unique per user, run, channel) is written before sending,
 * so a re-run of the same run id can't ping twice. Nothing here may fail the
 * Watch run: problems are logged and counted.
 */

import nodemailer from "nodemailer";
import webpush from "web-push";

import { withE2ePush } from "@/lib/e2e-origin";
import {
  type Digest,
  type MatchedPosting,
  emailContent,
  planDigests,
  pushPayload,
} from "@/lib/notify/digest";
import { readNotifyPrefs } from "@/lib/notify/prefs";
import type { Device, PushSender } from "@/lib/notify/types";
import type { Json } from "@/lib/supabase/database.types";

import { formatWarning } from "./config";
import { type Db, chunks } from "./db";

/** How long a member gets to turn on push before email steps in. */
export const EMAIL_GRACE_MS = 24 * 60 * 60 * 1000;

export type EmailSender = (
  to: string,
  subject: string,
  text: string,
) => Promise<void>;

export type NotifyUser = {
  email: string | null;
  invitedAt: string | null;
  emailEnabled: boolean;
  devices: number;
};

/** Pure: should this user also (or instead) get the email? */
export function wantsEmail(
  user: NotifyUser,
  pushDelivered: number,
  now: number,
): boolean {
  if (!user.emailEnabled || !user.email) return false;
  // Push worked, or is about to be tried on a device that may yet work.
  if (pushDelivered > 0) return false;
  if (user.devices > 0) return true; // every device failed
  const since = user.invitedAt ? Date.parse(user.invitedAt) : NaN;
  return Number.isFinite(since) && now - since >= EMAIL_GRACE_MS;
}

export type NotifyStats = {
  users: number;
  push: number;
  email: number;
  skipped: number;
  failed: number;
};

type Env = Record<string, string | undefined>;

export type Senders = { push: PushSender | null; email: EmailSender | null };

/** Real senders from the environment; a missing piece is a warning, not an error. */
export function sendersFromEnv(
  env: Env,
  warn: (message: string) => void,
): Senders {
  let push: PushSender | null = null;
  const publicKey = env.VAPID_PUBLIC_KEY || env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT || env.APP_URL || "https://shipmate-jobs.vercel.app",
      publicKey,
      privateKey,
    );
    push = async (device, payload) => {
      try {
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: device.keys },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 6, urgency: "normal" },
        );
        return { ok: true };
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        return {
          ok: false,
          // 404 / 410: the browser has dropped this subscription for good.
          gone: status === 404 || status === 410,
          error: status
            ? `HTTP ${status}`
            : String(error instanceof Error ? error.message : error),
        };
      }
    };
  } else {
    warn(
      "push notifications skipped: set VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY.",
    );
  }

  let email: EmailSender | null = null;
  if (env.SMTP_URL && env.EMAIL_FROM) {
    const transport = nodemailer.createTransport(env.SMTP_URL);
    const from = env.EMAIL_FROM;
    email = async (to, subject, text) => {
      await transport.sendMail({ from, to, subject, text });
    };
  } else {
    warn("email fallback skipped: set SMTP_URL and EMAIL_FROM.");
  }
  return { push: push ? withE2ePush(push, env) : null, email };
}

async function loadInputs(
  db: Db,
  matches: { userId: string; postingId: string }[],
) {
  const userIds = [...new Set(matches.map((m) => m.userId))];
  const postingIds = [...new Set(matches.map((m) => m.postingId))];

  const postings = new Map<string, MatchedPosting>();
  for (const batch of chunks(postingIds, 200)) {
    const { data, error } = await db
      .from("postings")
      .select("id, company_id, company:companies(name)")
      .in("id", batch);
    if (error) throw new Error(`load matched postings: ${error.message}`);
    for (const row of data) {
      postings.set(row.id, {
        companyId: row.company_id,
        company: row.company?.name ?? "a company you follow",
      });
    }
  }

  const priority = new Map<string, Set<string>>();
  const profiles = new Map<string, NotifyUser>();
  const devices = new Map<string, Device[]>();
  for (const batch of chunks(userIds, 200)) {
    const [follows, profileRows, subs] = await Promise.all([
      db
        .from("follows")
        .select("user_id, company_id")
        .eq("priority", true)
        .in("user_id", batch),
      db
        .from("profiles")
        .select("user_id, email, invited_at, notify_prefs")
        .in("user_id", batch),
      db
        .from("push_subscriptions")
        .select("id, user_id, endpoint, keys")
        .in("user_id", batch),
    ]);
    for (const [label, result] of [
      ["follows", follows],
      ["profiles", profileRows],
      ["push_subscriptions", subs],
    ] as const) {
      if (result.error)
        throw new Error(`load ${label}: ${result.error.message}`);
    }
    for (const row of follows.data!) {
      const set = priority.get(row.user_id) ?? new Set<string>();
      set.add(row.company_id);
      priority.set(row.user_id, set);
    }
    for (const row of subs.data!) {
      const keys = row.keys as { p256dh?: string; auth?: string };
      if (!keys?.p256dh || !keys?.auth) continue;
      const list = devices.get(row.user_id) ?? [];
      list.push({
        id: row.id,
        endpoint: row.endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      });
      devices.set(row.user_id, list);
    }
    for (const row of profileRows.data!) {
      profiles.set(row.user_id, {
        email: row.email,
        invitedAt: row.invited_at,
        emailEnabled: readNotifyPrefs(row.notify_prefs).email,
        devices: devices.get(row.user_id)?.length ?? 0,
      });
    }
  }
  return { postings, priority, profiles, devices };
}

/** Record the intent to send; false if this (user, run, channel) is already done. */
async function claim(
  db: Db,
  userId: string,
  runId: string,
  channel: "push" | "email",
  digest: Digest,
) {
  const { data, error } = await db
    .from("notifications")
    .upsert(
      {
        user_id: userId,
        run_id: runId,
        channel,
        payload: {
          count: digest.count,
          companies: digest.companies,
        } as NonNullable<Json>,
      },
      { onConflict: "user_id,run_id,channel", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`notifications: ${error.message}`);
  return data.length === 1;
}

export async function sendNotifications(
  db: Db,
  runId: string,
  matches: { userId: string; postingId: string }[],
  senders: Senders,
  now = Date.now(),
  log: (message: string) => void = console.log,
): Promise<NotifyStats> {
  const stats: NotifyStats = {
    users: 0,
    push: 0,
    email: 0,
    skipped: 0,
    failed: 0,
  };
  if (matches.length === 0) return stats;

  const { postings, priority, profiles, devices } = await loadInputs(
    db,
    matches,
  );
  const digests = planDigests(matches, postings, priority);
  stats.users = digests.length;

  for (const digest of digests) {
    const user = profiles.get(digest.userId);
    if (!user) {
      stats.skipped += 1;
      continue;
    }
    try {
      let delivered = 0;
      const list = devices.get(digest.userId) ?? [];
      if (list.length > 0 && senders.push) {
        if (await claim(db, digest.userId, runId, "push", digest)) {
          for (const device of list) {
            const result = await senders.push(device, pushPayload(digest));
            if (result.ok) {
              delivered += 1;
              stats.push += 1;
            } else {
              stats.failed += 1;
              log(`[worker] push to one device failed: ${result.error}`);
              if (result.gone)
                await db
                  .from("push_subscriptions")
                  .delete()
                  .eq("id", device.id);
            }
          }
        } else {
          // Already sent for this run: count it as handled.
          delivered = list.length;
        }
      }

      // Devices that weren't tried (no VAPID keys) count as failed for the
      // fallback: better an email than silence.
      if (wantsEmail(user, delivered, now) && senders.email) {
        if (await claim(db, digest.userId, runId, "email", digest)) {
          const content = emailContent(
            digest,
            process.env.APP_URL || "https://shipmate-jobs.vercel.app",
          );
          await senders.email(user.email!, content.subject, content.text);
          stats.email += 1;
        }
      } else if (delivered === 0) {
        stats.skipped += 1;
      }
    } catch (error) {
      stats.failed += 1;
      log(
        `[worker] notify failed for one user: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  return stats;
}

/** Entry point for run.ts: builds the senders and never throws. */
export async function notifyUsers(
  db: Db,
  runId: string,
  matches: { userId: string; postingId: string }[],
  env: Env = process.env,
): Promise<NotifyStats | null> {
  if (matches.length === 0) return null;
  try {
    const senders = sendersFromEnv(env, (message) =>
      console.log(formatWarning(message, env)),
    );
    return await sendNotifications(db, runId, matches, senders);
  } catch (error) {
    console.error("[worker] notifications failed:", error);
    return null;
  }
}
