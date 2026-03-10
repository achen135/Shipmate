/**
 * Which URLs need a signed-in user, and where redirects may go.
 * Pure functions so the proxy logic is unit-testable.
 */

/** Everything behind sign-in. Invite + onboarding checks happen in the pages. */
const GATED_PREFIXES = [
  "/inbox",
  "/to-apply",
  "/tracker",
  "/profile",
  "/onboarding",
  "/admin",
] as const;

export const SIGN_IN_PATH = "/sign-in";
export const HOME_PATH = "/inbox";

export function isGatedPath(pathname: string): boolean {
  return GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Only same-origin absolute paths. Rejects external URLs, protocol-relative
 * `//evil.com`, and `/\evil.com` (browsers read a leading `/\` as `//`), plus
 * control characters that browsers strip before parsing.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback: string = HOME_PATH,
): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return fallback;
  }
  return value;
}
