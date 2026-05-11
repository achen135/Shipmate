import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { serverSecret } from "@/lib/server-secret";

/**
 * The Apply button's marker: `#shipmate=<marker>` on the application link
 * (M8 §2.3). It says "this tab was opened from Shipmate, by its user, for
 * this Inbox row", so the extension fills it without a click. A fragment
 * never reaches the ATS's server.
 *
 * `<user_posting_id>.<expires>.<nonce>.<signature>`, signed with a key
 * derived from the server secret. It can't be made without the server, it
 * names one Inbox row (the database also checks that row is the token's
 * user's and that the page is its posting), it expires after an hour, and
 * its nonce is spent the first time it's used (apply_marker_uses), so one
 * marker fills once. A missing, expired, forged or spent marker just means
 * no automatic fill: the extension's button still works.
 */

export const MARKER_TTL_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function key(secret: string): Buffer {
  return createHmac("sha256", secret)
    .update("shipmate apply marker v1")
    .digest();
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", key(secret)).update(payload).digest("base64url");
}

export function makeMarker(
  userPostingId: string,
  now = Date.now(),
  secret = serverSecret(),
): string {
  const expires = (now + MARKER_TTL_MS).toString(36);
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${userPostingId}.${expires}.${nonce}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function readMarker(
  marker: string,
  now = Date.now(),
  secret = serverSecret(),
): { userPostingId: string; nonce: string } | null {
  const parts = marker.split(".");
  if (parts.length !== 4) return null;
  const [userPostingId, expires, nonce, signature] = parts;
  if (!UUID.test(userPostingId) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) {
    return null;
  }
  const expected = Buffer.from(
    sign(secret, `${userPostingId}.${expires}.${nonce}`),
  );
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  if (!(parseInt(expires, 36) > now)) return null;
  return { userPostingId, nonce };
}

/** Hosts the extension fills (Greenhouse, Lever, Ashby): only they get one. */
export function fillableHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith(".greenhouse.io") ||
      host === "jobs.lever.co" ||
      host === "jobs.eu.lever.co" ||
      host === "jobs.ashbyhq.com"
    );
  } catch {
    return false;
  }
}

/**
 * The Apply link with a marker, when the posting's link is one the
 * extension fills and has no fragment of its own (a fragment can be a
 * page's own route; changing it could break the page). Otherwise the link
 * as it is. No server secret (a build without env): the link as it is.
 */
export function applyLink(url: string, userPostingId: string | null): string {
  if (!userPostingId || url.includes("#") || !fillableHost(url)) return url;
  try {
    return `${url}#shipmate=${makeMarker(userPostingId)}`;
  } catch {
    return url;
  }
}
