import { z } from "zod";

import { parseResumeUsed } from "@/lib/apply/resume-used";
import { getInvited } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { pdfFileName } from "@/lib/tailor/pdf-name";

/**
 * The exact PDF recorded as sent with one application, as the signed-in
 * user (RLS: their own row, and each bucket's own-folder read policy).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getInvited();
  if (!viewer) return new Response("Sign in first.", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return new Response("Not found.", { status: 404 });
  }

  const supabase = await createClient();
  const [row, profile] = await Promise.all([
    supabase
      .from("user_postings")
      .select("resume_used, posting:postings(company:companies(name))")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("profiles").select("name").maybeSingle(),
  ]);
  const used = parseResumeUsed(row.data?.resume_used);
  if (!used) return new Response("Not found.", { status: 404 });

  const { data: file, error } = await supabase.storage
    .from(used.bucket)
    .download(used.path);
  if (error || !file) {
    return new Response("That file is no longer available.", { status: 404 });
  }

  const name =
    used.kind === "tailored"
      ? pdfFileName(
          profile.data?.name ?? "",
          row.data?.posting?.company?.name ?? "",
        )
      : (used.file_name ?? "resume.pdf").replace(/["\\\r\n]/g, "");
  return new Response(file, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}
