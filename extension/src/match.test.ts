import { beforeEach, describe, expect, it } from "vitest";

import { normalizeLabel } from "@/lib/extension/protocol";

import {
  ashbyMarkup,
  ashbyQuestions,
  fillQuestions,
  greenhouseMarkup,
  greenhouseQuestions,
  leverHtml,
  leverQuestions,
} from "./__fixtures__/forms";
import {
  MATCH_THRESHOLD,
  collectFields,
  labelScore,
  matchFields,
} from "./match";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("label matching", () => {
  it("ignores required marks, case and punctuation", () => {
    expect(normalizeLabel("First Name *")).toBe("first name");
    expect(normalizeLabel("Resume/CV ✱")).toBe("resume cv");
    expect(normalizeLabel("Phone (required)")).toBe("phone");
    expect(labelScore("Email *", "email")).toBe(1);
  });

  it("matches a longer or shorter wording of the same label", () => {
    expect(labelScore("Phone number", "Phone")).toBeGreaterThanOrEqual(
      MATCH_THRESHOLD,
    );
    expect(labelScore("Email address", "Email")).toBeGreaterThanOrEqual(
      MATCH_THRESHOLD,
    );
  });

  it("doesn't match different questions that share a word", () => {
    for (const [a, b] of [
      ["Name", "Last Name"],
      ["Name", "Company name"],
      ["Email", "Phone"],
      [
        "Are you a Singapore citizen?",
        "Are you a Singapore permanent resident?",
      ],
      ["Why Stripe?", "Why do you want to work at Palantir?"],
    ]) {
      expect(labelScore(a, b), `${a} / ${b}`).toBeLessThan(MATCH_THRESHOLD);
    }
  });
});

/** Each field matched to the question it was built from (by order). */
function expectBuiltMatches(questions: ReturnType<typeof fillQuestions>) {
  const matches = matchFields(collectFields(document), questions);
  for (const { field, question } of matches) {
    expect(question, `no question for “${field.label}”`).not.toBeNull();
    expect(normalizeLabel(question!.label)).toBe(normalizeLabel(field.label));
  }
  return matches;
}

describe("matching real question lists to their forms", () => {
  it("Greenhouse (Stripe): every field finds its own question", () => {
    const raw = greenhouseQuestions();
    document.body.innerHTML = greenhouseMarkup(raw);
    const matches = expectBuiltMatches(fillQuestions(raw));
    expect(matches.length).toBeGreaterThan(10);
    const fields = matches.map((m) => m.question?.field);
    expect(fields).toEqual(
      expect.arrayContaining(["first_name", "last_name", "email", "resume"]),
    );
  });

  it("Ashby (Ramp): every field finds its own question", () => {
    const raw = ashbyQuestions();
    document.body.innerHTML = ashbyMarkup(raw);
    const matches = expectBuiltMatches(fillQuestions(raw));
    expect(matches.length).toBeGreaterThan(3);
  });

  it("Lever (Palantir): the real application page", () => {
    document.body.innerHTML = leverHtml();
    const questions = fillQuestions(leverQuestions());
    const matches = matchFields(collectFields(document), questions);
    const byLabel = (text: string) =>
      matches.find((m) => normalizeLabel(m.field.label).startsWith(text));

    expect(byLabel("full name")?.question?.field).toBe("full_name");
    expect(byLabel("email")?.question?.field).toBe("email");
    expect(byLabel("phone")?.question?.field).toBe("phone");
    expect(byLabel("linkedin")?.question?.field).toBe("linkedin");
    expect(byLabel("github")?.question?.field).toBe("github");
    expect(byLabel("resume cv")?.question?.field).toBe("resume");
    expect(byLabel("resume cv")?.field.kind).toBe("file");
    expect(byLabel("are you legally authorized")?.question?.field).toBe(
      "work_authorization",
    );
    expect(byLabel("are you legally authorized")?.field.kind).toBe("radio");
    expect(byLabel("will you now or in the future")?.question?.field).toBe(
      "sponsorship",
    );
    expect(byLabel("why do you want to work")?.question?.kind).toBe("written");
    // "Check all that apply" is one field, not one per box.
    expect(byLabel("language skill")?.field.kind).toBe("checkboxes");
    expect(byLabel("language skill")?.field.group.length).toBeGreaterThan(5);
    expect(byLabel("english")).toBeUndefined();
    // Not questions: Lever's free-text "Additional information" box, and
    // one checkbox whose name the trimmed fixture cuts off mid-attribute.
    expect(
      matches.filter((m) => !m.question).map((m) => m.field.label),
    ).toEqual(["Portuguese (POR)", "Additional information"]);
    // Every match is to the question with the same label: nothing guessed.
    for (const { field, question } of matches) {
      if (!question) continue;
      expect(labelScore(field.label, question.label)).toBeGreaterThanOrEqual(
        MATCH_THRESHOLD,
      );
    }
  });
});
