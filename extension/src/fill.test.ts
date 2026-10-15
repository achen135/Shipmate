import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FillQuestion } from "@/lib/extension/protocol";

import { fillForm, pickOption, summarize, toggle } from "./fill";
import { collectFields, matchFields } from "./match";
import { Overlay } from "./overlay";

/*
 * A fake application form in jsdom: standard fields fill, written / other /
 * anti-bot ones are flagged and left alone, the resume input gets a real
 * File, a field the user already filled is kept, and nothing anywhere
 * submits the form or clicks a button.
 */

const q = (
  label: string,
  kind: FillQuestion["kind"],
  extra: Partial<FillQuestion> = {},
): FillQuestion => ({
  label,
  kind,
  field: null,
  input: "text",
  options: [],
  required: false,
  value: null,
  note: null,
  ...extra,
});

const QUESTIONS: FillQuestion[] = [
  q("First Name", "standard", { field: "first_name", value: "Jordan" }),
  q("Last Name", "standard", { field: "last_name", value: "Lee" }),
  q("Email", "standard", { field: "email", value: "jordan@example.edu" }),
  q("Phone", "standard", {
    field: "phone",
    value: null,
    note: "Add your phone number in Profile.",
  }),
  q("Preferred Name", "standard", { field: "preferred_name", value: "Jordan" }),
  q("Are you legally authorized to work in the United States?", "standard", {
    field: "work_authorization",
    input: "select",
    options: ["Yes", "No"],
    value: "Yes",
  }),
  q("Will you require visa sponsorship?", "standard", {
    field: "sponsorship",
    input: "boolean",
    value: "No",
  }),
  q("Gender", "standard", {
    field: "demographic",
    input: "select",
    value: "Decline to self-identify",
  }),
  q("Resume/CV", "standard", { field: "resume", input: "file" }),
  q("Cover Letter", "other", { input: "file" }),
  q("Why do you want to work here?", "written", { input: "textarea" }),
  q("Are you over 18?", "other", { input: "boolean" }),
  q("Prove you're not a robot: what is 4 + 3?", "antibot"),
];

const PAGE = `
<form id="app" action="/submit" method="post">
  <div><label for="fn">First Name <span>*</span></label><input id="fn" type="text"></div>
  <div><label for="ln">Last Name *</label><input id="ln" type="text"></div>
  <div><label for="em">Email (required)</label><input id="em" type="email"></div>
  <div><label for="ph">Phone</label><input id="ph" type="tel"></div>
  <div><label for="pn">Preferred Name</label><input id="pn" type="text" value="JL"></div>
  <div><label for="wa">Are you legally authorized to work in the United States? *</label>
    <select id="wa"><option value="">Select...</option><option value="1">Yes</option><option value="0">No</option></select></div>
  <fieldset><legend>Will you require visa sponsorship?</legend>
    <label><input type="radio" name="sp" value="y"> Yes</label>
    <label><input type="radio" name="sp" value="n"> No</label></fieldset>
  <div><label for="g">Gender</label>
    <select id="g"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select></div>
  <div><label for="cv">Resume/CV *</label><input id="cv" type="file" style="display:none"></div>
  <div><label for="cl">Cover Letter</label><input id="cl" type="file"></div>
  <div><label for="why">Why do you want to work here?</label><textarea id="why"></textarea></div>
  <div><label for="age">Are you over 18?</label>
    <select id="age"><option value="">Select...</option><option>Yes</option><option>No</option></select></div>
  <div><label for="bot">Prove you're not a robot: what is 4 + 3?</label><input id="bot" type="text"></div>
  <div><label for="fav">Favourite colour</label><input id="fav" type="text"></div>
  <button type="submit" id="submit">Submit application</button>
</form>`;

/** jsdom has no DataTransfer, and file inputs only take a real FileList. */
function fakeFiles() {
  class FakeDataTransfer {
    private list: File[] = [];
    items = { add: (file: File) => this.list.push(file) };
    get files() {
      return Object.assign([...this.list], {
        item: (i: number) => this.list[i],
      });
    }
  }
  vi.stubGlobal("DataTransfer", FakeDataTransfer);
  const store = new WeakMap<HTMLInputElement, unknown>();
  Object.defineProperty(HTMLInputElement.prototype, "files", {
    configurable: true,
    get(this: HTMLInputElement) {
      return store.get(this) ?? [];
    },
    set(this: HTMLInputElement, value: unknown) {
      store.set(this, value);
    },
  });
}

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

let submits = 0;
let buttonClicks = 0;
const touched = new Set<string>();

beforeEach(() => {
  fakeFiles();
  document.body.innerHTML = PAGE;
  submits = 0;
  buttonClicks = 0;
  touched.clear();
  $("app").addEventListener("submit", (e) => {
    submits += 1;
    e.preventDefault();
  });
  $("submit").addEventListener("click", () => {
    buttonClicks += 1;
  });
  for (const el of document.querySelectorAll("input, select, textarea")) {
    for (const type of ["input", "change", "click", "focus"]) {
      el.addEventListener(type, () =>
        touched.add(el.id || el.getAttribute("name")!),
      );
    }
  }
  vi.spyOn(HTMLFormElement.prototype, "submit");
  vi.spyOn(HTMLFormElement.prototype, "requestSubmit");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const pdf = () =>
  new File(["%PDF-1.4"], "Jordan_Lee_Resume_Tidewater.pdf", {
    type: "application/pdf",
  });

function run(file: File | null = pdf()) {
  return fillForm(matchFields(collectFields(document), QUESTIONS), file);
}

const outcome = (results: ReturnType<typeof run>, id: string) =>
  results.find((r) => r.field.el.id === id || r.field.box.id === id)?.outcome;

describe("filling a form", () => {
  it("fills standard fields from the answer sheet", () => {
    run();
    expect($<HTMLInputElement>("fn").value).toBe("Jordan");
    expect($<HTMLInputElement>("ln").value).toBe("Lee");
    expect($<HTMLInputElement>("em").value).toBe("jordan@example.edu");
    expect($<HTMLSelectElement>("wa").selectedOptions[0].text).toBe("Yes");
    const radios =
      document.querySelectorAll<HTMLInputElement>('input[name="sp"]');
    expect(radios[1].checked).toBe(true);
    expect(radios[0].checked).toBe(false);
    expect($<HTMLSelectElement>("g").value).toBe("Decline to self-identify");
  });

  it("attaches the PDF to the resume field as a real File", () => {
    const results = run();
    const files = $<HTMLInputElement>("cv").files as unknown as File[];
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0].name).toBe("Jordan_Lee_Resume_Tidewater.pdf");
    expect(files[0].type).toBe("application/pdf");
    expect(outcome(results, "cv")).toBe("attached");
    // The cover letter is the user's, even though it's a file too.
    expect(($<HTMLInputElement>("cl").files as unknown as File[]).length).toBe(
      0,
    );
    expect(outcome(results, "cl")).toBe("yours");
  });

  it("flags written, other and unknown fields, and leaves them alone", () => {
    const results = run();
    expect(outcome(results, "why")).toBe("yours");
    expect(outcome(results, "age")).toBe("yours");
    expect(outcome(results, "fav")).toBe("unknown");
    expect(outcome(results, "ph")).toBe("missing");
    for (const id of ["why", "age", "fav", "ph", "cl"]) {
      expect(touched.has(id), id).toBe(false);
    }
    expect($<HTMLTextAreaElement>("why").value).toBe("");
    expect($<HTMLSelectElement>("age").value).toBe("");
  });

  it("never touches an anti-bot question", () => {
    const results = run();
    expect(outcome(results, "bot")).toBe("antibot");
    expect($<HTMLInputElement>("bot").value).toBe("");
    expect(touched.has("bot")).toBe(false);
  });

  it("keeps what the user already typed", () => {
    const results = run();
    expect($<HTMLInputElement>("pn").value).toBe("JL");
    expect(outcome(results, "pn")).toBe("kept");
  });

  it("never submits the form or clicks a button", () => {
    const results = run();
    const overlay = new Overlay(document);
    overlay.mark(results);
    overlay.panel({
      title: "Shipmate filled Tidewater",
      summary: summarize(results),
      onSubmitted: async () => "",
    });
    expect(submits).toBe(0);
    expect(buttonClicks).toBe(0);
    expect(HTMLFormElement.prototype.submit).not.toHaveBeenCalled();
    expect(HTMLFormElement.prototype.requestSubmit).not.toHaveBeenCalled();
    overlay.remove();
  });

  it("says no resume when there's nothing to attach", () => {
    const results = run(null);
    expect(outcome(results, "cv")).toBe("missing");
  });

  it("only ever clicks a radio or a checkbox", () => {
    expect(() => toggle($<HTMLInputElement>("fn"))).toThrow();
    expect(() =>
      toggle($<HTMLButtonElement>("submit") as unknown as HTMLInputElement),
    ).toThrow();
    expect(buttonClicks).toBe(0);
  });

  it("summarises what it did", () => {
    expect(summarize(run())).toEqual({
      filled: 6,
      attached: "Jordan_Lee_Resume_Tidewater.pdf",
      yours: 4,
      antibot: 1,
      unknown: 1,
    });
  });
});

describe("picking an option", () => {
  it("exact text first, then the start of an option", () => {
    expect(pickOption(["Yes", "No"], "No")).toBe(1);
    expect(pickOption(["Yes, I am authorized", "No"], "Yes")).toBe(0);
    expect(pickOption(["Male", "Female"], "Decline to answer")).toBe(-1);
  });
});
