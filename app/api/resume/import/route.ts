import { KeyDecryptError, MasterKeyError } from "@/lib/ai/crypto";
import {
  type AiProvider,
  AiError,
  NoKeyError,
  SHARED_BUSY_MESSAGE,
  SHARED_OVERLOADED_MESSAGE,
} from "@/lib/ai";
import { isOverloaded } from "@/lib/ai/errors";
import { providerFor } from "@/lib/ai/keys";
import { retryOverloaded } from "@/lib/ai/retry";
import { getInvited } from "@/lib/auth/viewer";
import { type FileText, readResumeFile } from "@/lib/resume/file";
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
 * (inside providerFor → getProvider) needs the server secret.
 *
 * Problems with the request itself (signed out, no file, a bad file) answer
 * with a plain JSON error. Past that, the answer is a stream of JSON lines
 * (ImportEvent): `{ retrying }` each time an overloaded model (503) is tried
 * again, then the outcome, `{ ok: true, sections, notes }` or
 * `{ ok: false, message }`. The status is 200 once streaming starts, so the
 * outcome line is what says whether it worked.
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

  // From here the answer streams: a line when a retry starts, so the page
  // can say so while it happens, then one line with the outcome.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ImportEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        send(await importAndSave(viewer.id, read, send));
      } catch (error) {
        console.error(
          "[resume] import stream crashed:",
          error instanceof Error ? error.name : "unknown",
        );
        send({ ok: false, message: "Something went wrong. Try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

/** One line of the streamed answer (components/resume/resume-import.tsx). */
type ImportEvent =
  | { retrying: string }
  | { ok: true; sections: string[]; notes: number }
  | { ok: false; message: string };

/** Who to name when a model is busy: the shared key is always Google. */
const WHO: Record<AiProvider["name"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

async function importAndSave(
  userId: string,
  read: Extract<FileText, { ok: true }>,
  send: (event: ImportEvent) => void,
): Promise<ImportEvent> {
  let result;
  let provider: AiProvider | null = null;
  try {
    provider = await providerFor(userId);
    const ready = provider;
    // A 503 (overloaded) often clears in seconds: try again a couple of
    // times before saying anything, and tell the page while it happens.
    result = await retryOverloaded(
      () => importResume(ready, read.text, read.bold),
      {
        onRetry: (attempt) => {
          console.warn(`[resume] model overloaded (503); retry ${attempt}`);
          send({ retrying: WHO[ready.name] });
        },
      },
    );
  } catch (error) {
    if (error instanceof NoKeyError || error instanceof KeyDecryptError) {
      return { ok: false, message: error.message };
    }
    if (isOverloaded(error)) {
      console.warn(`[resume] model still overloaded (503) after retries`);
      return {
        ok: false,
        message: provider?.shared ? SHARED_OVERLOADED_MESSAGE : error.message,
      };
    }
    if (
      error instanceof AiError &&
      error.code === "rate_limited" &&
      provider?.shared
    ) {
      console.warn(`[resume] shared key rate-limited`);
      return { ok: false, message: SHARED_BUSY_MESSAGE };
    }
    if (error instanceof AiError) {
      console.warn(
        `[resume] import failed: ${error.code} ${error.status ?? ""}`,
      );
      return { ok: false, message: error.message };
    }
    if (error instanceof MasterKeyError) {
      console.error(`[resume] import: ${error.message}`);
      return {
        ok: false,
        message: "Shipmate can't use keys right now. Tell Alex.",
      };
    }
    console.error(
      "[resume] import crashed:",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, message: "Something went wrong. Try again." };
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
    return { ok: false, message: "Read it, but couldn't save. Try again." };
  }
  return {
    ok: true,
    sections: content.sections.map((s) => s.title),
    notes: notes.length,
  };
}
