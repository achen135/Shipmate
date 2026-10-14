// @vitest-environment node
import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  KeyDecryptError,
  MasterKeyError,
  lastFour,
  loadMasterKey,
  openApiKey,
  sealApiKey,
} from "./crypto";

const master = randomBytes(32);
const alex = {
  userId: "11111111-1111-4111-8111-111111111111",
  provider: "anthropic",
} as const;
const key = "sk-ant-api03-EXAMPLEexampleEXAMPLEexample-7f3a";

describe("sealApiKey / openApiKey", () => {
  it("round-trips: decrypt(encrypt(key)) is the key", () => {
    const sealed = sealApiKey(key, alex, master);
    expect(openApiKey(sealed, alex, master)).toBe(key);
  });

  it("stores nothing readable: no part of the key is in the ciphertext", () => {
    const sealed = sealApiKey(key, alex, master);
    const raw = Buffer.from(sealed.ciphertext, "base64").toString("latin1");
    expect(raw).not.toContain("sk-ant");
    expect(sealed.ciphertext).not.toContain(key);
    expect(sealed.last4).toBe("7f3a");
  });

  it("uses a fresh nonce every time", () => {
    const a = sealApiKey(key, alex, master);
    const b = sealApiKey(key, alex, master);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
  });

  it("trims pasted whitespace before sealing", () => {
    const sealed = sealApiKey(`  ${key}\n`, alex, master);
    expect(openApiKey(sealed, alex, master)).toBe(key);
  });

  it("won't decrypt with another master key", () => {
    const sealed = sealApiKey(key, alex, master);
    expect(() => openApiKey(sealed, alex, randomBytes(32))).toThrow(
      KeyDecryptError,
    );
  });

  it("won't decrypt on another user's row (owner is bound in)", () => {
    const sealed = sealApiKey(key, alex, master);
    const sam = { ...alex, userId: "22222222-2222-4222-8222-222222222222" };
    expect(() => openApiKey(sealed, sam, master)).toThrow(KeyDecryptError);
  });

  it("won't decrypt if relabelled as the other provider", () => {
    const sealed = sealApiKey(key, alex, master);
    expect(() =>
      openApiKey(sealed, { ...alex, provider: "openai" }, master),
    ).toThrow(KeyDecryptError);
  });

  it("detects a changed byte (GCM tag)", () => {
    const sealed = sealApiKey(key, alex, master);
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[0] ^= 1;
    expect(() =>
      openApiKey(
        { ...sealed, ciphertext: bytes.toString("base64") },
        alex,
        master,
      ),
    ).toThrow(KeyDecryptError);
  });

  it("a decrypt failure never echoes the ciphertext or key", () => {
    const sealed = sealApiKey(key, alex, master);
    try {
      openApiKey(sealed, alex, randomBytes(32));
    } catch (error) {
      expect(String(error)).not.toContain(sealed.ciphertext);
      expect(String(error)).not.toContain(key);
    }
  });
});

describe("loadMasterKey", () => {
  const env = (value?: string) => ({ API_KEY_ENCRYPTION_KEY: value });

  it("reads 32 base64 bytes", () => {
    const value = master.toString("base64");
    expect(loadMasterKey(env(value)).equals(master)).toBe(true);
  });

  it("refuses missing, non-base64, and wrong-length keys without echoing them", () => {
    expect(() => loadMasterKey(env())).toThrow(MasterKeyError);
    expect(() => loadMasterKey(env("not base64 at all!"))).toThrow(
      "isn't base64",
    );
    const short = randomBytes(16).toString("base64");
    try {
      loadMasterKey(env(short));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain("must be 32 bytes (got 16)");
      expect(String(error)).not.toContain(short);
    }
  });
});

describe("lastFour", () => {
  it("is the last four characters, trimmed", () => {
    expect(lastFour(" sk-abcd1234 \n")).toBe("1234");
  });
});
