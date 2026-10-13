import { z } from "zod";

/**
 * Profile → "Application answers" (profiles.standard_answers, profiles.phone).
 * The links and the "how did you hear" line feed the answer sheet; a blank
 * demographic answer means "decline to answer", and none is ever required. Shared by
 * the form and the Server Action; the database only keeps it a small object.
 */

const link = (label: string) =>
  z
    .string()
    .trim()
    .max(300, `Keep the ${label} link under 300 characters.`)
    .refine(
      (value) => value === "" || /^https?:\/\/\S+$/i.test(value),
      `Paste the full ${label} link (https://…).`,
    );

export const DEMOGRAPHIC_TOPICS = [
  { key: "gender", label: "Gender" },
  { key: "race", label: "Race / ethnicity" },
  { key: "veteran", label: "Veteran status" },
  { key: "disability", label: "Disability status" },
] as const;

export const standardAnswersSchema = z.object({
  phone: z
    .string()
    .trim()
    .max(40, "Keep the phone number under 40 characters."),
  linkedin: link("LinkedIn"),
  github: link("GitHub"),
  portfolio: link("website"),
  howHeard: z.string().trim().max(200, "Keep it under 200 characters."),
  demographics: z.object({
    gender: z.string().trim().max(100),
    race: z.string().trim().max(100),
    veteran: z.string().trim().max(100),
    disability: z.string().trim().max(100),
  }),
});

export type StandardAnswersInput = z.infer<typeof standardAnswersSchema>;

/** Form values → profiles.standard_answers (empty values left out). */
export function answersToColumn(input: StandardAnswersInput) {
  const demographics = Object.fromEntries(
    Object.entries(input.demographics).filter(([, v]) => v !== ""),
  );
  return {
    ...(input.linkedin ? { linkedin: input.linkedin } : {}),
    ...(input.github ? { github: input.github } : {}),
    ...(input.portfolio ? { portfolio: input.portfolio } : {}),
    ...(input.howHeard ? { howHeard: input.howHeard } : {}),
    ...(Object.keys(demographics).length ? { demographics } : {}),
  };
}

/** profiles row → form values. Anything not set reads as empty (= decline). */
export function answersFromProfile(
  profile: {
    phone: string | null;
    standard_answers: unknown;
  } | null,
): StandardAnswersInput {
  const raw = (
    profile &&
    typeof profile.standard_answers === "object" &&
    profile.standard_answers
      ? profile.standard_answers
      : {}
  ) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const demo = (raw.demographics ?? {}) as Record<string, unknown>;
  const topic = (key: string) => text(demo[key]);
  return {
    phone: profile?.phone ?? "",
    linkedin: text(raw.linkedin),
    github: text(raw.github),
    portfolio: text(raw.portfolio),
    howHeard: text(raw.howHeard),
    demographics: {
      gender: topic("gender"),
      race: topic("race"),
      veteran: topic("veteran"),
      disability: topic("disability"),
    },
  };
}
