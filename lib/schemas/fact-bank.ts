import { z } from "zod";

/**
 * Fact bank: true things about the user that aren't on their resume
 * (Spec "Tailoring pipeline"). Tailoring (M7) may add one to a tailored
 * resume only if it's here or on the master resume (hard rule 2).
 */

export const FACT_KINDS = [
  "skill",
  "project",
  "coursework",
  "club",
  "award",
  "other",
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_KIND_LABELS: Record<FactKind, string> = {
  skill: "Skills and tools",
  project: "Projects",
  coursework: "Coursework",
  club: "Clubs and leadership",
  award: "Awards",
  other: "Other",
};

export const FACT_KIND_HINTS: Record<FactKind, string> = {
  skill: "e.g. Rust, Figma, SQL window functions",
  project: "e.g. Discord bot for my dorm (Python, 200 users)",
  coursework: "e.g. Operating Systems (CS 162)",
  club: "e.g. Treasurer, Robotics Club, 2025–2026",
  award: "e.g. Dean's List, Fall 2025",
  other: "Anything else that's true and might matter",
};

export const factInputSchema = z.object({
  kind: z.enum(FACT_KINDS),
  text: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(200, "Keep the short version under 200 characters."),
  detail: z.string().trim().max(600, "Keep details under 600 characters."),
});

export type FactInput = z.input<typeof factInputSchema>;
export type Fact = z.output<typeof factInputSchema> & {
  id: string;
  source: "manual" | "imported";
};

/** Read a fact_bank row; null if its content isn't the expected shape. */
export function factFromRow(row: {
  id: string;
  kind: string;
  content: unknown;
  source: string;
}): Fact | null {
  const parsed = factInputSchema.safeParse({
    kind: row.kind,
    ...(typeof row.content === "object" && row.content ? row.content : {}),
    detail: (row.content as { detail?: unknown } | null)?.detail ?? "",
  });
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    id: row.id,
    source: row.source === "imported" ? "imported" : "manual",
  };
}

/** What the CV extraction asks the AI for (every field required). */
export const extractedFactsSchema = z.object({
  facts: z.array(
    z.object({
      kind: z.enum(FACT_KINDS),
      text: z.string(),
      detail: z.string(),
    }),
  ),
});
