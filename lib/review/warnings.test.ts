// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  type PreviousApplication,
  type WarningPosting,
  type WarningProfile,
  describePrevious,
  graduationYears,
  reviewWarnings,
} from "./warnings";

const posting: WarningPosting = {
  title: "Software Engineer Intern",
  terms: ["Summer 2027"],
  degrees: [],
  sponsorship: "unknown",
  description: null,
};
const profile: WarningProfile = {
  gradMonth: 12,
  gradYear: 2027,
  degree: "bachelors",
  needsSponsorship: false,
};

const kinds = (
  p: Partial<WarningPosting>,
  u: Partial<WarningProfile> = {},
  previous: PreviousApplication[] = [],
) =>
  reviewWarnings({
    posting: { ...posting, ...p },
    profile: { ...profile, ...u },
    previous,
  }).map((w) => w.kind);

describe("graduationYears", () => {
  it.each([
    ["We're hiring the class of 2028.", [2028]],
    [
      "Open to students graduating between December 2026 and June 2028.",
      [2026, 2028],
    ],
    ["Expected graduation date: May 2027", [2027]],
    ["2027 graduates welcome", [2027]],
    ["Founded in 2015, we have 400 employees. Summer 2027 program.", []],
  ])("%s", (text, years) => {
    expect(graduationYears(text)).toEqual(years);
  });
});

describe("graduation year warning", () => {
  it("warns when the posting names a different class year", () => {
    const [warning] = reviewWarnings({
      posting: { ...posting, description: "Open to the class of 2028." },
      profile,
      previous: [],
    });
    expect(warning).toMatchObject({ kind: "grad_year" });
    expect(warning.message).toBe(
      "The posting mentions graduating in 2028; you graduate in 2027.",
    );
  });

  it("is quiet when the year is in the posting's range, or none is named", () => {
    expect(
      kinds({ description: "Graduating between 2026 and 2028" }),
    ).not.toContain("grad_year");
    expect(kinds({ description: "No class year here." })).not.toContain(
      "grad_year",
    );
  });

  it("is quiet when the user hasn't said their year", () => {
    expect(
      kinds({ description: "Class of 2030" }, { gradYear: null }),
    ).not.toContain("grad_year");
  });
});

describe("term vs graduation", () => {
  it("warns an internship that starts after the user has graduated", () => {
    const warnings = reviewWarnings({
      posting,
      profile: { ...profile, gradMonth: 5, gradYear: 2027 },
      previous: [],
    });
    expect(warnings[0].kind).toBe("term");
    expect(warnings[0].message).toContain(
      "May 2027, before Summer 2027 starts",
    );
  });

  it("is quiet when graduation is after the term starts", () => {
    expect(kinds({})).not.toContain("term");
  });

  it("is quiet if any listed term starts before graduation", () => {
    expect(
      kinds(
        { terms: ["Summer 2027", "Summer 2028"] },
        { gradMonth: 5, gradYear: 2028 },
      ),
    ).not.toContain("term");
  });

  it("only applies to internships with a readable season", () => {
    const late = { gradMonth: 5, gradYear: 2027 };
    expect(
      kinds({ title: "Software Engineer", terms: ["Summer 2027"] }, late),
    ).not.toContain("term");
    expect(kinds({ terms: ["N/A"] }, late)).not.toContain("term");
    expect(kinds({ terms: [] }, late)).not.toContain("term");
  });
});

describe("degree warning", () => {
  it("warns when the listed degrees exclude the user's", () => {
    const warning = reviewWarnings({
      posting: { ...posting, degrees: ["Master's", "PhD"] },
      profile,
      previous: [],
    }).find((w) => w.kind === "degree");
    expect(warning?.message).toBe(
      "The posting lists Master's, PhD; you're working toward a Bachelor's degree.",
    );
  });

  it("is quiet when it includes the user's degree, lists none, or the user is 'other'", () => {
    expect(kinds({ degrees: ["Bachelor's", "Master's"] })).not.toContain(
      "degree",
    );
    expect(kinds({ degrees: [] })).not.toContain("degree");
    expect(kinds({ degrees: ["PhD"] }, { degree: "other" })).not.toContain(
      "degree",
    );
    expect(kinds({ degrees: ["Something odd"] })).not.toContain("degree");
  });

  it("understands spellings", () => {
    expect(
      kinds({ degrees: ["Masters"] }, { degree: "masters" }),
    ).not.toContain("degree");
    expect(kinds({ degrees: ["MBA"] }, { degree: "masters" })).not.toContain(
      "degree",
    );
  });
});

describe("sponsorship warning", () => {
  it("warns a user who needs sponsorship at a no-sponsorship or citizens-only role", () => {
    expect(
      kinds({ sponsorship: "no_sponsorship" }, { needsSponsorship: true }),
    ).toContain("sponsorship");
    expect(
      kinds({ sponsorship: "citizens_only" }, { needsSponsorship: true }),
    ).toContain("sponsorship");
  });

  it("is quiet otherwise", () => {
    expect(
      kinds({ sponsorship: "no_sponsorship" }, { needsSponsorship: false }),
    ).not.toContain("sponsorship");
    expect(
      kinds({ sponsorship: "no_sponsorship" }, { needsSponsorship: null }),
    ).not.toContain("sponsorship");
    expect(
      kinds({ sponsorship: "offers" }, { needsSponsorship: true }),
    ).not.toContain("sponsorship");
    expect(
      kinds({ sponsorship: "unknown" }, { needsSponsorship: true }),
    ).not.toContain("sponsorship");
  });
});

describe("previous applications", () => {
  const ramp: PreviousApplication = {
    id: "1",
    role: "Software Engineer Intern, Frontend",
    appliedAt: "2026-09-20",
    status: "applied",
    unsure: false,
  };

  it("lists earlier applications at the company, first", () => {
    const warnings = reviewWarnings({
      posting: { ...posting, description: "Class of 2030" },
      profile,
      previous: [ramp],
    });
    expect(warnings.map((w) => w.kind)).toEqual(["previous", "grad_year"]);
    expect(warnings[0].message).toBe("You've applied to this company before:");
    expect(warnings[0].previous).toEqual([ramp]);
  });

  it("counts several", () => {
    const [w] = reviewWarnings({
      posting,
      profile,
      previous: [ramp, { ...ramp, id: "2" }],
    });
    expect(w.message).toBe("You've applied to this company 2 times before:");
  });

  it("describes one with its role, date, and status", () => {
    expect(describePrevious(ramp)).toBe(
      "Software Engineer Intern, Frontend, 9/20 (Applied)",
    );
    expect(
      describePrevious({
        ...ramp,
        role: null,
        appliedAt: null,
        unsure: true,
        status: "rejected",
      }),
    ).toBe("Role not listed, no date (Rejected?)");
  });

  it("is absent with no history", () => {
    expect(kinds({})).not.toContain("previous");
  });
});

it("never blocks: a posting that trips every rule still returns plain warnings", () => {
  const all = reviewWarnings({
    posting: {
      ...posting,
      degrees: ["PhD"],
      sponsorship: "citizens_only",
      description: "Class of 2030",
    },
    profile: { ...profile, gradMonth: 5, needsSponsorship: true },
    previous: [
      {
        id: "1",
        role: "X",
        appliedAt: null,
        status: "rejected",
        unsure: false,
      },
    ],
  });
  expect(all.map((w) => w.kind).sort()).toEqual([
    "degree",
    "grad_year",
    "previous",
    "sponsorship",
    "term",
  ]);
});
