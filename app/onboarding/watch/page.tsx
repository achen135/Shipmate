import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WatchProfileForm } from "@/components/watch/watch-profile-form";
import { HOME_PATH } from "@/lib/auth/routes";
import { requireSignedIn } from "@/lib/auth/viewer";
import {
  ONBOARDING_PATHS,
  STEP,
  displayStepNumber,
  pendingOnboardingPath,
} from "@/lib/onboarding";
import { formFromPreset } from "@/lib/schemas/watch-profile";

import { completeWatch } from "../actions";
import { StepHeader } from "../step-header";

export const metadata: Metadata = { title: "What to watch" };

export default async function WatchStepPage() {
  const viewer = await requireSignedIn();
  const pending = pendingOnboardingPath(viewer);
  if (pending !== ONBOARDING_PATHS[STEP.watch]) redirect(pending ?? HOME_PATH);

  return (
    <>
      <StepHeader
        step={displayStepNumber(STEP.watch, viewer.mode)}
        title="What to watch"
      >
        Pick a starting point and adjust it. Shipmate checks for new postings
        every 30 minutes, and your Inbox starts with matches from the past week.
        You can add more searches later in Profile.
      </StepHeader>
      <WatchProfileForm
        defaultValues={formFromPreset(
          "swe",
          viewer.profile?.needs_sponsorship ?? false,
        )}
        action={completeWatch}
        submitLabel="Set sail"
      />
    </>
  );
}
