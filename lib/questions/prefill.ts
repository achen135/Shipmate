import { DEGREES, MONTHS } from "@/lib/schemas/basics";

import type { Classified, DemographicTopic } from "./classify";

/**
 * What the profile says for a standard question (the answer sheet's "copy"
 * buttons). Nothing here invents anything: a field the user hasn't filled in
 * comes back as null, and the sheet says where to add it.
 */

export type AnswerProfile = {
  name: string | null;
  email: string | null;
  phone: string | null;
  school: string | null;
  degree: string | null;
  major: string | null;
  gradMonth: number | null;
  gradYear: number | null;
  workAuthorized: boolean | null;
  needsSponsorship: boolean | null;
  answers: StandardAnswers;
};

/** profiles.standard_answers (lib/schemas/standard-answers.ts). */
export type StandardAnswers = {
  linkedin?: string;
  github?: string;
  portfolio?: string;
  howHeard?: string;
  demographics?: Partial<Record<DemographicTopic, string>>;
};

export const DEFAULT_HOW_HEARD = "Online job board";
export const DECLINE = "Decline to answer";

export type Prefill = {
  /** What to type or paste, or null if the profile doesn't have it. */
  value: string | null;
  /** Shown under the value: where it came from, or what to add. */
  note?: string;
};

const DECLINE_OPTION =
  /decline|don'?t wish|do not wish|prefer not|not to (answer|say|disclose)|choose not/i;

/** The form's own wording for yes / no / decline, when it lists options. */
function pickOption(options: string[], wanted: "yes" | "no" | "decline") {
  if (options.length === 0) {
    return wanted === "decline" ? DECLINE : wanted === "yes" ? "Yes" : "No";
  }
  const found =
    wanted === "decline"
      ? options.find((o) => DECLINE_OPTION.test(o))
      : options.find((o) => new RegExp(`^${wanted}\\b`, "i").test(o.trim()));
  return (
    found ?? (wanted === "decline" ? DECLINE : wanted === "yes" ? "Yes" : "No")
  );
}

function splitName(name: string | null): { first: string; last: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function required(value: string | null | undefined, add: string): Prefill {
  const text = value?.trim();
  return text ? { value: text } : { value: null, note: add };
}

export function prefillAnswer(
  question: Classified,
  profile: AnswerProfile,
): Prefill | null {
  const { options } = question;
  switch (question.field) {
    case "first_name":
      return required(
        splitName(profile.name).first,
        "Add your name in Profile.",
      );
    case "last_name":
      return required(
        splitName(profile.name).last,
        "Add your full name in Profile.",
      );
    case "full_name":
      return required(profile.name, "Add your name in Profile.");
    case "preferred_name":
      return required(
        splitName(profile.name).first,
        "Add your name in Profile.",
      );
    case "email":
      return required(profile.email, "No email on your account.");
    case "phone":
      return required(profile.phone, "Add your phone number in Profile.");
    case "linkedin":
      return required(
        profile.answers.linkedin,
        "Add your LinkedIn in Profile.",
      );
    case "github":
      return required(profile.answers.github, "Add your GitHub in Profile.");
    case "portfolio":
      return required(
        profile.answers.portfolio,
        "Add your website or portfolio in Profile.",
      );
    case "links": {
      const links = [
        profile.answers.linkedin,
        profile.answers.github,
        profile.answers.portfolio,
      ].filter((l): l is string => !!l?.trim());
      return required(links.join("\n"), "Add your links in Profile.");
    }
    case "work_authorization":
      return profile.workAuthorized === null
        ? { value: null, note: "Answer this in Profile → Basics." }
        : {
            value: pickOption(options, profile.workAuthorized ? "yes" : "no"),
            note: "From your Basics.",
          };
    case "sponsorship":
      return profile.needsSponsorship === null
        ? { value: null, note: "Answer this in Profile → Basics." }
        : {
            value: pickOption(options, profile.needsSponsorship ? "yes" : "no"),
            note: "From your Basics.",
          };
    case "how_heard":
      return { value: profile.answers.howHeard?.trim() || DEFAULT_HOW_HEARD };
    case "school":
      return required(profile.school, "Add your school in Profile.");
    case "degree": {
      const label = DEGREES.find((d) => d.value === profile.degree)?.label;
      return required(label, "Add your degree in Profile.");
    }
    case "major":
      return required(profile.major, "Add your major in Profile.");
    case "grad_date":
      return profile.gradMonth && profile.gradYear
        ? {
            value: `${MONTHS[profile.gradMonth - 1]} ${profile.gradYear}`,
          }
        : { value: null, note: "Add your graduation date in Profile." };
    case "resume":
      return { value: null, note: "Attach your uploaded resume PDF." };
    case "demographic": {
      const topic = question.topic;
      const saved = topic ? profile.answers.demographics?.[topic] : undefined;
      // Only ever the user's own choice, or declining.
      const value = saved?.trim() || pickOption(options, "decline");
      return { value, note: "Optional. Never required." };
    }
    default:
      return null;
  }
}
