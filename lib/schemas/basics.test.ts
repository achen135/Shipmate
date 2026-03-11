// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  basicsFromProfile,
  basicsSchema,
  basicsToProfile,
  gradYearOptions,
} from "./basics";

const valid = {
  name: "  Sam Rivera ",
  school: "Georgia Tech",
  degree: "bachelors",
  major: "Industrial Engineering",
  gradMonth: 5,
  gradYear: 2028,
  workAuthorized: true,
  needsSponsorship: false,
};

describe("basicsSchema", () => {
  it("accepts a complete form and trims text", () => {
    const parsed = basicsSchema.parse(valid);
    expect(parsed.name).toBe("Sam Rivera");
  });

  it("requires every field", () => {
    const result = basicsSchema.safeParse({});
    expect(result.success).toBe(false);
    const fields = Object.keys(z.flattenError(result.error!).fieldErrors);
    expect(fields.sort()).toEqual(
      [
        "degree",
        "gradMonth",
        "gradYear",
        "major",
        "name",
        "needsSponsorship",
        "school",
        "workAuthorized",
      ].sort(),
    );
  });

  it("rejects blank text and out-of-range dates", () => {
    expect(basicsSchema.safeParse({ ...valid, school: "   " }).success).toBe(
      false,
    );
    expect(basicsSchema.safeParse({ ...valid, gradMonth: 13 }).success).toBe(
      false,
    );
    expect(basicsSchema.safeParse({ ...valid, degree: "mba" }).success).toBe(
      false,
    );
  });
});

describe("profile mapping", () => {
  it("round-trips through the DB column names", () => {
    const parsed = basicsSchema.parse(valid);
    const row = basicsToProfile(parsed);
    expect(row).toMatchObject({ grad_month: 5, needs_sponsorship: false });
    expect(basicsFromProfile(row)).toEqual(parsed);
  });

  it("leaves unanswered fields undefined", () => {
    const empty = basicsFromProfile({
      name: "Sam",
      school: null,
      degree: null,
      major: null,
      grad_month: null,
      grad_year: null,
      work_authorized: null,
      needs_sponsorship: null,
    });
    expect(empty).toMatchObject({ name: "Sam", school: "", degree: undefined });
    expect(empty.workAuthorized).toBeUndefined();
  });
});

describe("gradYearOptions", () => {
  it("offers a window around this year and keeps an old saved year", () => {
    expect(gradYearOptions(2026)).toEqual([
      2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031,
    ]);
    expect(gradYearOptions(2026, 2019)[0]).toBe(2019);
  });
});
