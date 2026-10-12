// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  formFromPreset,
  formFromRow,
  listFromText,
  rowFromForm,
  watchProfileSchema,
} from "./watch-profile";

describe("listFromText", () => {
  it("splits on commas and newlines, trims, and dedupes ignoring case", () => {
    expect(listFromText(" ML,  data   science\nml,, AI ")).toEqual([
      "ML",
      "data science",
      "AI",
    ]);
    expect(listFromText("")).toEqual([]);
  });
});

describe("watchProfileSchema", () => {
  it("accepts every preset as prefilled", () => {
    for (const preset of [
      "swe",
      "ai_ml_data",
      "quant",
      "hardware",
      "product",
      "supply_chain_ops",
    ]) {
      expect(
        watchProfileSchema.safeParse(formFromPreset(preset, false)).success,
      ).toBe(true);
    }
  });

  it("needs a category or a keyword (Custom starts empty)", () => {
    const result = watchProfileSchema.safeParse(
      formFromPreset("custom", false),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["includeKeywords"]);
  });

  it("needs at least one term", () => {
    expect(
      watchProfileSchema.safeParse({
        ...formFromPreset("swe", false),
        terms: [],
      }).success,
    ).toBe(false);
  });

  it("caps list sizes", () => {
    const many = Array.from({ length: 51 }, (_, i) => `k${i}`).join(",");
    expect(
      watchProfileSchema.safeParse({
        ...formFromPreset("swe", false),
        excludeKeywords: many,
      }).success,
    ).toBe(false);
  });
});

describe("row ↔ form", () => {
  it("round-trips", () => {
    const form = {
      ...formFromPreset("quant", true),
      locations: "NYC, Chicago",
      excludeKeywords: "PhD",
    };
    const row = rowFromForm(form);
    expect(row).toMatchObject({
      preset: "quant",
      categories: ["Quant"],
      locations: ["NYC", "Chicago"],
      exclude_keywords: ["PhD"],
      needs_sponsorship: true,
      terms: ["Summer 2027"],
    });
    expect(formFromRow(row)).toEqual(form);
  });
});
