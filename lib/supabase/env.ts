/**
 * Browser-safe Supabase settings. Both are `NEXT_PUBLIC_`, so Next inlines them
 * at build time; the build itself must still pass without them (CI builds with
 * no env), which is why nothing reads them at module load.
 */
export type SupabaseEnv = { url: string; publishableKey: string };

export function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase isn't configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

export function requireSupabaseEnv(): SupabaseEnv {
  const env = readSupabaseEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  return env;
}

/**
 * Email magic links need custom SMTP in production (Supabase's built-in sender
 * only reaches the project's own team). Until that's set up, sign-in is
 * Google-only and the email form stays hidden.
 */
export function emailSignInEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_EMAIL_ENABLED === "true";
}
