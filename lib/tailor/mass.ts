/**
 * "Tailor all" on To Apply (M9 §1): what it will do, and what it did, in
 * plain words. Pure, so the wording is tested; the database decides the
 * real schedule (tailor_all(), supabase/migrations/…_mass_apply.sql) and
 * the result shown after is its answer, not this estimate.
 */

/** What the database's tailor_all() returns. */
export type TailorAllResult = {
  queuedToday: number;
  queuedLater: number;
  /** The last day a queued one runs (YYYY-MM-DD, Eastern), if any later. */
  lastDay: string | null;
  /** Saved postings skipped: already tailored, or being tailored. */
  already: number;
  dailyCap: number;
};

/**
 * The tailoring day a moment falls on (Eastern, like the daily cap and
 * tailoring_today() in the database): YYYY-MM-DD.
 */
export function tailoringDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(ms);
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "Tue, Oct 20" for a YYYY-MM-DD tailoring day. */
export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

/**
 * Before: how many can start today under the cap, and roughly how many days
 * the rest take (later days may already hold some from an earlier "Tailor
 * all"; the result after says exactly).
 */
export function planText(plan: {
  eligible: number;
  remainingToday: number;
  dailyCap: number;
}): string {
  const { eligible, remainingToday, dailyCap } = plan;
  if (eligible === 0) {
    return "Everything here is already tailored or being tailored.";
  }
  const today = Math.min(eligible, Math.max(0, remainingToday));
  const later = eligible - today;
  if (later === 0) {
    return `Tailors ${eligible === 1 ? "it" : `all ${eligible}`} today.`;
  }
  const days = Math.ceil(later / Math.max(1, dailyCap));
  const start =
    today > 0
      ? `Tailors ${today} today; the other ${later}`
      : `Today's cap is used up; all ${later}`;
  return `${start} wait for the next ${days === 1 ? "day" : `${days} days`} (your daily cap is ${dailyCap}).`;
}

/** After: what the database queued, and when. */
export function resultText(result: TailorAllResult): string {
  const { queuedToday, queuedLater, lastDay, already, dailyCap } = result;
  if (queuedToday + queuedLater === 0) {
    return already > 0
      ? "Nothing new to tailor: everything here is already tailored or being tailored."
      : "Nothing to tailor: there are no open postings in To Apply.";
  }
  const parts: string[] = [];
  if (queuedToday > 0) parts.push(`Tailoring ${queuedToday} now.`);
  if (queuedLater > 0 && lastDay) {
    parts.push(
      `${plural(queuedLater, "more is", "more are")} queued for later days, the last on ${dayLabel(lastDay)}, because your daily cap is ${dailyCap}.`,
    );
  }
  if (already > 0) {
    parts.push(
      `${plural(already, "posting was", "postings were")} already tailored or being tailored.`,
    );
  }
  return parts.join(" ");
}
