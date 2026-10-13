// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { keywordMatch } from "@/lib/review/keywords";

import { MAX_RESUME_BYTES, looksLikePdf, readResumePdf } from "./pdf";

const sample = new Uint8Array(
  readFileSync(join(__dirname, "__fixtures__", "sample-resume.pdf")),
);

describe("readResumePdf", () => {
  it("reads a real resume's text", async () => {
    const result = await readResumePdf(sample);
    expect(result).toMatchObject({ ok: true, pages: 1 });
    if (!result.ok) return;
    expect(result.text).toContain("Software Engineering Intern");
    expect(result.text).toContain("Kubernetes");
  });

  it("gives the keyword match something to compare", async () => {
    const result = await readResumePdf(sample);
    if (!result.ok) throw new Error("unreadable");
    const match = keywordMatch(
      {
        title: "Backend Software Engineer Intern",
        category: "Software",
        description:
          "Build REST APIs in Python with PostgreSQL and Redis. Deploy with Docker on AWS. Algorithms and data structures.",
      },
      result.text,
    );
    expect(match.score).toBeGreaterThan(40);
    expect(match.matched).toContain("python");
  });

  it("doesn't consume the caller's buffer", async () => {
    await readResumePdf(sample);
    expect(sample.byteLength).toBeGreaterThan(1000);
  });

  it.each([
    ["an empty file", new Uint8Array(0), /empty/],
    [
      "text pretending to be a PDF",
      new TextEncoder().encode("hello world, not a pdf"),
      /doesn't look like a PDF/,
    ],
    ["a file over 4 MB", new Uint8Array(MAX_RESUME_BYTES + 1), /under 4 MB/],
  ])("rejects %s", async (_name, bytes, message) => {
    const result = await readResumePdf(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it("rejects a PDF header on garbage as unreadable, not a crash", async () => {
    const result = await readResumePdf(
      new TextEncoder().encode("%PDF-1.4\nnot really"),
    );
    expect(result).toMatchObject({ ok: false });
  });
});

describe("looksLikePdf", () => {
  it("checks the magic bytes", () => {
    expect(looksLikePdf(sample)).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("PK\u0003\u0004 docx"))).toBe(
      false,
    );
  });
});
