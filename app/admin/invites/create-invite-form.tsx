"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatInviteCode } from "@/lib/invites";

import { type CreateInviteState, createInvite } from "./actions";
import { CopyInviteButton } from "./copy-invite-button";

export function CreateInviteForm() {
  const [state, action, pending] = useActionState<CreateInviteState, FormData>(
    createInvite,
    { status: "idle" },
  );

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <form action={action}>
        <FieldGroup>
          <Field data-invalid={state.status === "error"}>
            <FieldLabel htmlFor="note">
              Who is it for? (note, optional)
            </FieldLabel>
            <Input
              id="note"
              name="note"
              maxLength={200}
              placeholder="e.g. Sam, supply chain"
            />
            {state.status === "error" && (
              <FieldError>{state.message}</FieldError>
            )}
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create invite code"}
          </Button>
        </FieldGroup>
      </form>

      {state.status === "created" && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-secondary p-3"
        >
          <p>
            New code:{" "}
            <span
              data-testid="new-invite-code"
              className="font-mono text-lg font-semibold"
            >
              {formatInviteCode(state.code)}
            </span>
          </p>
          <CopyInviteButton code={state.code} />
        </div>
      )}
    </div>
  );
}
