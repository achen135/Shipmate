import "server-only";

import { ServerSecretError } from "@/lib/server-secret";

import { ExtensionAuthError } from "./server";
import { bearerToken } from "./token";

export const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });

/**
 * Run an extension route: the token from the Authorization header, and
 * the same answers for the same failures everywhere. Logs a label and the
 * error's name only.
 */
export async function withToken(
  request: Request,
  label: string,
  handle: (token: string) => Promise<Response>,
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) {
    return json(
      {
        ok: false,
        reason: "not_connected",
        message: new ExtensionAuthError().message,
      },
      401,
    );
  }
  try {
    return await handle(token);
  } catch (error) {
    if (error instanceof ExtensionAuthError) {
      return json(
        { ok: false, reason: "not_connected", message: error.message },
        401,
      );
    }
    console.error(
      `[extension] ${label} failed: ${error instanceof Error ? error.name : "unknown"}`,
    );
    return json(
      {
        ok: false,
        reason: "error",
        message:
          error instanceof ServerSecretError
            ? "Shipmate isn't set up for the extension yet."
            : "Something went wrong. Try again.",
      },
      error instanceof ServerSecretError ? 503 : 500,
    );
  }
}
