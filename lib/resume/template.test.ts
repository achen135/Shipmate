// @vitest-environment node
import { describe, expect, it } from "vitest";

import { IMPORT_CASES } from "./__fixtures__/import-cases";
import { fromImported } from "./structured";
import { escapeHtml, renderResumeHtml, safeHref } from "./template";

describe("renderResumeHtml", () => {
  const content = fromImported(IMPORT_CASES[0].faithful);
  const html = renderResumeHtml(content);

  it("prints the user's section titles in their order", () => {
    const titles = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]);
    expect(titles).toEqual([
      "Education",
      "Experience",
      "Projects",
      "Technical Skills",
    ]);
  });

  it("is ATS-safe: real text, one column, no tables or images", () => {
    expect(html).not.toMatch(/<table|<img|<svg|<canvas|position:\s*absolute/i);
    expect(html).toContain(
      "<li>Built a Python service that cut report generation time by 40%</li>",
    );
    expect(html).toContain(
      '<span class="label">Languages:</span> Python, Go, TypeScript, SQL',
    );
  });

  it("puts contact details in the body, with links", () => {
    expect(html).toContain(
      '<a href="mailto:jordan@example.edu">jordan@example.edu</a>',
    );
    expect(html).toContain(
      '<a href="https://github.com/jordanlee">github.com/jordanlee</a>',
    );
  });

  it("an untitled section prints without a heading", () => {
    const intro = renderResumeHtml(fromImported(IMPORT_CASES[3].faithful));
    expect(intro).toContain(
      '<section><p class="text">Designer-turned-engineer who likes building tools for small teams.</p></section>',
    );
  });

  it("escapes everything the user typed", () => {
    const evil = renderResumeHtml({
      header: {
        name: '<script>alert("x")</script>',
        email: "",
        phone: "",
        links: [{ label: "x", url: "javascript:alert(1)" }],
      },
      sections: [{ title: "<b>Hi</b>", layout: "text", text: "a & b" }],
    });
    expect(evil).not.toContain("<script>");
    expect(evil).not.toContain("javascript:");
    expect(evil).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(evil).toContain("a &amp; b");
  });
});

describe("safeHref", () => {
  it.each([
    ["github.com/x", "https://github.com/x"],
    ["https://x.dev", "https://x.dev/"],
    ["mailto:a@b.co", "mailto:a@b.co"],
    ["javascript:alert(1)", null],
    ["data:text/html,hi", null],
  ])("%s → %s", (input, expected) => {
    expect(safeHref(input)).toBe(expected);
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
