import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AiSettings } from "@/components/ai/ai-settings";
import { ResumeImport } from "@/components/resume/resume-import";
import { ResumeUpload } from "@/components/resume/resume-upload";
import { getAiSettings } from "@/lib/ai/queries";
import { HOME_PATH } from "@/lib/auth/routes";
import { requireSignedIn } from "@/lib/auth/viewer";
import { formatShortDate } from "@/lib/format/time";
import {
  ONBOARDING_PATHS,
  STEP,
  displayStepNumber,
  pendingOnboardingPath,
} from "@/lib/onboarding";
import { getResume, getStructuredResume } from "@/lib/resume/queries";

import {
  removeKey,
  saveAiSettings,
  saveKey,
  setMode,
} from "../../(app)/profile/ai/actions";
import { completeResume } from "../actions";
import { ContinueButton } from "../continue-button";
import { StepHeader } from "../step-header";

export const metadata: Metadata = { title: "Your resume" };

/**
 * Step 3: the PDF to apply with, and in AI mode (the default since M7, on
 * the shared free key) the structured import. All of it can wait for
 * Profile.
 */
export default async function ResumeStepPage() {
  const viewer = await requireSignedIn();
  const pending = pendingOnboardingPath(viewer);
  if (pending !== ONBOARDING_PATHS[STEP.resume]) redirect(pending ?? HOME_PATH);

  const [resume, structured, ai] = await Promise.all([
    getResume(),
    getStructuredResume(),
    getAiSettings(),
  ]);
  const hasAnything = !!resume?.file_path || structured.content !== null;

  return (
    <>
      <StepHeader step={displayStepNumber(STEP.resume)} title="Your resume">
        Upload the PDF you apply with. In AI mode, Shipmate also reads it into
        an editable layout and tailors a copy for each posting. You can do
        either later in Profile.
      </StepHeader>

      <section aria-labelledby="pdf-heading" className="flex flex-col gap-3">
        <h2 id="pdf-heading" className="font-medium">
          Your PDF
        </h2>
        <ResumeUpload
          current={
            resume?.file_path
              ? {
                  fileName: resume.file_name ?? "resume.pdf",
                  updatedAt: formatShortDate(resume.updated_at),
                  readable: (resume.text_content ?? "").trim().length > 0,
                }
              : null
          }
        />
      </section>

      <section aria-labelledby="ai-heading" className="flex flex-col gap-3">
        <h2 id="ai-heading" className="font-medium">
          AI mode
        </h2>
        {ai.mode === "ai" && (
          <>
            <ResumeImport hasContent={structured.content !== null} />
            {structured.content && (
              <p className="text-sm text-muted-foreground">
                Read {structured.content.sections.length} sections:{" "}
                {structured.content.sections
                  .map((s) => s.title || "untitled")
                  .join(", ")}
                . Check and edit it any time in Profile → Structured resume.
              </p>
            )}
          </>
        )}
        <AiSettings
          {...ai}
          actions={{ saveKey, removeKey, setMode, saveAiSettings }}
        />
      </section>

      <div className="flex gap-3">
        <ContinueButton
          action={completeResume}
          label={hasAnything ? "Continue" : "Skip for now"}
          variant={hasAnything ? "default" : "outline"}
        />
      </div>
    </>
  );
}
