import type { AnswerProfile } from "./prefill";

/**
 * A profiles row (the columns the answer sheet uses) → AnswerProfile. The
 * review page and the extension's fill both build the sheet from this, so
 * they prefill the same answers.
 */
export type ProfileForAnswers = {
  name: string | null;
  email: string | null;
  phone: string | null;
  school: string | null;
  degree: string | null;
  major: string | null;
  grad_month: number | null;
  grad_year: number | null;
  work_authorized: boolean | null;
  needs_sponsorship: boolean | null;
  standard_answers: unknown;
};

export function toAnswerProfile(
  profile: ProfileForAnswers | null | undefined,
  email: string | null,
): AnswerProfile {
  const answers =
    profile?.standard_answers &&
    typeof profile.standard_answers === "object" &&
    !Array.isArray(profile.standard_answers)
      ? (profile.standard_answers as AnswerProfile["answers"])
      : {};
  return {
    name: profile?.name ?? null,
    email: profile?.email ?? email,
    phone: profile?.phone ?? null,
    school: profile?.school ?? null,
    degree: profile?.degree ?? null,
    major: profile?.major ?? null,
    gradMonth: profile?.grad_month ?? null,
    gradYear: profile?.grad_year ?? null,
    workAuthorized: profile?.work_authorized ?? null,
    needsSponsorship: profile?.needs_sponsorship ?? null,
    answers,
  };
}
