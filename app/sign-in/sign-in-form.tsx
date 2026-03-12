"use client";

import { MailCheck } from "lucide-react";
import { useActionState } from "react";

import {
  type SignInState,
  signInWithEmail,
  signInWithGoogle,
} from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const IDLE: SignInState = { status: "idle" };

export function SignInForm({
  next,
  invite,
  emailEnabled,
}: {
  next: string;
  invite: string;
  emailEnabled: boolean;
}) {
  const [googleState, google, googlePending] = useActionState(
    signInWithGoogle,
    IDLE,
  );
  const [emailState, email, emailPending] = useActionState(
    signInWithEmail,
    IDLE,
  );
  const pending = googlePending || emailPending;

  if (emailState.status === "sent") {
    return (
      <div role="status" className="rounded-xl border bg-card p-4">
        <MailCheck aria-hidden="true" className="size-5 text-brass" />
        <p className="mt-2 font-medium">Check your email</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a sign-in link to {emailState.email}. Open it on this device.
        </p>
      </div>
    );
  }

  const error =
    (googleState.status === "error" && googleState.message) ||
    (emailState.status === "error" && emailState.message) ||
    null;

  return (
    <form>
      <input type="hidden" name="next" value={next} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="invite">Invite code</FieldLabel>
          <Input
            id="invite"
            name="invite"
            defaultValue={invite}
            placeholder="ABCD-EFGH"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="font-mono uppercase"
          />
          <FieldDescription>
            Optional if you&apos;ve already joined. New here? Enter it now and
            it&apos;s applied as soon as you sign in.
          </FieldDescription>
        </Field>

        <Button type="submit" formAction={google} disabled={pending} size="lg">
          <GoogleMark />
          {googlePending ? "Opening Google…" : "Continue with Google"}
        </Button>

        {emailEnabled && (
          <>
            <FieldSeparator>or</FieldSeparator>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@school.edu"
              />
            </Field>
            <Button
              type="submit"
              formAction={email}
              disabled={pending}
              size="lg"
              variant="outline"
            >
              {emailPending ? "Sending…" : "Email me a sign-in link"}
            </Button>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </FieldGroup>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
