"use client";

import { useActionState } from "react";

import { type RedeemState, redeemInvite } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function InviteForm({ initialError }: { initialError: string | null }) {
  const [state, action, pending] = useActionState<RedeemState, FormData>(
    redeemInvite,
    { message: initialError },
  );

  return (
    <form action={action}>
      <FieldGroup>
        <Field data-invalid={!!state.message}>
          <FieldLabel htmlFor="code">Invite code</FieldLabel>
          <Input
            id="code"
            name="code"
            placeholder="ABCD-EFGH"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!state.message}
            className="font-mono text-lg uppercase"
            required
          />
          <FieldError>{state.message}</FieldError>
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Checking…" : "Continue"}
        </Button>
      </FieldGroup>
    </form>
  );
}
