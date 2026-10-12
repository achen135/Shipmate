// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  fuzzyKey,
  normalizeCategory,
  normalizeCompany,
  normalizeSponsorship,
} from "./normalize";

describe("normalizeCategory", () => {
  it("maps Simplify's short and long spellings", () => {
    expect(normalizeCategory("Software")).toBe("Software");
    expect(normalizeCategory("Software Engineering")).toBe("Software");
    expect(normalizeCategory("Data Science, AI & Machine Learning")).toBe(
      "AI/ML/Data",
    );
    expect(normalizeCategory("Hardware Engineering")).toBe("Hardware");
    expect(normalizeCategory("Product Management")).toBe("Product");
    expect(normalizeCategory("Quant")).toBe("Quant");
  });

  it("is null for anything else", () => {
    expect(normalizeCategory("Other")).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
  });
});

describe("normalizeSponsorship", () => {
  it("only the three informative values carry meaning", () => {
    expect(normalizeSponsorship("Offers Sponsorship")).toBe("offers");
    expect(normalizeSponsorship("Does Not Offer Sponsorship")).toBe(
      "no_sponsorship",
    );
    expect(normalizeSponsorship("U.S. Citizenship is Required")).toBe(
      "citizens_only",
    );
    expect(normalizeSponsorship("Other")).toBe("unknown");
    expect(normalizeSponsorship(undefined)).toBe("unknown");
  });
});

describe("normalizeCompany", () => {
  it("drops case, punctuation, a leading 'the', and legal suffixes", () => {
    expect(normalizeCompany("The Boeing Company")).toBe("boeing");
    expect(normalizeCompany("Jane Street Capital, LLC")).toBe(
      "jane street capital",
    );
    expect(normalizeCompany("AT&T Inc.")).toBe("at and t");
    expect(normalizeCompany("Nestlé")).toBe("nestle");
  });

  it("never empties a one-word name", () => {
    expect(normalizeCompany("Company")).toBe("company");
  });
});

describe("fuzzyKey", () => {
  it("is the same for punctuation-only differences", () => {
    const a = fuzzyKey({
      company: "Stripe, Inc.",
      title: "Software Engineer Intern - Summer 2027",
      locations: ["San Francisco, CA", "Seattle, WA"],
    });
    const b = fuzzyKey({
      company: "Stripe",
      title: "Software Engineer Intern (Summer 2027)",
      locations: ["San Francisco, CA"],
    });
    expect(a).toBe(
      "stripe|software engineer intern summer 2027|san francisco ca",
    );
    expect(b).toBe(a);
  });

  it("differs by first location", () => {
    expect(
      fuzzyKey({ company: "A", title: "Intern", locations: ["NYC"] }),
    ).not.toBe(fuzzyKey({ company: "A", title: "Intern", locations: ["SF"] }));
  });

  it("is null without a company or title", () => {
    expect(
      fuzzyKey({ company: "", title: "Intern", locations: [] }),
    ).toBeNull();
    expect(fuzzyKey({ company: "A", title: "—", locations: [] })).toBeNull();
  });
});
