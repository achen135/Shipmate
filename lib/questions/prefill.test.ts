// @vitest-environment node
import { describe, expect, it } from "vitest";

import { classifyQuestion } from "./classify";
import {
  type AnswerProfile,
  DECLINE,
  DEFAULT_HOW_HEARD,
  prefillAnswer,
} from "./prefill";
import type { RawQuestion } from "./types";

const profile: AnswerProfile = {
  name: "Alex Chen",
  email: "alex@example.com",
  phone: "555-0100",
  school: "State University",
  degree: "bachelors",
  major: "Computer Science",
  gradMonth: 5,
  gradYear: 2028,
  workAuthorized: true,
  needsSponsorship: false,
  answers: {
    linkedin: "https://linkedin.com/in/alex",
    github: "https://github.com/alex",
  },
};

const ask = (label: string, extra: Partial<RawQuestion> = {}, p = profile) =>
  prefillAnswer(
    classifyQuestion({
      label,
      required: true,
      input: "text",
      options: [],
      ...extra,
    }),
    p,
  );

describe("prefillAnswer", () => {
  it("fills names from the profile name", () => {
    expect(ask("First Name")?.value).toBe("Alex");
    expect(ask("Last Name")?.value).toBe("Chen");
    expect(ask("Full name")?.value).toBe("Alex Chen");
  });

  it("fills contact and links, and only the links the user has", () => {
    expect(ask("Email")?.value).toBe("alex@example.com");
    expect(ask("Phone")?.value).toBe("555-0100");
    expect(ask("LinkedIn URL")?.value).toBe("https://linkedin.com/in/alex");
    expect(ask("Portfolio URL")).toEqual({
      value: null,
      note: "Add your website or portfolio in Profile.",
    });
    expect(ask("Github / Website")?.value).toBe(
      "https://linkedin.com/in/alex\nhttps://github.com/alex",
    );
  });

  it("says what to add rather than inventing a value", () => {
    const empty = { ...profile, phone: null, name: null };
    expect(ask("Phone", {}, empty)).toEqual({
      value: null,
      note: "Add your phone number in Profile.",
    });
    expect(ask("First Name", {}, empty)?.value).toBeNull();
  });

  it("answers work authorization and sponsorship in the form's own words", () => {
    const yesNo = ["Yes", "No"];
    expect(
      ask("Are you currently eligible to work in the United States?", {
        input: "select",
        options: yesNo,
      })?.value,
    ).toBe("Yes");
    expect(
      ask("Do you require visa sponsorship?", {
        input: "select",
        options: ["No, I do not", "Yes, I do"],
      })?.value,
    ).toBe("No, I do not");
    expect(
      ask(
        "Do you require visa sponsorship?",
        {},
        { ...profile, needsSponsorship: true },
      )?.value,
    ).toBe("Yes");
  });

  it("leaves authorization blank when the user never answered", () => {
    const p = { ...profile, workAuthorized: null };
    expect(
      ask("Are you legally authorized to work in the US?", {}, p)?.value,
    ).toBeNull();
  });

  it("formats graduation, degree, school, and major", () => {
    expect(ask("When do you expect to complete your degree?")?.value).toBe(
      "May 2028",
    );
    expect(ask("Highest level of education")?.value).toBe("Bachelor's");
    expect(ask("Which university do you attend?")?.value).toBe(
      "State University",
    );
    expect(ask("What is your major?")?.value).toBe("Computer Science");
  });

  it("falls back to a default for how-heard, and uses the user's own when set", () => {
    expect(ask("How did you hear about us?")?.value).toBe(DEFAULT_HOW_HEARD);
    const p = { ...profile, answers: { howHeard: "A friend" } };
    expect(ask("How did you hear about us?", {}, p)?.value).toBe("A friend");
  });

  it("declines demographic questions by default, picking the form's own decline option", () => {
    const veteran = ask("VeteranStatus", {
      input: "select",
      group: "demographic",
      options: [
        "I don't wish to answer",
        "I identify as one or more of the classifications of a protected veteran",
        "I am not a protected veteran",
      ],
    });
    expect(veteran?.value).toBe("I don't wish to answer");
    expect(
      ask("Gender", { input: "select", group: "demographic" })?.value,
    ).toBe(DECLINE);
  });

  it("uses a demographic answer only if the user chose to give one", () => {
    const p = { ...profile, answers: { demographics: { gender: "Woman" } } };
    expect(
      ask("Gender", { input: "select", group: "demographic" }, p)?.value,
    ).toBe("Woman");
    expect(
      ask("Race", { input: "select", group: "demographic" }, p)?.value,
    ).toBe(DECLINE);
  });

  it("has nothing for written, anti-bot, and other questions", () => {
    expect(
      ask("Why do you want to work here?", { input: "textarea" }),
    ).toBeNull();
    expect(ask("Decode this string and enter the result")).toBeNull();
    expect(ask("Who is your current employer?")).toBeNull();
  });
});
