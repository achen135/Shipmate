import { z } from "zod";

import { json, withToken } from "@/lib/extension/respond";
import { extensionSubmitted } from "@/lib/extension/server";

/**
 * POST { userPostingId, path? } with the extension's token: the user says
 * they submitted it. Marks it applied and records the PDF the extension
 * attached (`path`) as the one sent.
 */
const bodySchema = z.object({
  userPostingId: z.uuid(),
  path: z.string().max(300).nullish(),
});

export async function POST(request: Request) {
  return withToken(request, "submitted", async (token) => {
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return json({ ok: false, message: "Bad request." }, 400);
    }
    return json(
      await extensionSubmitted(token, {
        userPostingId: body.data.userPostingId,
        path: body.data.path ?? null,
      }),
    );
  });
}
