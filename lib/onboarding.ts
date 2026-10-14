/**
 * Onboarding routing (Spec "Sign-up + onboarding"). `profiles.onboarding_step`
 * is the step the user is on, in Spec numbering. Only some steps are built
 * so far; a user goes to the first built step at or after theirs, and a user
 * past every built step is done and can use the app.
 *
 * Built: 1 invite, 2 basics, 3 resume + mode, 4 fact bank (AI mode only:
 * Simple-mode users skip it), 5 what to watch. Steps 6-8 aren't built as
 * steps (their settings live in Profile).
 */

export const STEP = {
  invite: 1,
  basics: 2,
  resume: 3,
  facts: 4,
  watch: 5,
} as const;

export const ONBOARDING_PATHS = {
  [STEP.invite]: "/onboarding/invite",
  [STEP.basics]: "/onboarding/basics",
  [STEP.resume]: "/onboarding/resume",
  [STEP.facts]: "/onboarding/facts",
  [STEP.watch]: "/onboarding/watch",
} as const satisfies Record<number, string>;

const BUILT_STEPS = Object.keys(ONBOARDING_PATHS)
  .map(Number)
  .sort((a, b) => a - b);

export type OnboardingState = {
  invitedAt: string | null;
  onboardingStep: number;
  /** profiles.mode; the fact-bank step is only for AI mode. */
  mode?: string;
};

/** Steps this user goes through: the fact bank only in AI mode. */
function stepsFor(mode: string | undefined): number[] {
  return BUILT_STEPS.filter((step) => step !== STEP.facts || mode === "ai");
}

/** The first step at or after `step` this user takes, or null when there is none. */
export function nextBuiltStep(step: number, mode?: string): number | null {
  return stepsFor(mode).find((built) => built >= step) ?? null;
}

/** "Step N" as the user sees it: position among the steps they take. */
export function displayStepNumber(step: number, mode?: string): number {
  return stepsFor(mode).indexOf(step) + 1;
}

/** Where this user must go next, or null when they may use the app. */
export function pendingOnboardingPath({
  invitedAt,
  onboardingStep,
  mode,
}: OnboardingState): string | null {
  if (!invitedAt) return ONBOARDING_PATHS[STEP.invite];
  // Redeeming the invite is step 1, so an invited user is on step 2 at least.
  const step = nextBuiltStep(Math.max(onboardingStep, STEP.basics), mode);
  return step === null
    ? null
    : (ONBOARDING_PATHS as Record<number, string>)[step];
}
