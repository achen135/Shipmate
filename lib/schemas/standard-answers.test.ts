import { describe, expect, it } from "vitest";

import {
  answersFromProfile,
  answersToColumn,
  standardAnswersSchema,
} from "./standard-answers";

const blank = answersFromProfile(null);

describe("standardAnswersSchema", () => {
  it("accepts a blank form (every answer is optional)", () => {
    expect(standardAnswersSchema.safeParse(blank).success).toBe(true);
  });

  it("wants full links, not bare handles", () => {
    const bad = standardAnswersSchema.safeParse({
      ...blank,
      linkedin: "linkedin.com/in/a",
    });
    expect(bad.success).toBe(false);
    const good = standardAnswersSchema.safeParse({
      ...blank,
      linkedin: "https://linkedin.com/in/a",
    });
    expect(good.success).toBe(true);
  });

  it("caps lengths", () => {
    expect(
      standardAnswersSchema.safeParse({ ...blank, howHeard: "x".repeat(201) })
        .success,
    ).toBe(false);
    expect(
      standardAnswersSchema.safeParse({ ...blank, phone: "1".repeat(41) })
        .success,
    ).toBe(false);
  });
});

describe("answersToColumn / answersFromProfile", () => {
  it("leaves out empty answers, so declined demographics aren't stored", () => {
    expect(answersToColumn(blank)).toEqual({});
    expect(
      answersToColumn({
        ...blank,
        github: "https://github.com/a",
        demographics: { ...blank.demographics, gender: "Woman" },
      }),
    ).toEqual({
      github: "https://github.com/a",
      demographics: { gender: "Woman" },
    });
  });

  it("round-trips through the profile row", () => {
    const input = {
      ...blank,
      phone: "555",
      howHeard: "Friend",
      portfolio: "https://a.dev",
    };
    const row = {
      phone: input.phone,
      standard_answers: answersToColumn(input),
    };
    expect(answersFromProfile(row)).toEqual(input);
  });

  it("tolerates junk in the column", () => {
    expect(
      answersFromProfile({ phone: null, standard_answers: [1, "x"] }),
    ).toEqual(blank);
  });
});
