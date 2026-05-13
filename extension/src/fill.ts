/**
 * Filling the form (M8 §2.3 steps 4-7). Rules, the same as Shipmate's:
 *
 * - A standard question gets the answer sheet's prefilled value. Nothing
 *   else is typed anywhere.
 * - The resume field gets the PDF (the tailored one if there is one).
 * - Written and "other" questions, anything with no answer in the profile,
 *   any field Shipmate can't place, and any choice it can't make exactly
 *   are flagged for the user, not guessed at.
 * - An anti-bot question is never touched (hard rule 4), only flagged
 *   "answer this yourself".
 * - A field the user already filled is left as they left it.
 * - Nothing here submits (hard rule 1): no submit(), no requestSubmit(), no
 *   submit event, and no click on anything but a radio or checkbox input,
 *   through toggle() below. fill.test.ts and guard.test.ts check this.
 */

import { normalizeLabel, type FillQuestion } from "@/lib/extension/protocol";

import { type Field, type Match, quoteAttr } from "./match";

export type Outcome =
  | "filled"
  | "attached"
  | "kept"
  | "yours"
  | "missing"
  | "choose"
  | "unknown"
  | "antibot";

export type FieldResult = {
  field: Field;
  question: FillQuestion | null;
  outcome: Outcome;
  /** Shown next to the field. */
  note: string;
};

/** Set a value the way typing would, so React-style forms see it. */
function setValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * The only click in the extension: on a radio or checkbox input, which
 * picks an option and can't submit anything. Anything else throws.
 */
export function toggle(input: HTMLInputElement) {
  if (input.type !== "radio" && input.type !== "checkbox") {
    throw new Error("Shipmate only ever clicks a radio or checkbox.");
  }
  input.click();
}

/** The option whose text is the answer (exactly, after normalising), else a prefix match. */
export function pickOption(options: string[], value: string): number {
  const want = normalizeLabel(value);
  if (!want) return -1;
  const norm = options.map(normalizeLabel);
  const exact = norm.indexOf(want);
  if (exact !== -1) return exact;
  const prefixed = norm.findIndex(
    (o) => o && (o.startsWith(`${want} `) || want.startsWith(`${o} `)),
  );
  return prefixed;
}

function radioLabel(input: HTMLInputElement): string {
  const doc = input.ownerDocument;
  const byFor = input.id
    ? doc.querySelector(`label[for="${quoteAttr(input.id)}"]`)
    : null;
  const label = byFor ?? input.closest("label");
  return (label?.textContent ?? input.value ?? "").trim();
}

function isEmpty(field: Field): boolean {
  const { el } = field;
  if (field.kind === "radio" || field.kind === "checkboxes") {
    return !field.group.some((r) => r.checked);
  }
  if (field.kind === "checkbox") return true;
  if (field.kind === "file") {
    return !(el instanceof HTMLInputElement && el.files && el.files.length);
  }
  if (el instanceof HTMLSelectElement) {
    return el.selectedIndex <= 0 || !el.value;
  }
  return !el.value.trim();
}

function attach(input: HTMLInputElement, file: File) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const ANTIBOT_NOTE = "Answer this yourself: Shipmate never answers these.";

function fillOne({ field, question }: Match, pdf: File | null): FieldResult {
  const result = (outcome: Outcome, note: string): FieldResult => ({
    field,
    question,
    outcome,
    note,
  });
  if (!question) {
    return result("unknown", "Shipmate didn't recognise this field.");
  }
  if (question.kind === "antibot") return result("antibot", ANTIBOT_NOTE);
  if (question.kind === "written") {
    return result("yours", "A written question: yours to answer.");
  }
  if (question.kind === "other") {
    return result("yours", "Yours to answer.");
  }

  if (!isEmpty(field)) return result("kept", "You'd already filled this.");

  if (field.kind === "file") {
    if (question.field !== "resume") {
      return result("yours", "Attach this yourself.");
    }
    if (!pdf) {
      return result(
        "missing",
        "No resume in Shipmate to attach. Upload one in Profile.",
      );
    }
    attach(field.el as HTMLInputElement, pdf);
    return result("attached", `Attached ${pdf.name}.`);
  }

  const value = question.value;
  if (value === null || value === "") {
    return result("missing", question.note ?? "Not in your profile.");
  }

  switch (field.kind) {
    case "text":
    case "textarea":
      setValue(field.el, value);
      return result("filled", "Filled from your profile.");
    case "select": {
      const select = field.el as HTMLSelectElement;
      const options = [...select.options];
      const index = pickOption(
        options.map((o) => o.text),
        value,
      );
      if (index === -1) return result("choose", `Choose “${value}”.`);
      setValue(select, options[index].value);
      return result("filled", "Filled from your profile.");
    }
    case "radio": {
      const index = pickOption(field.group.map(radioLabel), value);
      if (index === -1) return result("choose", `Choose “${value}”.`);
      toggle(field.group[index]);
      return result("filled", "Filled from your profile.");
    }
    case "checkbox": {
      const input = field.el as HTMLInputElement;
      const yes = /^yes\b/i.test(value.trim());
      const no = /^no\b/i.test(value.trim());
      if (!yes && !no) return result("choose", `Choose “${value}”.`);
      if (input.checked !== yes) toggle(input);
      return result("filled", "Filled from your profile.");
    }
    case "checkboxes":
      // "Check all that apply": more than one answer; never guessed.
      return result("choose", `Choose “${value}”.`);
    case "combobox":
      // A searchable dropdown: picking from it takes clicks on the page's
      // own widgets, which Shipmate doesn't do. Say what to pick.
      return result("choose", `Choose “${value}”.`);
  }
  return result("unknown", "Shipmate didn't recognise this field.");
}

export function fillForm(matches: Match[], pdf: File | null): FieldResult[] {
  return matches.map((match) => {
    try {
      return fillOne(match, pdf);
    } catch {
      return {
        field: match.field,
        question: match.question,
        outcome: "choose" as const,
        note: "Shipmate couldn't fill this one: please check it.",
      };
    }
  });
}

export type Summary = {
  filled: number;
  attached: string | null;
  yours: number;
  antibot: number;
  unknown: number;
};

export function summarize(results: FieldResult[]): Summary {
  const count = (...outcomes: Outcome[]) =>
    results.filter((r) => outcomes.includes(r.outcome)).length;
  const attached = results.find((r) => r.outcome === "attached");
  return {
    filled: count("filled"),
    attached: attached ? attached.note.replace(/^Attached |\.$/g, "") : null,
    yours: count("yours", "missing", "choose"),
    antibot: count("antibot"),
    unknown: count("unknown"),
  };
}
