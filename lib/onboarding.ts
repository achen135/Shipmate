/**
 * Onboarding routing (Spec "Sign-up + onboarding"). `profiles.onboarding_step`
 * is the step the user is on, in Spec numbering. Only some steps are built
 * so far; a user goes to the first built step at or after theirs, and a user
 * past every built step is done and can use the app.
 *
 * Built: 1 invite, 2 basics, 5 what to watch. Steps 3-4 (resume + mode, fact
 * bank) come in M5/M6 and slot in by adding their paths here: users still on
 * step ≤ 4 will be routed into them first.
 */

export const STEP = { invite: 1, basics: 2, watch: 5 } as const;

export const ONBOARDING_PATHS = {
  [STEP.invite]: "/onboarding/invite",
  [STEP.basics]: "/onboarding/basics",
  [STEP.watch]: "/onboarding/watch",
} as const satisfies Record<number, string>;

const BUILT_STEPS = Object.keys(ONBOARDING_PATHS)
  .map(Number)
  .sort((a, b) => a - b);

export type OnboardingState = {
  invitedAt: string | null;
  onboardingStep: number;
};

/** The first built step at or after `step`, or null when there is none. */
export function nextBuiltStep(step: number): number | null {
  return BUILT_STEPS.find((built) => built >= step) ?? null;
}

/** "Step N" as the user sees it: position among the built steps. */
export function displayStepNumber(step: number): number {
  return BUILT_STEPS.indexOf(step) + 1;
}

/** Where this user must go next, or null when they may use the app. */
export function pendingOnboardingPath({
  invitedAt,
  onboardingStep,
}: OnboardingState): string | null {
  if (!invitedAt) return ONBOARDING_PATHS[STEP.invite];
  // Redeeming the invite is step 1, so an invited user is on step 2 at least.
  const step = nextBuiltStep(Math.max(onboardingStep, STEP.basics));
  return step === null
    ? null
    : (ONBOARDING_PATHS as Record<number, string>)[step];
}
