import "server-only";

import { parseContent } from "@/lib/resume/structured";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user's uploaded resume row, or null (RLS: their own only). */
export async function getResume() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resumes")
    .select("file_name, file_path, text_content, updated_at")
    .maybeSingle();
  if (error) throw new Error(`resume: ${error.message}`);
  return data;
}

/** The structured resume and the import's unresolved notes, if any. */
export async function getStructuredResume() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resumes")
    .select("content, import_notes, updated_at")
    .maybeSingle();
  if (error) throw new Error(`resume: ${error.message}`);
  const content = parseContent(data?.content);
  const notes = Array.isArray(data?.import_notes)
    ? (data.import_notes as { where: string; message: string }[])
    : [];
  return { content, notes };
}
