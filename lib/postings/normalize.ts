/**
 * Normalizing upstream values into the shapes `postings` stores. Shared by
 * the source adapters, dedupe, and matching.
 */

/** Simplify's five categories, which matching and presets use. */
export const CATEGORIES = [
  "Software",
  "AI/ML/Data",
  "Hardware",
  "Quant",
  "Product",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Upstream spellings → our category. Simplify mostly uses the short names
 * but a few rows carry the long ones (measured 2026-10-10).
 */
const CATEGORY_ALIASES: Record<string, Category> = {
  software: "Software",
  "software engineering": "Software",
  "ai/ml/data": "AI/ML/Data",
  "data science, ai & machine learning": "AI/ML/Data",
  hardware: "Hardware",
  "hardware engineering": "Hardware",
  quant: "Quant",
  "quantitative finance": "Quant",
  product: "Product",
  "product management": "Product",
};

export function normalizeCategory(value: unknown): Category | null {
  if (typeof value !== "string") return null;
  return CATEGORY_ALIASES[value.trim().toLowerCase()] ?? null;
}

export const SPONSORSHIP = [
  "unknown",
  "offers",
  "no_sponsorship",
  "citizens_only",
] as const;

export type Sponsorship = (typeof SPONSORSHIP)[number];

/**
 * Simplify's `sponsorship`: "Other" (99% of rows) means unknown; only these
 * three carry information.
 */
export function normalizeSponsorship(value: unknown): Sponsorship {
  switch (typeof value === "string" ? value.trim().toLowerCase() : "") {
    case "offers sponsorship":
      return "offers";
    case "does not offer sponsorship":
      return "no_sponsorship";
    case "u.s. citizenship is required":
      return "citizens_only";
    default:
      return "unknown";
  }
}

/** Lowercase, accents stripped, `&` → and, anything else non-alphanumeric → space. */
export function simplifyText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "lp",
  "llp",
]);

/** "The Boeing Company" and "Boeing" → "boeing". Used as companies.normalized_name. */
export function normalizeCompany(name: string): string {
  const words = simplifyText(name).split(" ").filter(Boolean);
  if (words[0] === "the" && words.length > 1) words.shift();
  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1)!)) words.pop();
  return words.join(" ");
}

/**
 * Last-resort dedupe key: normalized company + title + first location. Null
 * when company or title is empty (no key beats a key that merges everything).
 */
export function fuzzyKey(posting: {
  company: string;
  title: string;
  locations: readonly string[];
}): string | null {
  const company = normalizeCompany(posting.company);
  const title = simplifyText(posting.title);
  if (!company || !title) return null;
  const location = simplifyText(posting.locations[0] ?? "");
  return `${company}|${title}|${location}`;
}
