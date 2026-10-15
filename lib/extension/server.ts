import "server-only";

import { z } from "zod";

import { withE2eOrigin } from "@/lib/e2e-origin";
import { canonicalizeUrl, parseAtsJob } from "@/lib/postings/url";
import { questionsAreFresh } from "@/lib/questions/cache";
import { fetchQuestions } from "@/lib/questions/fetch";
import { type BoardHint, locateForm } from "@/lib/questions/locate";
import { toAnswerProfile } from "@/lib/questions/profile";
import { buildSheet } from "@/lib/questions/sheet";
import {
  type QuestionsStatus,
  type RawQuestion,
  readStoredQuestions,
} from "@/lib/questions/types";
import { ServerSecretError, serverSecret } from "@/lib/server-secret";
import { createAnonClient } from "@/lib/supabase/anon";
import { pdfFileName } from "@/lib/tailor/pdf-name";

import { readMarker } from "./marker";
import type { FillResponse, SubmittedResponse } from "./protocol";
import { toFillQuestions } from "./sheet";
import { hashToken } from "./token";

/**
 * The extension's side of the app (M8 §2): what the /api/extension/*
 * routes do. No session and no service-role key: each call goes through an
 * extension_* database function with the server secret and the token's
 * hash (supabase/migrations/20260511100000_extension.sql), which works out
 * whose token it is and acts only on that person's rows.
 *
 * Logging: error codes only. Never a token, a hash, a profile, a URL with a
 * marker, or a PDF.
 */

export class ExtensionAuthError extends Error {
  constructor() {
    super(
      "The extension isn't connected. Connect it in Shipmate → Profile → Browser extension.",
    );
    this.name = "ExtensionAuthError";
  }
}

const isAuthError = (error: { code?: string } | null) =>
  error?.code === "28000";

const contextSchema = z.union([
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    auto: z.boolean(),
    user_posting_id: z.string(),
    status: z.string(),
    posting: z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      canonical_url: z.string(),
      company: z.string().nullable(),
      questions: z.unknown(),
      questions_status: z.string().nullable(),
      questions_fetched_at: z.string().nullable(),
    }),
    boards: z.array(
      z.object({ kind: z.string(), slug: z.string(), eu: z.boolean() }),
    ),
    profile: z
      .object({
        name: z.string().nullable(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
        school: z.string().nullable(),
        degree: z.string().nullable(),
        major: z.string().nullable(),
        grad_month: z.number().nullable(),
        grad_year: z.number().nullable(),
        work_authorized: z.boolean().nullable(),
        needs_sponsorship: z.boolean().nullable(),
        standard_answers: z.unknown(),
      })
      .nullable(),
    pdf: z
      .object({
        kind: z.enum(["tailored", "uploaded"]),
        bucket: z.enum(["pdfs", "uploads"]),
        path: z.string(),
        name: z.string().nullable(),
      })
      .nullable(),
  }),
]);

const isStatus = (value: string | null): value is QuestionsStatus =>
  value === "ok" || value === "unknown" || value === "failed";

/** The page's questions: the cached copy if fresh, else fetched now. */
async function questionsFor(
  posting: z.infer<typeof contextSchema> & { found: true },
): Promise<{ status: QuestionsStatus; questions: RawQuestion[] }> {
  const { posting: p, boards } = posting;
  const status = isStatus(p.questions_status) ? p.questions_status : null;
  if (status && questionsAreFresh(status, p.questions_fetched_at, Date.now())) {
    return {
      status,
      questions: status === "ok" ? readStoredQuestions(p.questions) : [],
    };
  }
  // Not cached for everyone here: that's the review page's job, as the user.
  const result = await fetchQuestions(
    locateForm({
      urls: [p.url, p.canonical_url],
      company: p.company ?? "",
      boards: boards as BoardHint[],
    }),
    withE2eOrigin(fetch, process.env),
  );
  return {
    status: result.status,
    questions: result.status === "ok" ? result.questions : [],
  };
}

export async function extensionFill(
  token: string,
  input: { url: string; marker: string | null },
): Promise<FillResponse> {
  const job = parseAtsJob(input.url);
  if (!job || !["greenhouse", "lever", "ashby"].includes(job.ats)) {
    return {
      ok: false,
      reason: "not_supported",
      message:
        job?.ats === "workday"
          ? "Workday forms aren't supported yet: each company's is different. Use the answer sheet on Shipmate's review page to copy your answers."
          : "Shipmate fills Greenhouse, Lever and Ashby application forms. Use the answer sheet on Shipmate's review page for this one.",
    };
  }

  let marker: { userPostingId: string; nonce: string } | null = null;
  try {
    marker = input.marker ? readMarker(input.marker) : null;
  } catch (error) {
    if (!(error instanceof ServerSecretError)) throw error;
  }

  const { data, error } = await createAnonClient().rpc("extension_context", {
    p_secret: serverSecret(),
    p_token_hash: hashToken(token),
    p_ats: job.ats,
    p_ats_job_id: job.jobId,
    p_url: canonicalizeUrl(input.url),
    p_marker_user_posting_id: marker?.userPostingId,
    p_marker_nonce: marker?.nonce,
  });
  if (isAuthError(error)) throw new ExtensionAuthError();
  if (error) throw new Error(`extension_context: ${error.code}`);

  const context = contextSchema.parse(data);
  if (!context.found) {
    return {
      ok: false,
      reason: "not_found",
      message:
        "This posting isn't in your Shipmate Inbox, so there's nothing to fill it from. Find it in Shipmate first, or add it to your Tracker by its link.",
    };
  }

  const loaded = await questionsFor(context);
  const sheet = buildSheet(
    loaded.questions,
    toAnswerProfile(context.profile, null),
  );
  const questions = toFillQuestions(sheet);

  const pdf = context.pdf
    ? {
        kind: context.pdf.kind,
        name:
          context.pdf.kind === "tailored"
            ? pdfFileName(
                context.profile?.name ?? "",
                context.posting.company ?? "",
              )
            : (context.pdf.name ?? "resume.pdf"),
      }
    : null;

  return {
    ok: true,
    auto: context.auto,
    userPostingId: context.user_posting_id,
    posting: {
      title: context.posting.title,
      company: context.posting.company ?? "",
    },
    questionsStatus: loaded.status,
    questions,
    pdf,
  };
}

const pdfSchema = z
  .object({
    kind: z.enum(["tailored", "uploaded"]),
    bucket: z.enum(["pdfs", "uploads"]),
    path: z.string(),
    name: z.string().nullable(),
    company: z.string().nullable(),
    person: z.string().nullable(),
  })
  .nullable();

/** The resume to attach: its bytes, file name, and storage path. */
export async function extensionPdf(
  token: string,
  userPostingId: string,
): Promise<{ bytes: Blob; name: string; path: string } | null> {
  const db = createAnonClient();
  const { data, error } = await db.rpc("extension_pdf", {
    p_secret: serverSecret(),
    p_token_hash: hashToken(token),
    p_user_posting_id: userPostingId,
  });
  if (isAuthError(error)) throw new ExtensionAuthError();
  if (error) throw new Error(`extension_pdf: ${error.code}`);
  const pdf = pdfSchema.parse(data);
  if (!pdf) return null;
  // Readable for 60 seconds through the grant extension_pdf() just opened.
  const file = await db.storage.from(pdf.bucket).download(pdf.path);
  if (file.error || !file.data) return null;
  return {
    bytes: file.data,
    name:
      pdf.kind === "tailored"
        ? pdfFileName(pdf.person ?? "", pdf.company ?? "")
        : (pdf.name ?? "resume.pdf"),
    path: pdf.path,
  };
}

/** "I submitted it": applied, and the attached PDF recorded as sent. */
export async function extensionSubmitted(
  token: string,
  input: { userPostingId: string; path: string | null },
): Promise<SubmittedResponse> {
  const { data, error } = await createAnonClient().rpc("extension_submitted", {
    p_secret: serverSecret(),
    p_token_hash: hashToken(token),
    p_user_posting_id: input.userPostingId,
    p_path: input.path ?? undefined,
  });
  if (isAuthError(error)) throw new ExtensionAuthError();
  if (error) {
    console.error(`[extension] submitted failed: ${error.code}`);
    return {
      ok: false,
      message: "Couldn't record it. Mark it applied in Shipmate instead.",
    };
  }
  return { ok: true, recorded: data !== null };
}

/** Is this token connected? Throws ExtensionAuthError if not. */
export async function extensionCheck(token: string): Promise<true> {
  const { error } = await createAnonClient().rpc("extension_status", {
    p_secret: serverSecret(),
    p_token_hash: hashToken(token),
  });
  if (isAuthError(error)) throw new ExtensionAuthError();
  if (error) throw new Error(`extension_status: ${error.code}`);
  return true;
}
