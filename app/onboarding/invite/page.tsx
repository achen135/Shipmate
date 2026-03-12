import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PrivacyNote } from "@/components/auth/privacy-note";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { HOME_PATH } from "@/lib/auth/routes";
import { requireSignedIn } from "@/lib/auth/viewer";
import { isRedeemResult, redeemErrorMessage } from "@/lib/invites";
import { pendingOnboardingPath } from "@/lib/onboarding";

import { StepHeader } from "../step-header";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Invite code" };

export default async function InvitePage({
  searchParams,
}: PageProps<"/onboarding/invite">) {
  const viewer = await requireSignedIn();
  if (viewer.invitedAt) redirect(pendingOnboardingPath(viewer) ?? HOME_PATH);

  // Set by the auth callback when a code typed before sign-in didn't work.
  const { invite } = await searchParams;
  const initialError = isRedeemResult(invite)
    ? redeemErrorMessage(invite)
    : invite === "error"
      ? "Couldn't check your code. Enter it again."
      : null;

  return (
    <>
      <StepHeader step={1} title="Enter your invite code">
        ShipMate is invite-only for now. Ask whoever invited you for a code.
      </StepHeader>
      <InviteForm initialError={initialError} />
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <span>Signed in as {viewer.email ?? "you"}.</span>
        <SignOutButton variant="link" />
      </p>
      <PrivacyNote />
    </>
  );
}
