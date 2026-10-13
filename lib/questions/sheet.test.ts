// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseGreenhouseQuestions } from "./greenhouse";
import type { AnswerProfile } from "./prefill";
import { buildSheet } from "./sheet";
import { parseAshbyQuestions } from "./ashby";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(__dirname, "__fixtures__", name), "utf8"),
  ) as unknown;

const profile: AnswerProfile = {
  name: "Alex Chen",
  email: "alex@example.com",
  phone: null,
  school: "State University",
  degree: "bachelors",
  major: "Computer Science",
  gradMonth: 5,
  gradYear: 2028,
  workAuthorized: true,
  needsSponsorship: false,
  answers: {},
};

describe("buildSheet", () => {
  it("sorts a real Greenhouse form into groups and prefills the standard ones", () => {
    const sheet = buildSheet(
      parseGreenhouseQuestions(fixture("greenhouse-stripe-questions.json")),
      profile,
    );
    expect(sheet.total).toBe(
      sheet.standard.length +
        sheet.written.length +
        sheet.antibot.length +
        sheet.other.length +
        sheet.demographic.length,
    );
    const email = sheet.standard.find((i) => i.question.field === "email");
    expect(email?.prefill?.value).toBe("alex@example.com");
    // Never filled in for the user, only suggested as "decline".
    expect(sheet.demographic.length).toBeGreaterThanOrEqual(3);
    expect(
      sheet.demographic.every(
        (i) =>
          !i.prefill?.value || /decline|wish|prefer/i.test(i.prefill.value),
      ),
    ).toBe(true);
    expect(sheet.written.length).toBeGreaterThanOrEqual(3);
    expect(sheet.antibot).toHaveLength(0);
  });

  it("puts Ramp's puzzle questions in the anti-bot group with no answer", () => {
    const sheet = buildSheet(
      parseAshbyQuestions(fixture("ashby-ramp-security.json")),
      profile,
    );
    expect(sheet.antibot).toHaveLength(2);
    expect(sheet.antibot.every((i) => i.prefill === null)).toBe(true);
  });

  it("says what is missing instead of inventing it", () => {
    const sheet = buildSheet(
      parseGreenhouseQuestions(fixture("greenhouse-stripe-questions.json")),
      profile,
    );
    const phone = sheet.standard.find((i) => i.question.field === "phone");
    expect(phone?.prefill).toEqual({
      value: null,
      note: "Add your phone number in Profile.",
    });
  });
});
