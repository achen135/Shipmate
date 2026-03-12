import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BasicsForm } from "@/components/profile/basics-form";
import { HOME_PATH } from "@/lib/auth/routes";
import { requireSignedIn } from "@/lib/auth/viewer";
import {
  ONBOARDING_PATHS,
  STEP,
  pendingOnboardingPath,
} from "@/lib/onboarding";
import { basicsFromProfile, gradYearOptions } from "@/lib/schemas/basics";

import { completeBasics } from "../actions";
import { StepHeader } from "../step-header";

export const metadata: Metadata = { title: "Basics" };

export default async function BasicsPage() {
  const viewer = await requireSignedIn();
  const pending = pendingOnboardingPath(viewer);
  if (pending !== ONBOARDING_PATHS[STEP.basics]) redirect(pending ?? HOME_PATH);

  return (
    <>
      <StepHeader step={2} title="The basics">
        Used for fit warnings and to fill in your answer sheet. You can change
        these later in Profile.
      </StepHeader>
      <BasicsForm
        defaultValues={basicsFromProfile(viewer.profile)}
        gradYears={gradYearOptions(
          new Date().getFullYear(),
          viewer.profile?.grad_year,
        )}
        action={completeBasics}
        submitLabel="Continue"
      />
    </>
  );
}
