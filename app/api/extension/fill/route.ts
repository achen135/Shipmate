import { z } from "zod";

import { json, withToken } from "@/lib/extension/respond";
import { extensionFill } from "@/lib/extension/server";

/**
 * POST { url, marker? } with the extension's token: the answer sheet for
 * the application page at `url`, and whether to fill it without a click.
 */
const bodySchema = z.object({
  url: z.url().max(2000),
  marker: z.string().max(300).nullish(),
});

export async function POST(request: Request) {
  return withToken(request, "fill", async (token) => {
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return json(
        { ok: false, reason: "bad_request", message: "Bad request." },
        400,
      );
    }
    return json(
      await extensionFill(token, {
        url: body.data.url,
        marker: body.data.marker ?? null,
      }),
    );
  });
}
