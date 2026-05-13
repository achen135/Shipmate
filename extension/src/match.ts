/**
 * Which live form field is which question (M8 §2.3 step 4).
 *
 * Shipmate already knows the form's questions (the review page's answer
 * sheet: lib/questions/sheet.ts). This finds each field's visible label on
 * the page and matches it to a question's label. No second form-reading
 * system: if a field's label doesn't match a known question, it's flagged
 * for the user, never guessed at.
 */

import { type FillQuestion, normalizeLabel } from "@/lib/extension/protocol";

export type FieldKind =
  | "text"
  | "textarea"
  | "select"
  | "file"
  | "checkbox"
  | "checkboxes"
  | "radio"
  | "combobox";

export type Field = {
  kind: FieldKind;
  /** The element to fill (the first radio of a group). */
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  /** Every input in the group, for `radio` and `checkboxes`. */
  group: HTMLInputElement[];
  /** What to outline: the field, or a radio group's container. */
  box: HTMLElement;
  label: string;
  required: boolean;
};

const SKIP_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "image",
  "reset",
  "search",
]);

/** A value for inside a "…" attribute selector. */
export const quoteAttr = (value: string) => value.replace(/["\\]/g, "\\$&");

/** Our own overlay lives in this element; its contents are never fields. */
export const OVERLAY_ATTR = "data-shipmate-overlay";

function hiddenByStyle(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.hasAttribute("hidden")) return true;
    if (node.getAttribute("aria-hidden") === "true") return true;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style && (style.display === "none" || style.visibility === "hidden")) {
      return true;
    }
  }
  return false;
}

/** Text of an element without the fields (and their options) inside it. */
function textWithoutFields(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy
    .querySelectorAll("input, select, textarea, button, option, script, style")
    .forEach((n) => n.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

function byIds(doc: Document, ids: string | null): string {
  return (ids ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => doc.getElementById(id))
    .filter((n): n is HTMLElement => n !== null)
    .map(textWithoutFields)
    .join(" ")
    .trim();
}

const LABELISH =
  "label, legend, .application-label, [class*='label' i], [class*='question-title' i], [class*='question' i] > p, h3, h4";

/** The label a person sees for this field. */
export function labelFor(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const labelled = byIds(doc, el.getAttribute("aria-labelledby"));
  if (labelled) return labelled;

  const radio =
    el instanceof HTMLInputElement &&
    (el.type === "radio" || el.type === "checkbox");
  if (radio) {
    // A group's question: its fieldset's legend, or the group's own label.
    const group = el.closest("fieldset, [role='radiogroup'], [role='group']");
    if (group) {
      const legend = group.querySelector("legend");
      const text =
        (legend && textWithoutFields(legend)) ||
        byIds(doc, group.getAttribute("aria-labelledby")) ||
        group.getAttribute("aria-label") ||
        "";
      if (text) return text;
    }
  }

  if (el.id && !radio) {
    const label = doc.querySelector(`label[for="${quoteAttr(el.id)}"]`);
    if (label) {
      const text = textWithoutFields(label);
      if (text) return text;
    }
  }
  const wrapping = el.closest("label");
  if (wrapping && !radio) {
    // Lever wraps the whole question in its label; its title is a child.
    const title = [
      ...wrapping.querySelectorAll<HTMLElement>("[class*='label' i]"),
    ].find((c) => !c.contains(el));
    const text = textWithoutFields(title ?? wrapping);
    if (text) return text;
  }
  const aria = el.getAttribute("aria-label");
  if (aria && !radio) return aria.trim();

  // The nearest label-like element before the field, a few levels up
  // (Lever's .application-label, Ashby's question titles).
  let node: HTMLElement | null = el.parentElement;
  for (let depth = 0; node && depth < 5; depth += 1) {
    const candidates = [...node.querySelectorAll<HTMLElement>(LABELISH)].filter(
      (c) =>
        !c.contains(el) &&
        !c.closest(`[${OVERLAY_ATTR}]`) &&
        c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const nearest = candidates.at(-1);
    if (nearest) {
      const text = textWithoutFields(nearest);
      if (text) return text;
    }
    node = node.parentElement;
  }
  return el.getAttribute("placeholder")?.trim() ?? "";
}

/** The fields of the application form in `root`, in page order. */
export function collectFields(root: ParentNode): Field[] {
  const fields: Field[] = [];
  const radios = new Map<string, Field>();
  const elements = root.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select");

  for (const el of elements) {
    if (el.closest(`[${OVERLAY_ATTR}]`)) continue;
    if (el.disabled) continue;
    const type = el instanceof HTMLInputElement ? el.type.toLowerCase() : "";
    if (SKIP_TYPES.has(type)) continue;
    // File inputs are often hidden behind a styled button: keep them.
    if (type !== "file" && hiddenByStyle(el)) continue;

    // A group of radios, or of checkboxes sharing a name ("check all that
    // apply"), is one question: one field.
    const grouped =
      el instanceof HTMLInputElement &&
      (type === "radio" ||
        (type === "checkbox" &&
          el.name !== "" &&
          root.querySelectorAll(
            `input[type="checkbox"][name="${quoteAttr(el.name)}"]`,
          ).length > 1));
    if (el instanceof HTMLInputElement && grouped) {
      const key = `${type}:${el.name || el.id}`;
      const existing = radios.get(key);
      if (existing) {
        existing.group.push(el);
        continue;
      }
      const container =
        (el.closest(
          "fieldset, [role='radiogroup'], [role='group']",
        ) as HTMLElement | null) ?? (el.parentElement as HTMLElement);
      const field: Field = {
        kind: type === "radio" ? "radio" : "checkboxes",
        el,
        group: [el],
        box: container,
        label: labelFor(el),
        required: el.required,
      };
      radios.set(key, field);
      fields.push(field);
      continue;
    }

    const kind: FieldKind =
      el instanceof HTMLSelectElement
        ? "select"
        : el instanceof HTMLTextAreaElement
          ? "textarea"
          : type === "file"
            ? "file"
            : type === "checkbox"
              ? "checkbox"
              : el.getAttribute("role") === "combobox" ||
                  el.getAttribute("aria-autocomplete") === "list"
                ? "combobox"
                : "text";
    fields.push({
      kind,
      el,
      group: [],
      box: (type === "file" && hiddenByStyle(el)
        ? (el.parentElement ?? el)
        : el) as HTMLElement,
      label: labelFor(el),
      required: el.required || el.getAttribute("aria-required") === "true",
    });
  }
  return fields;
}

// ---------------------------------------------------------------- matching

const words = (text: string) => new Set(text.split(" ").filter(Boolean));

/** How alike two labels are, 0 to 1, after normalising both. */
export function labelScore(a: string, b: string): number {
  const x = normalizeLabel(a);
  const y = normalizeLabel(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const wx = words(x);
  const wy = words(y);
  let shared = 0;
  for (const w of wx) if (wy.has(w)) shared += 1;
  const dice = (2 * shared) / (wx.size + wy.size);
  // One label inside the other ("Phone" / "Phone number"), when the shorter
  // says enough to mean something.
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const inside =
    (long.startsWith(`${short} `) || long.endsWith(` ${short}`)) &&
    (short.includes(" ") || short.length >= 5)
      ? 0.8
      : 0;
  return Math.max(dice, inside);
}

export const MATCH_THRESHOLD = 0.75;

/** Can this question's answer go in this kind of field? */
export function compatible(question: FillQuestion, field: Field): boolean {
  if (question.input === "file" || field.kind === "file") {
    return question.input === "file" && field.kind === "file";
  }
  return true;
}

export type Match = { field: Field; question: FillQuestion | null };

/**
 * Each field's question, or null. Best pairs first; a field gets at most
 * one question. A question may serve more than one field only if they're
 * the same kind (the rare form that asks twice).
 */
export function matchFields(
  fields: Field[],
  questions: FillQuestion[],
): Match[] {
  const pairs: { f: number; q: number; score: number }[] = [];
  fields.forEach((field, f) => {
    questions.forEach((question, q) => {
      if (!compatible(question, field)) return;
      const score = labelScore(field.label, question.label);
      if (score >= MATCH_THRESHOLD) pairs.push({ f, q, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.q - b.q);

  const chosen = new Map<number, number>();
  const usedBy = new Map<number, FieldKind>();
  for (const { f, q } of pairs) {
    if (chosen.has(f)) continue;
    const kind = usedBy.get(q);
    if (kind && kind !== fields[f].kind) continue;
    chosen.set(f, q);
    usedBy.set(q, fields[f].kind);
  }
  return fields.map((field, f) => ({
    field,
    question: chosen.has(f) ? questions[chosen.get(f)!] : null,
  }));
}
