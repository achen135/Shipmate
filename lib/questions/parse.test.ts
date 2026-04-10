// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseAshbyQuestions } from "./ashby";
import { parseGreenhouseQuestions } from "./greenhouse";
import { parseLeverQuestions } from "./lever";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const json = (name: string) => JSON.parse(fixture(name)) as unknown;

describe("parseGreenhouseQuestions (Stripe, real response)", () => {
  const questions = parseGreenhouseQuestions(
    json("greenhouse-stripe-questions.json"),
  );
  const by = (start: string) =>
    questions.find((q) => q.label.startsWith(start))!;

  it("reads the form, the location block, and the EEO block", () => {
    expect(questions.length).toBeGreaterThan(25);
    expect(by("First Name")).toMatchObject({ required: true, input: "text" });
    expect(by("Location")).toMatchObject({ input: "text" });
  });

  it("drops hidden fields (latitude, longitude)", () => {
    expect(questions.some((q) => /^(Latitude|Longitude)$/.test(q.label))).toBe(
      false,
    );
  });

  it("calls a file-plus-textarea question a file", () => {
    expect(by("Resume/CV").input).toBe("file");
  });

  it("keeps select options and the help text as plain text", () => {
    const sponsorship = by("Do you require visa sponsorship");
    expect(sponsorship.input).toBe("select");
    expect(sponsorship.options.length).toBeGreaterThanOrEqual(2);
    expect(by("When do you expect").description).toBe(
      "We understand the timing can shift, so please give an approximate estimate (month and year).",
    );
  });

  it("marks the EEO questions as demographic", () => {
    const eeo = questions.filter((q) => q.group === "demographic");
    expect(eeo.map((q) => q.label)).toContain("VeteranStatus");
    expect(eeo.every((q) => q.input === "select")).toBe(true);
  });

  it("throws on a response that isn't a job (so the caller reports a failure)", () => {
    expect(() => parseGreenhouseQuestions({ error: "x" })).toThrow();
    expect(() => parseGreenhouseQuestions(null)).toThrow();
  });
});

describe("parseAshbyQuestions (Ramp, real responses)", () => {
  it("maps Ashby field types", () => {
    const questions = parseAshbyQuestions(json("ashby-ramp-frontend.json"));
    const by = (start: string) =>
      questions.find((q) => q.label.startsWith(start))!;
    expect(by("Legal Name")).toMatchObject({ input: "text", required: true });
    expect(by("Resume").input).toBe("file");
    expect(by("Cover Letter")).toMatchObject({
      input: "file",
      required: false,
    });
    expect(by("Are you currently based").input).toBe("boolean");
  });

  it("reads LongText as a textarea", () => {
    const questions = parseAshbyQuestions(json("ashby-ramp-security.json"));
    expect(questions.filter((q) => q.input === "textarea").length).toBe(3);
  });

  it("throws when the posting is gone (jobPosting: null)", () => {
    expect(() => parseAshbyQuestions({ data: { jobPosting: null } })).toThrow();
  });
});

describe("parseLeverQuestions (Palantir, real apply page)", () => {
  const questions = parseLeverQuestions(fixture("lever-palantir-apply.html"));
  const by = (start: string) =>
    questions.find((q) => q.label.startsWith(start))!;

  it("reads standard and custom questions", () => {
    expect(by("Full name")).toMatchObject({ input: "text", required: true });
    expect(by("Phone")).toMatchObject({ required: false });
    expect(by("Why do you want to work at Palantir")).toMatchObject({
      input: "textarea",
    });
  });

  it("finds the resume upload", () => {
    expect(by("Resume/CV").input).toBe("file");
  });

  it("reads checkbox groups as multiselect with their choices", () => {
    const languages = by("Language Skill(s)");
    expect(languages.input).toBe("multiselect");
    expect(languages.options).toContain("English (ENG)");
    expect(languages.required).toBe(true);
  });

  it("throws on a page with no form", () => {
    expect(() => parseLeverQuestions("<html>nothing</html>")).toThrow();
  });
});
