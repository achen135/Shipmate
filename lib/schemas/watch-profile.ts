import { z } from "zod";

import type { MatchRules } from "@/lib/matching";
import { CATEGORIES } from "@/lib/postings/normalize";
import {
  DEFAULT_TERMS,
  PRESET_IDS,
  TERM_OPTIONS,
  presetById,
} from "@/lib/watch/presets";

/**
 * Watch profile form (onboarding "What to watch" + Profile). Keyword and
 * location lists are typed as comma-separated text, which is easy on a phone;
 * listFromText() turns them into the arrays the table stores. Mirrors the
 * CHECK constraints on public.watch_profiles.
 */

const MAX_ITEMS = 50;
const MAX_ITEM_LENGTH = 60;

/** "a, b,, A" → ["a", "b"] (trimmed, case-insensitive dedupe, capped). */
export function listFromText(text: string, max = MAX_ITEMS): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const item = raw.trim().replace(/\s+/g, " ");
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items.slice(0, max);
}

const listText = (max: number) =>
  z
    .string()
    .max(2000, "That list is too long.")
    .refine(
      (text) => listFromText(text, Infinity).length <= max,
      `Keep it to ${max} or fewer.`,
    )
    .refine(
      (text) =>
        listFromText(text, Infinity).every((i) => i.length <= MAX_ITEM_LENGTH),
      `Keep each one under ${MAX_ITEM_LENGTH} characters.`,
    );

export const watchProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give it a name.")
      .max(60, "Keep it under 60 characters."),
    preset: z.enum(PRESET_IDS),
    categories: z.array(z.enum(CATEGORIES)),
    includeKeywords: listText(MAX_ITEMS),
    excludeKeywords: listText(MAX_ITEMS),
    terms: z
      .array(z.enum(TERM_OPTIONS))
      .min(1, "Pick at least one term.")
      .max(TERM_OPTIONS.length),
    locations: listText(30),
    remoteOk: z.boolean(),
    needsSponsorship: z.boolean(),
  })
  .refine(
    (v) =>
      v.categories.length > 0 || listFromText(v.includeKeywords).length > 0,
    {
      message: "Pick a category or add a keyword, or this matches everything.",
      path: ["includeKeywords"],
    },
  );

export type WatchProfileForm = z.infer<typeof watchProfileSchema>;

export type WatchProfileRow = {
  name: string;
  preset: string;
  categories: string[];
  include_keywords: string[];
  exclude_keywords: string[];
  terms: string[];
  locations: string[];
  remote_ok: boolean;
  needs_sponsorship: boolean;
};

/** Form values for a fresh profile from a preset. */
export function formFromPreset(
  presetId: string,
  needsSponsorship: boolean,
): WatchProfileForm {
  const preset = presetById(presetId);
  return {
    name: preset.id === "custom" ? "My search" : preset.label,
    preset: preset.id,
    categories: [...preset.categories],
    includeKeywords: preset.includeKeywords.join(", "),
    excludeKeywords: preset.excludeKeywords.join(", "),
    terms: [...DEFAULT_TERMS] as WatchProfileForm["terms"],
    locations: "",
    remoteOk: true,
    needsSponsorship,
  };
}

export function formFromRow(row: WatchProfileRow): WatchProfileForm {
  const preset = PRESET_IDS.find((p) => p === row.preset) ?? "custom";
  return {
    name: row.name,
    preset,
    categories: row.categories.filter((c): c is (typeof CATEGORIES)[number] =>
      (CATEGORIES as readonly string[]).includes(c),
    ),
    includeKeywords: row.include_keywords.join(", "),
    excludeKeywords: row.exclude_keywords.join(", "),
    terms: row.terms.filter((t): t is (typeof TERM_OPTIONS)[number] =>
      (TERM_OPTIONS as readonly string[]).includes(t),
    ),
    locations: row.locations.join(", "),
    remoteOk: row.remote_ok,
    needsSponsorship: row.needs_sponsorship,
  };
}

export function rowFromForm(form: WatchProfileForm): WatchProfileRow {
  return {
    name: form.name,
    preset: form.preset,
    categories: form.categories,
    include_keywords: listFromText(form.includeKeywords),
    exclude_keywords: listFromText(form.excludeKeywords),
    terms: form.terms,
    locations: listFromText(form.locations, 30),
    remote_ok: form.remoteOk,
    needs_sponsorship: form.needsSponsorship,
  };
}

/** A stored row → what lib/matching.ts needs. */
export function rulesFromRow(row: WatchProfileRow): MatchRules {
  return {
    categories: row.categories,
    includeKeywords: row.include_keywords,
    excludeKeywords: row.exclude_keywords,
    terms: row.terms,
    locations: row.locations,
    remoteOk: row.remote_ok,
  };
}
