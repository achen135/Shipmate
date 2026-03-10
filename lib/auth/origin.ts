/**
 * The origin the visitor is actually on (production, a Vercel preview, or
 * localhost), for OAuth / magic-link return URLs. Supabase only redirects to
 * URLs on its allow-list (Authentication → URL Configuration), so a spoofed
 * Host header can't send anyone elsewhere.
 */
export function originFromHeaders(headers: Headers): string {
  const host =
    headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto =
    headers.get("x-forwarded-proto") ??
    (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
