import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PageHeader } from "@/components/app/page-header";
import { ResumeEditor } from "@/components/resume/resume-editor";
import { requireMember } from "@/lib/auth/viewer";
import { parseContent } from "@/lib/resume/structured";
import { createClient } from "@/lib/supabase/server";

import { noNotes, saveTailoredCopy } from "./actions";

export const metadata: Metadata = { title: "Edit this copy" };

/**
 * The editor on one posting's tailored copy. The master resume
 * (Profile → Structured resume) isn't touched from here.
 */
export default async function TailoredCopyPage({
  params,
}: PageProps<"/postings/[id]/resume">) {
  await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("user_postings")
    .select("id, posting:postings(title, company:companies(name))")
    .eq("posting_id", id)
    .maybeSingle();
  if (!item) notFound();
  const { data: tailoring } = await supabase
    .from("tailorings")
    .select("id, resume_content")
    .eq("user_posting_id", item.id)
    .eq("state", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const content = parseContent(tailoring?.resume_content);
  if (!tailoring || !content) notFound();

  const save = saveTailoredCopy.bind(null, tailoring.id, id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Edit this copy" />
      <p className="text-sm text-muted-foreground">
        The copy tailored for {item.posting?.title ?? "this posting"}
        {item.posting?.company?.name ? ` at ${item.posting.company.name}` : ""}.
        Changes here stay with this copy: your{" "}
        <Link href="/profile/resume" className="underline underline-offset-2">
          master resume
        </Link>{" "}
        doesn&apos;t change. The PDF is printed again after you save.
      </p>
      <ResumeEditor
        initial={content}
        notes={[]}
        save={save}
        clearNotes={noNotes}
        saveLabel="Save this copy"
      />
      <Link
        href={`/postings/${id}`}
        className="text-sm underline underline-offset-2"
      >
        Back to the posting
      </Link>
    </div>
  );
}
