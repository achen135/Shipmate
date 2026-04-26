/**
 * Resume → PDF in the worker (Spec "Resume format + PDF"): the editor's own
 * HTML (lib/resume/template.ts renderResumeHtml) printed by headless
 * Chromium, so the PDF is what the preview shows. Real, selectable text, one
 * column, US Letter.
 *
 * One browser per worker run, opened on first use. `measure` prints the
 * page and counts the PDF's pages (the authority on "one page"), and reads
 * how far the content runs past one page, so the trim step knows roughly
 * how much to cut.
 */

import { type Browser, chromium } from "playwright";
import { getDocumentProxy } from "unpdf";

import type { ResumeContent } from "@/lib/resume/structured";
import { renderResumeHtml } from "@/lib/resume/template";

/** Letter minus the template's @page margins (0.5in top/bottom, 0.55in sides), at 96 px/in. */
const PRINTABLE = { width: Math.round(7.4 * 96), height: 10 * 96 };

export type Printer = {
  pdf(content: ResumeContent): Promise<Buffer>;
  measure(content: ResumeContent): Promise<{ pages: number; overflow: number }>;
  close(): Promise<void>;
};

export function createPrinter(): Printer {
  let browser: Promise<Browser> | null = null;
  const open = () => (browser ??= chromium.launch());

  async function render(content: ResumeContent) {
    const page = await (await open()).newPage({ viewport: PRINTABLE });
    try {
      await page.emulateMedia({ media: "print" });
      await page.setContent(renderResumeHtml(content), { waitUntil: "load" });
      const height = await page.evaluate(
        () => document.querySelector(".page")?.scrollHeight ?? 0,
      );
      // Margins come from the template's own @page rule.
      const pdf = await page.pdf({
        format: "Letter",
        preferCSSPageSize: true,
        printBackground: false,
      });
      return { pdf, height };
    } finally {
      await page.close();
    }
  }

  return {
    async pdf(content) {
      return (await render(content)).pdf;
    },
    async measure(content) {
      const { pdf, height } = await render(content);
      const doc = await getDocumentProxy(new Uint8Array(pdf));
      return {
        pages: doc.numPages,
        overflow: Math.max(0, height / PRINTABLE.height - 1),
      };
    },
    async close() {
      if (browser) await (await browser).close();
      browser = null;
    },
  };
}
