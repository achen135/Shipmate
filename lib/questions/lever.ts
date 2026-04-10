import { decodeEntities, htmlToText } from "@/lib/sources/text";

import { type InputKind, type RawQuestion } from "./types";

/**
 * Lever has no questions API, so read the public apply page,
 * jobs.lever.co/{slug}/{id}/apply. Best effort: the form is server-rendered
 * HTML, and each question is an `<li class="application-question …">` with
 * an `application-label` and an input. Standard questions put the label
 * straight in `application-label`; custom ones wrap it in `<div
 * class="text">`.
 */

function inputOf(block: string): { input: InputKind; options: string[] } {
  if (/<textarea\b/i.test(block)) return { input: "textarea", options: [] };
  if (/type="file"/i.test(block) || /visible-resume-upload/.test(block)) {
    return { input: "file", options: [] };
  }
  const choices = [
    ...block.matchAll(
      /<span class="application-answer-alternative">([\s\S]*?)<\/span>/g,
    ),
  ].map((m) => decodeEntities(htmlToText(m[1])));
  if (/type="checkbox"/i.test(block)) {
    return { input: "multiselect", options: choices };
  }
  if (/type="radio"/i.test(block)) return { input: "select", options: choices };
  if (/<select\b/i.test(block)) {
    const options = [...block.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/g)]
      .map((m) => decodeEntities(htmlToText(m[1])))
      .filter((o) => o && !/^select\b|^choose\b|^-+$/i.test(o));
    return { input: "select", options };
  }
  if (/type="hidden"/i.test(block) && !/type="text"/i.test(block)) {
    return { input: "other", options: [] };
  }
  return { input: "text", options: [] };
}

export function parseLeverQuestions(html: string): RawQuestion[] {
  const blocks = html.split(/(?=<li class="application-question)/).slice(1);
  if (blocks.length === 0) {
    throw new Error("Lever apply page has no questions (format changed?)");
  }

  const out: RawQuestion[] = [];
  for (const block of blocks) {
    const label = block.match(
      /class="application-label[^"]*">(?:\s*<div class="text">)?([\s\S]*?)(?:<span class="required"|<\/div>)/,
    );
    const text = label ? htmlToText(label[1]).replace(/\s+/g, " ").trim() : "";
    if (!text) continue;
    const { input, options } = inputOf(block);
    out.push({
      label: text,
      required: /<span class="required"/.test(block.slice(0, 1500)),
      input,
      options,
    });
  }
  return out;
}
