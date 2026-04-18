import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { ResumeEditor } from "@/components/resume/resume-editor";
import { ResumeImport } from "@/components/resume/resume-import";
import { getAiSettings } from "@/lib/ai/queries";
import { requireMember } from "@/lib/auth/viewer";
import { getStructuredResume } from "@/lib/resume/queries";

import { clearImportNotes, saveResume } from "./actions";

export const metadata: Metadata = { title: "Structured resume" };

export default async function StructuredResumePage() {
  await requireMember();
  const [{ content, notes }, ai] = await Promise.all([
    getStructuredResume(),
    getAiSettings(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Structured resume" />
      <p className="text-sm text-muted-foreground">
        Your master resume in Shipmate&apos;s one-page layout, with your own
        sections. Tailoring (from the next update) starts from this every time
        and never changes it.
      </p>

      {ai.savedKey ? (
        <ResumeImport hasContent={content !== null} />
      ) : (
        <p className="rounded-xl border bg-card p-4 text-sm">
          Importing needs an AI key.{" "}
          <Link href="/profile/ai" className="underline underline-offset-2">
            Set one up in Profile → AI
          </Link>
          , or keep using your PDF as it is.
        </p>
      )}

      {content && (
        <ResumeEditor
          // Re-mount after an import so the form starts from the new content.
          key={JSON.stringify(content).length + content.sections.length}
          initial={content}
          notes={notes}
          save={saveResume}
          clearNotes={clearImportNotes}
        />
      )}
    </div>
  );
}
