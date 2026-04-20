// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Structural guards for the key-handling rules (CLAUDE.md hard rule 5):
 * decryption happens in one module, the sealed key is fetched in one, and
 * the web app never touches the service-role key. A new use of any of them
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
      /NEXT_PUBLIC_(API_KEY_|SUPABASE_SERVICE_ROLE|ANTHROPIC|OPENAI)/,
    );
    expect(leaks).toEqual([]);
  });
});
