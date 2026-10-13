import { z } from "zod";

/**
 * profiles.notify_prefs. Only the email fallback is a choice (push is on when
 * a device is subscribed and off when it isn't), and it defaults to on: a
 * friend who never turns on push still hears about matches.
 */

export const notifyPrefsSchema = z.object({ email: z.boolean() });

export type NotifyPrefs = z.infer<typeof notifyPrefsSchema>;

export function readNotifyPrefs(value: unknown): NotifyPrefs {
  const email =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).email
      : undefined;
  return { email: email !== false };
}
