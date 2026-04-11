import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { StandardAnswersForm } from "@/components/profile/standard-answers-form";
import { ResumeUpload } from "@/components/resume/resume-upload";
import { requireMember } from "@/lib/auth/viewer";
import { formatShortDate } from "@/lib/format/time";
import { getResume } from "@/lib/resume/queries";
import { answersFromProfile } from "@/lib/schemas/standard-answers";
import { createClient } from "@/lib/supabase/server";

import { updateStandardAnswers } from "./actions";

export const metadata: Metadata = { title: "Resume and answers" };

export default async function ApplicationPage() {
  await requireMember();
  const supabase = await createClient();
  const [resume, profile] = await Promise.all([
    getResume(),
    supabase
      .from("profiles")
      .select("phone, standard_answers")
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`profile: ${error.message}`);
        return data;
      }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Resume and answers" />

      <section aria-labelledby="resume-heading" className="flex flex-col gap-4">
        <h2 id="resume-heading" className="text-lg font-medium">
          Resume
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

      <section
        aria-labelledby="answers-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="answers-heading" className="text-lg font-medium">
          Application answers
        </h2>
        <p className="text-sm text-muted-foreground">
          The answer sheet on each posting copies from here and from your{" "}
          <Link href="/profile" className="underline underline-offset-2">
            Basics
          </Link>{" "}
          (name, school, graduation, work authorization).
        </p>
        <StandardAnswersForm
          defaultValues={answersFromProfile(profile)}
          action={updateStandardAnswers}
        />
      </section>
    </div>
  );
}
