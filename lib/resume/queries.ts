import "server-only";

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
