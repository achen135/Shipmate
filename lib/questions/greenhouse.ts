import { decodeEntities, htmlToText } from "@/lib/sources/text";

import { type InputKind, type RawQuestion } from "./types";

/**
 * Greenhouse: GET boards-api.greenhouse.io/v1/boards/{slug}/jobs/{id}
 * ?questions=true (official API). `questions` is the form; `location_questions`
 * and `compliance` (EEO) are the rest of it. Each question has one or more
 * `fields`; the first visible one says what kind of answer it takes.
 */

const FIELD_INPUT: Record<string, InputKind> = {
  input_text: "text",
  textarea: "textarea",
  input_file: "file",
  multi_value_single_select: "select",
  multi_value_multi_select: "multiselect",
};

type Field = { type?: unknown; values?: unknown };
type GreenhouseQuestion = {
  label?: unknown;
  description?: unknown;
  required?: unknown;
  fields?: unknown;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readQuestion(
  q: GreenhouseQuestion,
  group?: "demographic",
): RawQuestion | null {
  const label = text(q.label);
  const fields = (Array.isArray(q.fields) ? q.fields : []) as Field[];
  // Hidden fields (latitude, longitude) aren't questions anyone answers.
  const visible = fields.filter((f) => f.type !== "input_hidden");
  const first = visible[0];
  if (!label || !first) return null;

  const type = typeof first.type === "string" ? first.type : "";
  const values = Array.isArray(first.values)
    ? (first.values as { label?: unknown }[])
    : [];
  const description = text(q.description);
  return {
    label: decodeEntities(label),
    ...(description ? { description: htmlToText(description) } : {}),
    required: q.required === true,
    input: FIELD_INPUT[type] ?? "other",
    options: values
      .map((v) => text(v.label))
      .filter((v): v is string => v !== undefined)
      .map(decodeEntities),
    ...(group ? { group } : {}),
  };
}

export function parseGreenhouseQuestions(json: unknown): RawQuestion[] {
  const job = json as {
    questions?: unknown;
    location_questions?: unknown;
    compliance?: unknown;
    demographic_questions?: { questions?: unknown } | null;
  } | null;
  if (!job || !Array.isArray(job.questions)) {
    throw new Error("Greenhouse response has no questions (format changed?)");
  }

  const out: RawQuestion[] = [];
  const add = (items: unknown, group?: "demographic") => {
    if (!Array.isArray(items)) return;
    for (const item of items as GreenhouseQuestion[]) {
      const question = readQuestion(item, group);
      if (question) out.push(question);
    }
  };

  add(job.questions);
  add(job.location_questions);
  if (Array.isArray(job.compliance)) {
    for (const block of job.compliance as { questions?: unknown }[]) {
      add(block.questions, "demographic");
    }
  }
  // Newer boards list their demographic questions here instead.
  const demographic = job.demographic_questions?.questions;
  if (Array.isArray(demographic)) {
    for (const item of demographic as {
      label?: unknown;
      required?: unknown;
      type?: unknown;
      answer_options?: { label?: unknown }[];
    }[]) {
      const label = text(item.label);
      if (!label) continue;
      out.push({
        label: decodeEntities(label),
        required: item.required === true,
        input:
          item.type === "multi_value_multi_select" ? "multiselect" : "select",
        options: (item.answer_options ?? [])
          .map((o) => text(o.label))
          .filter((v): v is string => v !== undefined),
        group: "demographic",
      });
    }
  }
  return out;
}
