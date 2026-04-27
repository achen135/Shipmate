import { z } from "zod";

import { getInvited } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { pdfFileName } from "@/lib/tailor/pdf-name";

/**
 * The tailored PDF, as the signed-in user (RLS: their own tailoring, and
 * the pdfs bucket's own-folder read policy), named
 * First_Last_Resume_Company.pdf.
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
  const [tailoring, profile] = await Promise.all([
    supabase
      .from("tailorings")
      .select("pdf_path, posting:postings(company:companies(name))")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("profiles").select("name").maybeSingle(),
  ]);
  const path = tailoring.data?.pdf_path;
  if (!path) return new Response("Not found.", { status: 404 });

  const { data: file, error } = await supabase.storage
    .from("pdfs")
    .download(path);
  if (error || !file) return new Response("Not found.", { status: 404 });

  const name = pdfFileName(
    profile.data?.name ?? "",
    tailoring.data?.posting?.company?.name ?? "",
  );
  return new Response(file, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}
