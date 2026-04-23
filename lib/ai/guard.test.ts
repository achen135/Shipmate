// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Structural guards for the key-handling rules (CLAUDE.md hard rule 5):
 * decryption happens in one module, the sealed key and the shared Gemini key
 * are each fetched in one place per side (web server, worker), and the web
 * app never touches the service-role key. A new use of any of them
 * fails here, so it gets a deliberate look instead of slipping in.
 */

const ROOT = join(__dirname, "..", "..");
const SKIP = new Set([
  "node_modules",
  ".next",
  ".git",
  "test-results",
  "docs",
  "supabase",
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) out.push(path);
  }
  return out;
}

const files = sourceFiles(ROOT).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

const users = (pattern: RegExp) =>
  files
    .filter((f) => !f.path.endsWith(".test.ts"))
    .filter((f) => pattern.test(f.text))
    .map((f) => f.path)
    .sort();

describe("key handling stays in its boxes", () => {
  it("only lib/ai/index.ts (getProvider) decrypts a stored key", () => {
    expect(users(/\bopenApiKey\b/)).toEqual([
      "lib/ai/crypto.ts",
      "lib/ai/index.ts",
    ]);
  });

  it("the web app never uses the service-role key", () => {
    const appSide = files.filter((f) => /^(app|components|lib)\//.test(f.path));
    const offenders = appSide
      .filter((f) => !f.path.endsWith(".test.ts"))
      .filter((f) => /SUPABASE_SERVICE_ROLE_KEY|supabase\/admin/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("only lib/ai/keys.ts asks the database for a sealed key", () => {
    expect(users(/rpc\("(sealed_api_key|save_api_key)"/)).toEqual([
      "lib/ai/keys.ts",
    ]);
  });

  it("the shared Gemini key is fetched only in lib/ai: keys.ts for the web server, index.ts for the worker", () => {
    expect(users(/rpc\("shared_ai_key"/)).toEqual(["lib/ai/keys.ts"]);
    expect(users(/rpc\("worker_shared_ai_key"/)).toEqual(["lib/ai/index.ts"]);
  });

  it("no code reads the shared key's Vault secret by name", () => {
    expect(users(/shared_google_api_key/)).toEqual([]);
  });

  it("client components import only the AI layer's plain data (models, types)", () => {
    const allowed = new Set(["@/lib/ai/models", "@/lib/ai/types"]);
    const offenders = files
      .filter((f) => /^["']use client["']/m.test(f.text))
      .flatMap((f) =>
        [...f.text.matchAll(/from\s+"(@\/lib\/(?:ai[^"]*|supabase\/admin))"/g)]
          .map((m) => m[1])
          .filter((spec) => !allowed.has(spec))
          .map((spec) => `${f.path} → ${spec}`),
      );
    expect(offenders).toEqual([]);
  });

  it("no NEXT_PUBLIC_ name for a secret", () => {
    const leaks = users(
      /NEXT_PUBLIC_(API_KEY_|SUPABASE_SERVICE_ROLE|ANTHROPIC|OPENAI|GOOGLE|GEMINI|SHARED_)/,
    );
    expect(leaks).toEqual([]);
  });
});
