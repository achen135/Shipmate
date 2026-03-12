import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PrivacyNote } from "@/components/auth/privacy-note";
import { Logo } from "@/components/brand/logo";
import { safeRedirectPath } from "@/lib/auth/routes";
import { normalizeInviteCode } from "@/lib/invites";
import { emailSignInEnabled, readSupabaseEnv } from "@/lib/supabase/env";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  callback: "Sign-in didn't finish. Try again.",
  link: "That sign-in link has expired or was already used. Request a new one.",
};

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-6">
      <header>
        <Link href="/" aria-label="ShipMate home">
          <Logo />
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-6 py-10">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Sign in
          </h1>
          <p className="mt-2 text-muted-foreground">
            ShipMate is invite-only for now. No passwords: use Google
            {emailSignInEnabled() ? " or an email link" : ""}.
          </p>
        </div>

        <Suspense fallback={<FormSkeleton />}>
          <SignInPanel searchParams={searchParams} />
        </Suspense>

        <PrivacyNote />
      </main>
    </div>
  );
}

/** Reads the query string, so it renders per request behind the boundary. */
async function SignInPanel({
  searchParams,
}: {
  searchParams: PageProps<"/sign-in">["searchParams"];
}) {
  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const error = ERRORS[first("error") ?? ""];

  if (!readSupabaseEnv()) {
    return (
      <p role="alert" className="rounded-xl border bg-card p-4 text-sm">
        Sign-in isn&apos;t set up on this server yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-warning/20 p-3 text-sm text-warning-foreground dark:text-foreground"
        >
          {error}
        </p>
      )}
      <SignInForm
        next={safeRedirectPath(first("next"))}
        invite={normalizeInviteCode(first("invite") ?? "")}
        emailEnabled={emailSignInEnabled()}
      />
    </div>
  );
}

function FormSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-48 animate-pulse rounded-xl bg-muted"
    />
  );
}
