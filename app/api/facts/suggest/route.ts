import { KeyDecryptError, MasterKeyError } from "@/lib/ai/crypto";
import {
  type AiProvider,
  AiError,
  NoKeyError,
  SHARED_BUSY_MESSAGE,
} from "@/lib/ai";
import { providerFor } from "@/lib/ai/keys";
import { getInvited } from "@/lib/auth/viewer";
import { suggestFacts } from "@/lib/facts/extract";
import { readResumeFile } from "@/lib/resume/file";
import { MAX_RESUME_BYTES } from "@/lib/resume/pdf";
import { parseContent, resumeToText } from "@/lib/resume/structured";
import { createClient } from "@/lib/supabase/server";

/**
 * AI mode: POST multipart `file` (a longer CV or a LinkedIn PDF export) →
 * suggested fact-bank entries that aren't on the resume. Nothing is saved
 * here: the user ticks what to keep and the page saves those
 * (addSuggestedFacts). The file isn't stored.
 */

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

  const supabase = await createClient();
  const { data: resume } = await supabase
    .from("resumes")
    .select("content, text_content")
    .maybeSingle();
  const structured = parseContent(resume?.content);
  const resumeText = structured
    ? resumeToText(structured)
    : (resume?.text_content ?? "");

  let provider: AiProvider | null = null;
  try {
    provider = await providerFor(viewer.id);
    const { suggestions, usage } = await suggestFacts(
      provider,
      resumeText,
      read.text,
    );
    console.log(
      `[facts] suggested with ${usage.provider} ${usage.model}: ${usage.inputTokens} in / ${usage.outputTokens} out, ${suggestions.length} suggestions`,
    );
    return json({ suggestions });
  } catch (error) {
    if (error instanceof NoKeyError) {
      return json({ message: error.message }, 503);
    }
    if (error instanceof KeyDecryptError) {
      return json({ message: error.message }, 409);
    }
    if (
      error instanceof AiError &&
      error.code === "rate_limited" &&
      provider?.shared
    ) {
      console.warn(`[facts] shared key rate-limited`);
      return json({ message: SHARED_BUSY_MESSAGE }, 503);
    }
    if (error instanceof AiError) {
      console.warn(
        `[facts] suggest failed: ${error.code} ${error.status ?? ""}`,
      );
      return json({ message: error.message }, 502);
    }
    if (error instanceof MasterKeyError) {
      console.error(`[facts] suggest: ${error.message}`);
      return json(
        { message: "Shipmate can't use keys right now. Tell Alex." },
        500,
      );
    }
    console.error(
      "[facts] suggest crashed:",
      error instanceof Error ? error.name : "unknown",
    );
    return json({ message: "Something went wrong. Try again." }, 500);
  }
}
