import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FactBank } from "@/components/facts/fact-bank";
import { FactSuggestions } from "@/components/facts/fact-suggestions";
import { HOME_PATH } from "@/lib/auth/routes";
import { requireSignedIn } from "@/lib/auth/viewer";
import { listFacts } from "@/lib/facts/queries";
import {
  ONBOARDING_PATHS,
  STEP,
  displayStepNumber,
  pendingOnboardingPath,
} from "@/lib/onboarding";

import {
  addFact,
  addSuggestedFacts,
  deleteFact,
} from "../../(app)/profile/facts/actions";
import { completeFacts } from "../actions";
import { ContinueButton } from "../continue-button";
import { StepHeader } from "../step-header";

export const metadata: Metadata = { title: "Not on your resume" };

/** Step 4 (AI mode only, skippable): the fact bank. */
export default async function FactsStepPage() {
  const viewer = await requireSignedIn();
  const pending = pendingOnboardingPath(viewer);
  if (pending !== ONBOARDING_PATHS[STEP.facts]) redirect(pending ?? HOME_PATH);
  const facts = await listFacts();

  return (
    <>
      <StepHeader
        step={displayStepNumber(STEP.facts, viewer.mode)}
        title="Anything not on your resume?"
      >
        Skills, projects, courses, clubs or awards that are true but didn&apos;t
        fit on one page. Tailoring may use these, and never anything that
        isn&apos;t here or on your resume.
      </StepHeader>
      <FactSuggestions addSuggestedFacts={addSuggestedFacts} />
      <FactBank facts={facts} actions={{ addFact, deleteFact }} />
      <div>
        <ContinueButton
          action={completeFacts}
          label={facts.length ? "Continue" : "Skip for now"}
          variant={facts.length ? "default" : "outline"}
        />
      </div>
    </>
  );
}
