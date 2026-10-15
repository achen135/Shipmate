import { readFileSync } from "node:fs";
import { join } from "node:path";

import { toFillQuestions } from "@/lib/extension/sheet";
import { parseAshbyQuestions } from "@/lib/questions/ashby";
import { parseGreenhouseQuestions } from "@/lib/questions/greenhouse";
import { parseLeverQuestions } from "@/lib/questions/lever";
import type { AnswerProfile } from "@/lib/questions/prefill";
import { buildSheet } from "@/lib/questions/sheet";
import type { RawQuestion } from "@/lib/questions/types";

/**
 * Real question lists (lib/questions/__fixtures__, shared with M5's
 * tests) and pages to match them against: Lever's real application page,
 * and Greenhouse- and Ashby-style markup built from their real questions,
 * with the label noise those pages have (required marks, nested spans).
 */

const FIXTURES = join(
  __dirname,
  "..",
  "..",
  "..",
  "lib",
  "questions",
  "__fixtures__",
);
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

export const PROFILE: AnswerProfile = {
  name: "Jordan Lee",
  email: "jordan@example.edu",
  phone: "555-0100",
  school: "State University",
  degree: "bachelors",
  major: "Computer Science",
  gradMonth: 5,
  gradYear: 2029,
  workAuthorized: true,
  needsSponsorship: false,
  answers: {
    linkedin: "https://linkedin.com/in/jlee",
    github: "https://github.com/jlee",
  },
};

export const greenhouseQuestions = () =>
  parseGreenhouseQuestions(
    JSON.parse(read("greenhouse-stripe-questions.json")),
  );
export const ashbyQuestions = () =>
  parseAshbyQuestions(JSON.parse(read("ashby-ramp-frontend.json")));
export const leverHtml = () => read("lever-palantir-apply.html");
export const leverQuestions = () => parseLeverQuestions(leverHtml());

export const fillQuestions = (questions: RawQuestion[]) =>
  toFillQuestions(buildSheet(questions, PROFILE));

const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function control(q: RawQuestion, id: string): string {
  switch (q.input) {
    case "textarea":
      return `<textarea id="${id}"></textarea>`;
    case "file":
      return `<input type="file" id="${id}" style="display:none">`;
    case "select":
    case "boolean": {
      const options = q.options.length ? q.options : ["Yes", "No"];
      return `<select id="${id}"><option value="">Select...</option>${options
        .map((o, i) => `<option value="${i}">${esc(o)}</option>`)
        .join("")}</select>`;
    }
    case "multiselect":
      return q.options
        .map(
          (o, i) =>
            `<label><input type="checkbox" name="${id}" value="${i}">${esc(o)}</label>`,
        )
        .join("");
    default:
      return `<input type="text" id="${id}">`;
  }
}

/** Greenhouse's classic board markup: label[for] + a required asterisk. */
export function greenhouseMarkup(questions: RawQuestion[]): string {
  return `<form id="application_form">${questions
    .map((q, i) =>
      q.input === "multiselect"
        ? `<fieldset><legend>${esc(q.label)}</legend>${control(q, `q${i}`)}</fieldset>`
        : `<div class="field"><label for="q${i}">${esc(q.label)}${
            q.required ? ' <span class="asterisk">*</span>' : ""
          }</label>${control(q, `q${i}`)}</div>`,
    )
    .join("")}<input type="submit" value="Submit Application"></form>`;
}

/** Ashby's markup: a titled entry per question. */
export function ashbyMarkup(questions: RawQuestion[]): string {
  return `<div class="ashby-application-form-container">${questions
    .map(
      (q, i) =>
        `<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="a${i}">${esc(
          q.label,
        )}${q.required ? "<span>*</span>" : ""}</label>${control(q, `a${i}`)}</div>`,
    )
    .join("")}<button type="submit">Submit Application</button></div>`;
}
