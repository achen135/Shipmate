import { z } from "zod";

import { json, withToken } from "@/lib/extension/respond";
import { extensionPdf } from "@/lib/extension/server";

/**
 * GET ?up=<user_posting_id> with the extension's token: the resume to
 * attach (the posting's latest tailored PDF, else the uploaded one), with
 * its file name and storage path in headers so the extension can name the
 * file and later record exactly this one as sent.
 */
export async function GET(request: Request) {
  return withToken(request, "pdf", async (token) => {
    const up = new URL(request.url).searchParams.get("up") ?? "";
    if (!z.uuid().safeParse(up).success) {
      return json({ ok: false, message: "Bad request." }, 400);
    }
    const pdf = await extensionPdf(token, up);
    if (!pdf) return json({ ok: false, message: "No resume to attach." }, 404);
    return new Response(pdf.bytes, {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "private, no-store",
        "x-shipmate-file-name": encodeURIComponent(pdf.name),
        "x-shipmate-path": encodeURIComponent(pdf.path),
      },
    });
  });
}
