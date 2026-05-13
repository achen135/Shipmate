/**
 * What the user sees on the form after a fill: an outline and a short note
 * on every field Shipmate touched or flagged, and a panel saying what was
 * done and that submitting is theirs. Drawn in its own shadow root on top
 * of the page, so the form's own markup is never changed (beyond the
 * outlines, which are put back on Close).
 *
 * The panel's buttons ignore anything but a real click (`isTrusted`), so
 * the page's own scripts can't press "I submitted it".
 */

import type { FieldResult, Outcome, Summary } from "./fill";
import { OVERLAY_ATTR } from "./match";

const COLORS: Record<Outcome, string | null> = {
  filled: "#2f7d4f",
  attached: "#2f7d4f",
  kept: null,
  yours: "#b7791f",
  missing: "#b7791f",
  choose: "#b7791f",
  unknown: "#b7791f",
  antibot: "#c0392b",
};

const STYLE = `
:host { all: initial; }
.badge {
  position: absolute; z-index: 2147483646; max-width: 280px;
  font: 12px/1.3 system-ui, sans-serif; color: #fff;
  padding: 2px 6px; border-radius: 4px; pointer-events: none;
  transform: translateY(-100%);
}
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: min(340px, calc(100vw - 32px)); box-sizing: border-box;
  background: #fbf7ef; color: #1b2a41; border: 1px solid #c9b88f;
  border-radius: 12px; padding: 14px 16px; box-shadow: 0 6px 24px rgba(0,0,0,.18);
  font: 14px/1.45 system-ui, sans-serif;
}
.panel h2 { font-size: 15px; margin: 0 0 6px; }
.panel ul { margin: 6px 0 10px; padding-left: 18px; }
.panel p { margin: 6px 0; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
button {
  font: inherit; border-radius: 8px; padding: 6px 12px; cursor: pointer;
  border: 1px solid #1b2a41; background: #1b2a41; color: #fff;
}
button.quiet { background: transparent; color: #1b2a41; }
.status { font-weight: 600; }
`;

export type PanelInput = {
  title: string;
  summary: Summary;
  onSubmitted: () => Promise<string>;
};

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private layer: HTMLElement;
  private outlines: { el: HTMLElement; outline: string; offset: string }[] = [];
  private badges: { el: HTMLElement; badge: HTMLElement }[] = [];
  private onMove = () => this.place();

  constructor(private doc: Document) {
    this.host = doc.createElement("div");
    this.host.setAttribute(OVERLAY_ATTR, "");
    // Open, so tests can read it; the buttons check isTrusted regardless.
    this.root = this.host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = STYLE;
    this.layer = doc.createElement("div");
    this.root.append(style, this.layer);
    doc.documentElement.append(this.host);
    doc.defaultView?.addEventListener("scroll", this.onMove, true);
    doc.defaultView?.addEventListener("resize", this.onMove);
  }

  mark(results: FieldResult[]) {
    for (const r of results) {
      const color = COLORS[r.outcome];
      if (!color) continue;
      const el = r.field.box;
      this.outlines.push({
        el,
        outline: el.style.outline,
        offset: el.style.outlineOffset,
      });
      el.style.outline = `2px solid ${color}`;
      el.style.outlineOffset = "2px";
      const badge = this.doc.createElement("div");
      badge.className = "badge";
      badge.style.background = color;
      badge.textContent = r.note;
      badge.dataset.outcome = r.outcome;
      this.layer.append(badge);
      this.badges.push({ el, badge });
    }
    this.place();
  }

  private place() {
    const view = this.doc.defaultView;
    const x = view?.scrollX ?? 0;
    const y = view?.scrollY ?? 0;
    for (const { el, badge } of this.badges) {
      const rect = el.getBoundingClientRect();
      badge.style.left = `${rect.left + x}px`;
      badge.style.top = `${rect.top + y - 4}px`;
    }
  }

  panel(input: PanelInput) {
    const { summary } = input;
    const panel = this.doc.createElement("section");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Shipmate Autofill");
    const lines = [
      `Filled ${summary.filled} ${summary.filled === 1 ? "field" : "fields"} from your profile.`,
      summary.attached
        ? `Attached ${summary.attached}.`
        : "No resume attached.",
      summary.yours
        ? `${summary.yours} outlined in amber ${summary.yours === 1 ? "is" : "are"} yours to answer or check.`
        : "",
      summary.antibot
        ? `${summary.antibot} anti-bot ${summary.antibot === 1 ? "question" : "questions"} (red): answer ${summary.antibot === 1 ? "it" : "them"} yourself. Shipmate never does.`
        : "",
      summary.unknown
        ? `${summary.unknown} ${summary.unknown === 1 ? "field" : "fields"} Shipmate didn't recognise.`
        : "",
    ].filter(Boolean);

    const heading = this.doc.createElement("h2");
    heading.textContent = input.title;
    const list = this.doc.createElement("ul");
    for (const line of lines) {
      const li = this.doc.createElement("li");
      li.textContent = line;
      list.append(li);
    }
    const reminder = this.doc.createElement("p");
    reminder.textContent =
      "Check everything, then click the form's own Submit button yourself. Shipmate never submits.";
    const status = this.doc.createElement("p");
    status.className = "status";
    status.setAttribute("role", "status");

    const submitted = this.doc.createElement("button");
    submitted.type = "button";
    submitted.textContent = "I submitted it";
    submitted.addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
      submitted.disabled = true;
      status.textContent = await input.onSubmitted();
    });
    const close = this.doc.createElement("button");
    close.type = "button";
    close.className = "quiet";
    close.textContent = "Close";
    close.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      this.remove();
    });

    const row = this.doc.createElement("div");
    row.className = "row";
    row.append(submitted, close);
    panel.append(heading, list, reminder, row, status);
    this.layer.append(panel);
  }

  /** A one-line message in the panel's place (nothing to fill, an error). */
  notice(text: string) {
    const panel = this.doc.createElement("section");
    panel.className = "panel";
    panel.setAttribute("role", "status");
    panel.textContent = text;
    const close = this.doc.createElement("button");
    close.type = "button";
    close.className = "quiet";
    close.textContent = "Close";
    close.style.marginLeft = "8px";
    close.addEventListener("click", (event) => {
      if (event.isTrusted) this.remove();
    });
    panel.append(close);
    this.layer.append(panel);
  }

  remove() {
    for (const { el, outline, offset } of this.outlines) {
      el.style.outline = outline;
      el.style.outlineOffset = offset;
    }
    this.doc.defaultView?.removeEventListener("scroll", this.onMove, true);
    this.doc.defaultView?.removeEventListener("resize", this.onMove);
    this.host.remove();
  }
}
