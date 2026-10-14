// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readResumeFile } from "./file";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "__fixtures__", name)));

describe("readResumeFile", () => {
  it("reads a DOCX's paragraphs as lines", async () => {
    const result = await readResumeFile(fixture("sample-resume.docx"));
    expect(result).toMatchObject({ ok: true, kind: "docx" });
    if (!result.ok) return;
    const lines = result.text.split(/\n+/);
    expect(lines).toContain("Selected Work");
    expect(lines).toContain("Where I've Studied");
  });

  it("reads a PDF with M5's reader", async () => {
    const result = await readResumeFile(fixture("sample-resume.pdf"));
    expect(result).toMatchObject({ ok: true, kind: "pdf" });
    if (result.ok) expect(result.text).toContain("Experience");
  });

  it("refuses anything else", async () => {
    expect(
      await readResumeFile(new TextEncoder().encode("hello world")),
    ).toEqual({
      ok: false,
      message: "Upload a PDF or a Word (.docx) file.",
    });
    expect(await readResumeFile(new Uint8Array())).toMatchObject({ ok: false });
  });

  it("a ZIP that isn't a Word file is a readable error, not a crash", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]);
    const result = await readResumeFile(zip);
    expect(result).toMatchObject({ ok: false });
  });
});
