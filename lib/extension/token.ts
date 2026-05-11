import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * The extension's token: 32 random bytes, shown to the user once when they
 * connect, then kept only as its SHA-256 (extension_tokens.token_hash). A
 * fast hash is right here: the token is random, not a password, so there's
 * nothing to guess. Never logged, never shown again.
 */

const PREFIX = "shm_ext_";

export function mintToken(): { token: string; hash: string } {
  const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The token from `Authorization: Bearer …`, if it looks like one. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1] ?? "";
  return token.startsWith(PREFIX) && token.length <= 100 ? token : null;
}
