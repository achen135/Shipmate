// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Structural guards for the key-handling rules (CLAUDE.md hard rule 5):
 * decryption happens in one module, and the service-role client is used
 * only for keys. A new import of either fails here, so it gets a deliberate
 * look instead of slipping in.
 */

const ROOT = join(__dirname, "..", "..");
const SKIP = new Set(["node_modules", ".next", ".git", "test-results", "docs"]);

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

  it("only the key code uses the service-role client in the app", () => {
    expect(users(/@\/lib\/supabase\/admin|supabase\/admin"/)).toEqual([
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
      /NEXT_PUBLIC_(API_KEY_ENCRYPTION|SUPABASE_SERVICE_ROLE|ANTHROPIC|OPENAI)/,
    );
    expect(leaks).toEqual([]);
  });
});
