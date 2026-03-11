/**
 * Onboarding routing (Spec "Sign-up + onboarding"). `profiles.onboarding_step`
 * is the step the user is on; each step built so far has a page. A user whose
 * step is past every built page is done and can use the app. When a later
 * milestone adds step 3, users with onboarding_step = 3 are routed into it
 * automatically.
 */

export const STEP = { invite: 1, basics: 2 } as const;

export const ONBOARDING_PATHS = {
  [STEP.invite]: "/onboarding/invite",
  [STEP.basics]: "/onboarding/basics",
} as const satisfies Record<number, string>;

export type OnboardingState = {
  invitedAt: string | null;
  onboardingStep: number;
};

/** Where this user must go next, or null when they may use the app. */
export function pendingOnboardingPath({
  invitedAt,
  onboardingStep,
}: OnboardingState): string | null {
  if (!invitedAt) return ONBOARDING_PATHS[STEP.invite];
  // Redeeming the invite is step 1, so an invited user is on step 2 at least.
  const step = Math.max(onboardingStep, STEP.basics);
  return (ONBOARDING_PATHS as Record<number, string>)[step] ?? null;
}
