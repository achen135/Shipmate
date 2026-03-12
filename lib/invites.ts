/**
 * Invite codes are 8 characters from an alphabet with no look-alikes (see the
 * invites migration). Stored without punctuation; shown as `ABCD-EFGH`.
 * The database normalises input itself; these helpers are for display and
 * for the pre-sign-in cookie.
 */

/** Strip spaces/dashes and uppercase, the same as redeem_invite() does. */
export function normalizeInviteCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function formatInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * A code typed on the sign-in page, kept in a short-lived httpOnly cookie
 * across the OAuth round trip and redeemed in the auth callback.
 */
export const PENDING_INVITE_COOKIE = "sm_invite";
export const PENDING_INVITE_MAX_AGE = 15 * 60;

export const REDEEM_RESULTS = [
  "ok",
  "already_invited",
  "invalid",
  "used",
  "revoked",
  "not_signed_in",
] as const;
export type RedeemResult = (typeof REDEEM_RESULTS)[number];

export function isRedeemResult(value: unknown): value is RedeemResult {
  return (REDEEM_RESULTS as readonly unknown[]).includes(value);
}

const MESSAGES: Record<
  Exclude<RedeemResult, "ok" | "already_invited">,
  string
> = {
  invalid: "That code doesn't match an invite. Check it for typos.",
  used: "That code has already been used. Ask for a new one.",
  revoked: "That code was cancelled. Ask for a new one.",
  not_signed_in: "Your session ended. Sign in again, then enter the code.",
};

/** User-facing message for a failed redemption, or null for success. */
export function redeemErrorMessage(result: RedeemResult): string | null {
  return result === "ok" || result === "already_invited"
    ? null
    : MESSAGES[result];
}
