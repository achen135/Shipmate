import { getInvited } from "@/lib/auth/viewer";
import { MAX_RESUME_BYTES, readResumePdf } from "@/lib/resume/pdf";
import { createClient } from "@/lib/supabase/server";

/**
 * The Simple-mode resume: one PDF per person, kept at
 * `uploads/{user}/resume-{stamp}.pdf`. A new upload gets a new path, and the
 * previous file is removed unless an application recorded it as the resume
 * it was sent with (user_postings.resume_used), so that record always
 * points at the exact file. Remove deletes the current file regardless:
 * that's the user's explicit choice.
 *
 *   POST   multipart `file`  → store it, read its text for the keyword match
 *   GET                      → redirect to a 60-second signed link (Open)
 *   DELETE                   → remove the file and its row
 *
 * Everything runs as the signed-in user, so the bucket and table policies
 * (not just this code) keep each person to their own folder and row.
 */

const BUCKET = "uploads";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });

export async function POST(request: Request) {
  const member = await getInvited();
  if (!member) return json({ message: "Sign in first." }, 401);

  // Refuse before buffering a huge body; the form data adds a little overhead.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_RESUME_BYTES + 64 * 1024) {
    return json({ message: "Keep the PDF under 4 MB." }, 413);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return json({ message: "Choose a PDF to upload." }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = await readResumePdf(bytes);
  if (!checked.ok) return json({ message: checked.message }, 400);

  const supabase = await createClient();
  const path = `${member.id}/resume-${Date.now().toString(36)}.pdf`;
  const upload = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upload.error) {
    console.error("[resume] upload failed:", upload.error.message);
    return json({ message: "Couldn't save the file. Try again." }, 500);
  }

  const fileName = (file.name || "resume.pdf").slice(0, 200);
  // The row may already hold a structured resume (AI mode): keep its kind.
  const { data: existing } = await supabase
    .from("resumes")
    .select("content, file_path")
    .maybeSingle();
  const { error } = await supabase.from("resumes").upsert(
    {
      kind: existing?.content ? "structured" : "uploaded_pdf",
      file_path: path,
      file_name: fileName,
      text_content: checked.text,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("[resume] row failed:", error.message);
    await supabase.storage.from(BUCKET).remove([path]);
    return json({ message: "Couldn't save the file. Try again." }, 500);
  }
  const previous = existing?.file_path;
  if (previous && previous !== path) {
    const { count } = await supabase
      .from("user_postings")
      .select("id", { count: "exact", head: true })
      .eq("resume_used->>path", previous);
    if (count === 0) await supabase.storage.from(BUCKET).remove([previous]);
  }
  return json({
    fileName,
    pages: checked.pages,
    readable: checked.text.length > 0,
  });
}

export async function GET() {
  const member = await getInvited();
  if (!member) return new Response("Sign in first.", { status: 401 });

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("resumes")
    .select("file_path")
    .maybeSingle();
  if (!row?.file_path)
    return new Response("No resume uploaded.", { status: 404 });

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.file_path, 60);
  if (error || !data)
    return new Response("Couldn't open the file.", { status: 500 });
  return new Response(null, {
    status: 302,
    headers: { location: data.signedUrl, "cache-control": "private, no-store" },
  });
}

export async function DELETE() {
  const member = await getInvited();
  if (!member) return json({ message: "Sign in first." }, 401);

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("resumes")
    .select("file_path, content")
    .maybeSingle();
  if (row?.file_path)
    await supabase.storage.from(BUCKET).remove([row.file_path]);
  // A structured resume shares the row: keep it, drop only the file.
  const { error } = row?.content
    ? await supabase
        .from("resumes")
        .update({
          kind: "structured",
          file_path: null,
          file_name: null,
          text_content: null,
        })
        .eq("user_id", member.id)
    : await supabase.from("resumes").delete().eq("user_id", member.id);
  if (error) {
    console.error("[resume] delete failed:", error.message);
    return json({ message: "Couldn't remove it. Try again." }, 500);
  }
  return json({ ok: true });
}
