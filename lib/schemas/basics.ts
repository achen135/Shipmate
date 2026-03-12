import { z } from "zod";

/**
 * Onboarding step 2 / Profile "Basics". Shared by the form (client), the
 * Server Action (server), and later the answer sheet and fit warnings.
 * Mirrors the CHECK constraints on public.profiles.
 */

export const DEGREES = [
  { value: "associate", label: "Associate" },
  { value: "bachelors", label: "Bachelor's" },
  { value: "masters", label: "Master's" },
  { value: "phd", label: "PhD" },
  { value: "other", label: "Other" },
] as const;

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const DEGREE_VALUES = DEGREES.map((d) => d.value) as [
  (typeof DEGREES)[number]["value"],
  ...(typeof DEGREES)[number]["value"][],
];

const requiredText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Enter your ${label}.`)
    .max(max, `Keep it under ${max} characters.`);

const yesNo = (message: string) => z.boolean({ error: message });

export const basicsSchema = z.object({
  name: requiredText("name", 100),
  school: requiredText("school", 150),
  degree: z.enum(DEGREE_VALUES, { error: "Pick a degree." }),
  major: requiredText("major", 100),
  gradMonth: z
    .number({ error: "Pick a month." })
    .int()
    .min(1, "Pick a month.")
    .max(12, "Pick a month."),
  gradYear: z
    .number({ error: "Pick a year." })
    .int()
    .min(2000, "Pick a year.")
    .max(2100, "Pick a year."),
  workAuthorized: yesNo("Choose yes or no."),
  needsSponsorship: yesNo("Choose yes or no."),
});

export type Basics = z.infer<typeof basicsSchema>;

/** Graduation years offered in the picker, plus the saved one if it's outside. */
export function gradYearOptions(currentYear: number, saved?: number | null) {
  const years = Array.from({ length: 9 }, (_, i) => currentYear - 3 + i);
  if (saved && !years.includes(saved)) years.push(saved);
  return years.sort((a, b) => a - b);
}

/** DB row → form values (null where the user hasn't answered yet). */
export function basicsFromProfile(
  profile: {
    name: string | null;
    school: string | null;
    degree: string | null;
    major: string | null;
    grad_month: number | null;
    grad_year: number | null;
    work_authorized: boolean | null;
    needs_sponsorship: boolean | null;
  } | null,
): Partial<Basics> {
  if (!profile) return {};
  const degree = DEGREE_VALUES.find((d) => d === profile.degree);
  return {
    name: profile.name ?? "",
    school: profile.school ?? "",
    degree,
    major: profile.major ?? "",
    gradMonth: profile.grad_month ?? undefined,
    gradYear: profile.grad_year ?? undefined,
    workAuthorized: profile.work_authorized ?? undefined,
    needsSponsorship: profile.needs_sponsorship ?? undefined,
  };
}

/** Form values → the profile columns the user may update. */
export function basicsToProfile(basics: Basics) {
  return {
    name: basics.name,
    school: basics.school,
    degree: basics.degree,
    major: basics.major,
    grad_month: basics.gradMonth,
    grad_year: basics.gradYear,
    work_authorized: basics.workAuthorized,
    needs_sponsorship: basics.needsSponsorship,
  };
}
