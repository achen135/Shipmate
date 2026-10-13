import type { PushPayload } from "./digest";

/** A subscribed browser (push_subscriptions). */
export type Device = {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushResult =
  | { ok: true }
  /** `gone`: the push service says this subscription no longer exists. */
  | { ok: false; gone: boolean; error: string };

export type PushSender = (
  device: Device,
  payload: PushPayload,
) => Promise<PushResult>;
