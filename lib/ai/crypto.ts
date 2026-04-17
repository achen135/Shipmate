/**
 * API key encryption at rest (CLAUDE.md hard rule 5): AES-256-GCM with a
 * master key that lives only in server env (Vercel) and the worker's Actions
 * secrets, never in the database or the repo.
 *
 * - A fresh random 12-byte nonce per key.
 * - The GCM auth tag is stored after the ciphertext, so a changed byte fails
 *   to decrypt instead of decrypting to garbage.
 * - The owner and provider are bound in as associated data: a ciphertext
 *   copied onto another user's row (or relabelled as the other provider)
 *   won't decrypt.
 *
 * `sealApiKey` is used when saving. `openApiKey` is imported by exactly one
 * module, lib/ai/index.ts (`getProvider`); a unit test enforces that.
 *
 * Not `server-only`: the worker (M7) decrypts too. Nothing here may run in a
 * browser, hence the guard.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { ProviderName } from "./types";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

export const MASTER_KEY_ENV = "API_KEY_ENCRYPTION_KEY";

export class MasterKeyError extends Error {
  constructor(problem: string) {
    // Never include the value itself.
    super(`${MASTER_KEY_ENV} ${problem}`);
    this.name = "MasterKeyError";
  }
}

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("API key encryption only runs on the server.");
  }
}

/** The 32-byte master key from env (base64), or a MasterKeyError. */
export function loadMasterKey(
  env: Record<string, string | undefined> = process.env,
): Buffer {
  assertServer();
  const raw = env[MASTER_KEY_ENV]?.trim();
  if (!raw) throw new MasterKeyError("isn't set.");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new MasterKeyError("isn't base64.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new MasterKeyError(
      `must be 32 bytes (got ${key.length}); generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

export type KeyOwner = { userId: string; provider: ProviderName };

export type SealedKey = { ciphertext: string; iv: string; last4: string };

function associatedData({ userId, provider }: KeyOwner): Buffer {
  return Buffer.from(`shipmate:api_key:${VERSION}:${userId}:${provider}`);
}

/** The last four characters, the only part of a key ever shown again. */
export function lastFour(apiKey: string): string {
  return apiKey.trim().slice(-4);
}

export function sealApiKey(
  apiKey: string,
  owner: KeyOwner,
  masterKey: Buffer,
): SealedKey {
  assertServer();
  const plain = apiKey.trim();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(associatedData(owner));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]).toString("base64"),
    iv: nonce.toString("base64"),
    last4: lastFour(plain),
  };
}

export class KeyDecryptError extends Error {
  constructor() {
    super(
      "The saved API key can't be decrypted (the master key changed, or the row was altered). Remove it and add it again.",
    );
    this.name = "KeyDecryptError";
  }
}

export function openApiKey(
  sealed: { ciphertext: string; iv: string },
  owner: KeyOwner,
  masterKey: Buffer,
): string {
  assertServer();
  try {
    const nonce = Buffer.from(sealed.iv, "base64");
    const data = Buffer.from(sealed.ciphertext, "base64");
    if (nonce.length !== NONCE_BYTES || data.length <= TAG_BYTES) {
      throw new KeyDecryptError();
    }
    const decipher = createDecipheriv(ALGORITHM, masterKey, nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(associatedData(owner));
    decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(data.subarray(0, data.length - TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Node's own message says nothing useful and nothing secret, but one
    // fixed error keeps every failure the same to the caller.
    throw new KeyDecryptError();
  }
}
