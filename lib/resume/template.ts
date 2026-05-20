/**
 * The one resume template (Spec "Resume format + PDF"): Jake's-resume layout,
 * ATS-safe. A single column of real text: no tables, text boxes, images or
 * icons; contact details in the body; standard section rules.
 *
 * Pure: content in, a complete HTML document out. The editor's live preview
 * shows exactly this document in an iframe, and the PDF step (M7: headless
 * Chromium in the worker) prints the same string, so what the user sees is
 * what gets sent.
 */

import { renderBold } from "./bold";
import { type Entry, type ListItem, type ResumeContent } from "./structured";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Only web and mail links become links; anything else stays plain text. */
export function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^mailto:[^\s]+$/i.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

const link = (label: string, href: string | null) =>
  href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    : escapeHtml(label);

export const RESUME_CSS = `
@page { size: letter; margin: 0.5in 0.55in; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body {
  font-family: "CMU Serif", "Latin Modern Roman", "Computer Modern Serif", Georgia, "Times New Roman", serif;
  font-size: 10.5pt;
  line-height: 1.25;
}
.page { width: 8.5in; min-height: 11in; padding: 0.5in 0.55in; margin: 0 auto; }
@media print { .page { width: auto; min-height: 0; padding: 0; } }
a { color: inherit; text-decoration: underline; }
header { text-align: center; margin-bottom: 6pt; }
h1 { font-size: 24pt; font-weight: 700; font-variant: small-caps; margin: 0 0 2pt; letter-spacing: 0.5pt; }
.contact { font-size: 9.5pt; margin: 0; }
.contact .sep { margin: 0 5pt; }
section { margin-top: 7pt; }
h2 {
  font-size: 12pt; font-weight: 400; font-variant: small-caps; letter-spacing: 0.3pt;
  margin: 0 0 4pt; padding-bottom: 1pt; border-bottom: 0.6pt solid #000;
}
.entry { margin: 0 0 5pt 6pt; break-inside: avoid; }
.row { display: flex; justify-content: space-between; gap: 12pt; }
.row .right { text-align: right; white-space: nowrap; }
.heading { font-weight: 700; }
.sub { font-style: italic; font-size: 9.5pt; }
ul { margin: 2pt 0 0; padding-left: 16pt; }
li { font-size: 9.5pt; margin: 0 0 1pt; }
.list { margin: 0 0 0 6pt; padding: 0; list-style: none; }
.list li { font-size: 9.5pt; margin: 0 0 1pt; }
.list .label { font-weight: 700; }
p.text { margin: 0 0 0 6pt; font-size: 9.5pt; }
`;

/**
 * The PDF's font for the live preview (fix handoff, Finding 2). The worker
 * prints with CMU Serif installed (`fonts-cmu`, tailor.yml), so the PDF
 * never needs this; a browser usually doesn't have it and would show
 * Georgia. These are the same font files, served from /fonts/cmu-serif
 * (SIL Open Font License), so the preview is the PDF's font everywhere.
 */
export const PREVIEW_FONT_CSS = [
  ["500-roman", "normal", 400],
  ["500-italic", "italic", 400],
  ["700-roman", "normal", 700],
  ["700-italic", "italic", 700],
]
  .map(
    ([file, style, weight]) =>
      `@font-face { font-family: "CMU Serif"; font-style: ${style}; font-weight: ${weight}; font-display: block; src: url("/fonts/cmu-serif/cmu-serif-${file}.woff2") format("woff2"); }`,
  )
  .join("\n");

function renderEntry(entry: Entry): string {
  const first =
    entry.heading || entry.dates
      ? `<div class="row"><span class="heading">${escapeHtml(entry.heading)}</span><span class="right">${escapeHtml(entry.dates)}</span></div>`
      : "";
  const second =
    entry.subheading || entry.location
      ? `<div class="row sub"><span>${escapeHtml(entry.subheading)}</span><span class="right">${escapeHtml(entry.location)}</span></div>`
      : "";
  const bullets = entry.bullets.filter((b) => b.trim());
  const list = bullets.length
    ? `<ul>${bullets.map((b) => `<li>${renderBold(b)}</li>`).join("")}</ul>`
    : "";
  return `<div class="entry">${first}${second}${list}</div>`;
}

function renderListItem(item: ListItem): string {
  // Each value's own bold; the separator itself is never inside a span.
  const values = item.values
    .filter((v) => v.trim())
    .map(renderBold)
    .join(item.separator === ";" ? "; " : ", ");
  return item.label.trim()
    ? `<li><span class="label">${escapeHtml(item.label)}:</span> ${values}</li>`
    : `<li>${values}</li>`;
}

export function renderResumeHtml(
  content: ResumeContent,
  /** previewFont: the editor's preview (not the PDF): load CMU Serif. */
  options: { previewFont?: boolean } = {},
): string {
  const { header } = content;
  const contact = [
    header.location ? escapeHtml(header.location) : "",
    header.phone ? escapeHtml(header.phone) : "",
    header.email ? link(header.email, safeHref(`mailto:${header.email}`)) : "",
    ...header.links
      .filter((l) => l.label.trim() || l.url.trim())
      .map((l) => link(l.label || l.url, safeHref(l.url || l.label))),
  ].filter(Boolean);

  const sections = content.sections
    .map((section) => {
      const title = section.title.trim()
        ? `<h2>${escapeHtml(section.title)}</h2>`
        : "";
      const body =
        section.layout === "entries"
          ? section.items.map(renderEntry).join("")
          : section.layout === "list"
            ? `<ul class="list">${section.items.map(renderListItem).join("")}</ul>`
            : section.text.trim()
              ? `<p class="text">${renderBold(section.text)}</p>`
              : "";
      return `<section>${title}${body}</section>`;
    })
    .join("");

  const name = escapeHtml(header.name || "Your name");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${name}</title><style>${options.previewFont ? `${PREVIEW_FONT_CSS}\n` : ""}${RESUME_CSS}</style></head>
<body><div class="page"><header><h1>${name}</h1><p class="contact">${contact.join('<span class="sep">|</span>')}</p></header>${sections}</div></body></html>`;
}
