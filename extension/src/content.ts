/**
 * Runs on Greenhouse, Lever and Ashby pages (and their embeds, in every
 * frame), and on Workday only to say it isn't supported.
 *
 * 1. Top frame: a `#shipmate=` marker (Shipmate's Apply button) is taken
 *    out of the address bar at once and handed to the background, which
 *    keeps it for this tab (Lever and Ashby show the form one page later,
 *    so a page without a marker keeps the tab's earlier one).
 * 2. When an application form is on the page, it tells the background,
 *    which fills it straight away if the tab came with a marker, and
 *    otherwise waits for the toolbar button.
 * 3. Filling: match → fill → outline and explain (fill.ts, overlay.ts).
 *    Never submits.
 */

import { normalizeLabel } from "@/lib/extension/protocol";

import { fillForm, summarize } from "./fill";
import { collectFields, matchFields } from "./match";
import { MARKER_PARAM, type ToBackground, type ToContent } from "./messages";
import { Overlay } from "./overlay";

const send = (message: ToBackground) =>
  chrome.runtime.sendMessage(message).catch(() => undefined);

/** The top frame's #shipmate= marker, taken out of the address bar. */
function takeMarker(): string | null {
  if (window !== window.top) return null;
  const hash = location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const marker = params.get(MARKER_PARAM);
  if (!marker) return null;
  params.delete(MARKER_PARAM);
  const rest = params.toString();
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}${rest ? `#${rest}` : ""}`,
  );
  return marker;
}

/** Does this frame hold an application form? */
function hasForm(): boolean {
  const fields = collectFields(document);
  if (fields.length < 3) return false;
  return fields.some(
    (f) =>
      f.kind === "file" ||
      /\b(first name|full name|email|resume|cv)\b/.test(
        normalizeLabel(f.label),
      ),
  );
}

function watchForForm() {
  let told = false;
  const check = () => {
    if (told || !hasForm()) return;
    told = true;
    observer.disconnect();
    void send({ type: "form-ready", url: location.href });
  };
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  check();
  // A form that never shows up isn't worth watching for ever.
  setTimeout(() => observer.disconnect(), 30_000);
}

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let overlay: Overlay | null = null;

function fill(message: Extract<ToContent, { type: "fill" }>) {
  overlay?.remove();
  overlay = new Overlay(document);
  const { data, pdf } = message;
  const file = pdf
    ? new File([decode(pdf.base64)], pdf.name, { type: "application/pdf" })
    : null;
  const results = fillForm(
    matchFields(collectFields(document), data.questions),
    file,
  );
  overlay.mark(results);
  overlay.panel({
    title: `Shipmate filled ${data.posting.company || "this application"}`,
    summary: summarize(results),
    onSubmitted: async () => {
      const answer = (await chrome.runtime.sendMessage({
        type: "submitted",
        userPostingId: data.userPostingId,
        path: pdf?.path ?? null,
      } satisfies ToBackground)) as { ok: boolean; text: string } | undefined;
      return answer?.text ?? "Couldn't reach Shipmate. Mark it applied there.";
    },
  });
  return summarize(results);
}

chrome.runtime.onMessage.addListener((message: ToContent, _sender, reply) => {
  if (message.type === "fill") {
    reply(fill(message));
  } else if (message.type === "notice") {
    overlay?.remove();
    overlay = new Overlay(document);
    overlay.notice(message.text);
    reply(true);
  }
  return false;
});

if (/(^|\.)myworkdayjobs\.com$/.test(location.hostname)) {
  // Workday: nothing to do here; the toolbar button explains.
} else {
  // A new page in this tab: forget the last one's frames, and keep its
  // marker if it came with one. Sent before the form check, and the
  // background handles a tab's messages in order.
  if (window === window.top) void send({ type: "page", marker: takeMarker() });
  watchForForm();
}
