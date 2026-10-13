/**
 * What the browser can do about push, and what to tell the person. Pure
 * functions over a few facts about the browser, so the iOS rules are
 * testable without one.
 *
 * iOS (Safari) only allows Web Push for a site that has been added to the
 * Home Screen and is opened from there, and it never prompts to add it, so
 * Shipmate shows the steps first. Android and desktop browsers just work.
 */

export type DeviceFacts = {
  userAgent: string;
  /** navigator.maxTouchPoints: iPadOS 13+ reports itself as a Mac. */
  maxTouchPoints: number;
  /** Opened from the Home Screen icon, not a browser tab. */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
};

export type PushSupport =
  /** Ready: ask for permission. */
  | { kind: "ready" }
  /** iPhone/iPad in a browser tab: show the Add to Home Screen steps. */
  | { kind: "ios_add_to_home" }
  /** This browser can't do Web Push. */
  | { kind: "unsupported" };

export function isIos(
  facts: Pick<DeviceFacts, "userAgent" | "maxTouchPoints">,
) {
  if (/iPhone|iPad|iPod/.test(facts.userAgent)) return true;
  // iPadOS: "Macintosh" with a touch screen.
  return /Macintosh/.test(facts.userAgent) && facts.maxTouchPoints > 1;
}

export function pushSupport(facts: DeviceFacts): PushSupport {
  if (isIos(facts) && !facts.standalone) return { kind: "ios_add_to_home" };
  if (facts.hasServiceWorker && facts.hasPushManager && facts.hasNotification) {
    return { kind: "ready" };
  }
  return { kind: "unsupported" };
}

/** The VAPID public key in the form PushManager.subscribe wants. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
