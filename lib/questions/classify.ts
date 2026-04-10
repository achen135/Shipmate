import type { RawQuestion } from "./types";

/**
 * Sort a fetched question into what the answer sheet does with it
 * (CLAUDE.md "Question fetch"):
 *
 * - `antibot`: a puzzle meant to tell people from bots. Shipmate marks it
 *   "answer this yourself" and never attempts it (hard rule 4).
 * - `standard`: something the profile already answers (name, email, phone,
 *   links, work authorization, sponsorship, how-heard, school, graduation,
 *   resume, demographics); prefilled by prefill.ts.
 * - `written`: free text no profile field covers ("Why us?"). Flagged for the
 *   user's own answer; essay ideas are M7.
 * - `other`: a short question that is none of those (location, "are you 18?",
 *   cover letter upload). Listed, not prefilled.
 *
 * By label keywords only: no AI, so it costs nothing and runs anywhere.
 */

export type StandardField =
  | "first_name"
  | "last_name"
  | "full_name"
  | "preferred_name"
  | "email"
  | "phone"
  | "linkedin"
  | "github"
  | "portfolio"
  | "links"
  | "work_authorization"
  | "sponsorship"
  | "how_heard"
  | "school"
  | "degree"
  | "major"
  | "grad_date"
  | "resume"
  | "demographic";

export type DemographicTopic = "gender" | "race" | "veteran" | "disability";

export type QuestionKind = "standard" | "written" | "antibot" | "other";

export type Classified = RawQuestion & {
  kind: QuestionKind;
  field?: StandardField;
  /** Which EEO question, for `demographic`. */
  topic?: DemographicTopic;
};

const ANTI_BOT: RegExp[] = [
  /\bnot an? (ro)?bot\b/i,
  /\b(prove|confirm|verify)\b.{0,40}\b(human|not an? (ro)?bot)\b/i,
  /\bare you (a )?(human|robot|bot)\b/i,
  /\bcaptcha\b/i,
  /\bdecode\b/i,
  /\bencoded in\b/i,
  /\bbase-?64\b/i,
  /\b(figure out|find|solve|work out|crack)\b.{0,30}\b(secret|puzzle|riddle|cipher|code)\b/i,
  /\bwhat is \d+\s*[-+*/x×÷]\s*\d+/i,
  /\btype the (characters|letters|word|code)\b/i,
  /\b(ignore|disregard) (all |any )?(previous|prior|above) instructions\b/i,
];

/** The label plus the help text under it: some puzzles hide in the help. */
function antiBot(q: RawQuestion): boolean {
  const text = `${q.label} ${q.description ?? ""}`;
  return ANTI_BOT.some((re) => re.test(text));
}

function demographicTopic(label: string): DemographicTopic | null {
  if (/\b(gender|sex|transgender)\b/i.test(label)) return "gender";
  if (/\b(race|ethnic|hispanic|latino)/i.test(label)) return "race";
  if (/\bveteran/i.test(label)) return "veteran";
  if (/\bdisabilit/i.test(label)) return "disability";
  return null;
}

/** Strip the asterisks and spacing forms add; lowercase for matching. */
function plain(label: string): string {
  return label.toLowerCase().replace(/[*✱]/g, "").replace(/\s+/g, " ").trim();
}

function standardField(q: RawQuestion): StandardField | null {
  const label = plain(q.label);
  const long = label.length > (q.input === "textarea" ? 100 : 200);
  if (long) return null;

  if (q.input === "file") {
    return /\b(resume|cv|curriculum)\b/.test(label) ? "resume" : null;
  }

  // Name and contact. Longer, more specific patterns come first.
  if (/\b(preferred|nick|chosen)\s*(first\s*)?name\b/.test(label)) {
    return "preferred_name";
  }
  if (/\bfirst\s*name\b|\bgiven name\b/.test(label)) return "first_name";
  if (/\b(last|family|sur)\s*name\b/.test(label)) return "last_name";
  if (/^(your |my )?(full |legal )?name\b/.test(label) && label.length < 40) {
    return "full_name";
  }
  if (/\be-?mail\b/.test(label) && !/refer/.test(label)) return "email";
  if (/\b(phone|mobile|cell)\b/.test(label)) return "phone";

  // Links. A label naming several is one answer with all the user's links.
  const wants = [
    /linkedin/.test(label),
    /github/.test(label),
    /\b(website|portfolio|personal site|personal url|web ?site)\b/.test(label),
  ];
  if (wants.filter(Boolean).length >= 2) return "links";
  if (wants[0]) return "linkedin";
  if (wants[1]) return "github";
  if (wants[2]) return "portfolio";

  // Demographics (EEO): optional by law, never prefilled with anything but
  // "decline to answer".
  if (q.group === "demographic" || demographicTopic(label)) {
    return demographicTopic(label) ? "demographic" : null;
  }

  // "Are you based in the US and authorized to work…" is a location question
  // as much as an authorization one, so the profile can't answer it.
  const locational = /\b(based in|located in|reside|residing|currently live)\b/;
  if (
    /\b(authori[sz]ed|eligible|legally|right) to work\b|work authori[sz]ation|legal(ly)? (eligible|authori[sz]ed)\b/.test(
      label,
    ) &&
    !locational.test(label)
  ) {
    return "work_authorization";
  }
  if (/\bsponsor|\bvisa\b|\bh-?1b\b/.test(label)) return "sponsorship";

  if (
    /\bhow\b.{0,12}\b(did )?you\b.{0,12}\b(hear|find|learn)|\bwhere did you (hear|find|learn)|\bhear(d)? about (this|us|the)|\bhow did you come across\b/.test(
      label,
    )
  ) {
    return "how_heard";
  }

  if (
    /\b(graduat|expected completion|complete your degree|degree completion|completion date)/.test(
      label,
    )
  ) {
    return "grad_date";
  }
  if (/\b(university|college|school|institution)\b/.test(label)) {
    return "school";
  }
  if (/\b(major|field of study|discipline|concentration)\b/.test(label)) {
    return "major";
  }
  if (/\b(degree|level of education|highest education)\b/.test(label)) {
    return "degree";
  }
  return null;
}

/** A prompt that wants a paragraph, though the form gave it a one-line box. */
const ESSAY_PROMPT =
  /\bwhy (do you|are you|would you|us|this|\w+\?)|\btell us\b|\bdescribe\b|\bexplain\b|\bproudest\b|\bfavou?rite\b|\bwhat (excites|interests|motivates)\b|\bin (1|one)-?\d* (paragraph|sentence)/i;

export function classifyQuestion(q: RawQuestion): Classified {
  if (antiBot(q)) return { ...q, kind: "antibot" };

  const field = standardField(q);
  if (field) {
    const topic =
      field === "demographic" ? demographicTopic(plain(q.label)) : null;
    return {
      ...q,
      kind: "standard",
      field,
      ...(topic ? { topic } : {}),
    };
  }

  if (q.group === "demographic") return { ...q, kind: "other" };
  if (q.input === "textarea") return { ...q, kind: "written" };
  if (
    q.input === "text" &&
    (q.label.length >= 100 || ESSAY_PROMPT.test(q.label))
  ) {
    return { ...q, kind: "written" };
  }
  return { ...q, kind: "other" };
}

export function classifyQuestions(questions: RawQuestion[]): Classified[] {
  return questions.map(classifyQuestion);
}
