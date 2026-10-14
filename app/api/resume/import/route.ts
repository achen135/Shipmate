import { KeyDecryptError, MasterKeyError } from "@/lib/ai/crypto";
import { AiError, NoKeyError } from "@/lib/ai";
import { providerFor } from "@/lib/ai/keys";
import { getInvited } from "@/lib/auth/viewer";
import { readResumeFile } from "@/lib/resume/file";
import { importResume } from "@/lib/resume/import";
import { MAX_RESUME_BYTES } from "@/lib/resume/pdf";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * AI mode: POST multipart `file` (PDF or DOCX) → the user's AI provider
 * reads it into a structured resume, which replaces `resumes.content`.
 * The file itself isn't stored. The uploaded PDF (Simple mode), if any,
 * stays as it is.
 *
 * Runs as the signed-in user for the database write; only the key lookup
 * (inside providerFor → getProvider) uses the service role.
 */

// A two-page resume takes the model around a minute; Hobby allows 300 s.
export const maxDuration = 300;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });

export async function POST(request: Request) {
  const viewer = await getInvited();
  if (!viewer) return json({ message: "Sign in first." }, 401);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_RESUME_BYTES + 64 * 1024) {
    return json({ message: "Keep the file under 4 MB." }, 413);
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return json({ message: "Choose a PDF or Word file." }, 400);
  }
  const read = await readResumeFile(new Uint8Array(await file.arrayBuffer()));
  if (!read.ok) return json({ message: read.message }, 400);

  let result;
  try {
    const provider = await providerFor(viewer.id);
    result = await importResume(provider, read.text);
  } catch (error) {
    if (error instanceof NoKeyError) {
      return json({ message: "Add an API key in Profile → AI first." }, 400);
    }
    if (error instanceof KeyDecryptError) {
      return json({ message: error.message }, 409);
    }
    if (error instanceof AiError) {
      console.warn(
        `[resume] import failed: ${error.code} ${error.status ?? ""}`,
      );
      return json({ message: error.message }, 502);
    }
    if (error instanceof MasterKeyError) {
      console.error(`[resume] import: ${error.message}`);
      return json(
        { message: "Shipmate can't use keys right now. Tell Alex." },
        500,
      );
    }
    console.error(
      "[resume] import crashed:",
      error instanceof Error ? error.name : "unknown",
    );
    return json({ message: "Something went wrong. Try again." }, 500);
  }

  const { content, notes, usage } = result;
  console.log(
    `[resume] imported with ${usage.provider} ${usage.model}: ${usage.inputTokens} in / ${usage.outputTokens} out, ${content.sections.length} sections, ${notes.length} notes`,
  );

  const supabase = await createClient();
  const { error } = await supabase.from("resumes").upsert(
    {
      kind: "structured",
      content: content as unknown as Json,
      import_notes: notes as unknown as Json,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("[resume] save import failed:", error.message);
    return json({ message: "Read it, but couldn't save. Try again." }, 500);
  }
  return json({
    sections: content.sections.map((s) => s.title),
    notes: notes.length,
  });
}
