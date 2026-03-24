// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  displayStepNumber,
  nextBuiltStep,
  pendingOnboardingPath,
} from "./onboarding";

const INVITED = "2026-10-09T00:00:00Z";

describe("pendingOnboardingPath", () => {
  it("sends anyone without an invite to the invite step, whatever their step", () => {
    expect(pendingOnboardingPath({ invitedAt: null, onboardingStep: 1 })).toBe(
      "/onboarding/invite",
    );
    expect(pendingOnboardingPath({ invitedAt: null, onboardingStep: 6 })).toBe(
      "/onboarding/invite",
    );
  });

  it("sends invited users to Basics until they finish it", () => {
    expect(
      pendingOnboardingPath({ invitedAt: INVITED, onboardingStep: 1 }),
    ).toBe("/onboarding/basics");
    expect(
      pendingOnboardingPath({ invitedAt: INVITED, onboardingStep: 2 }),
    ).toBe("/onboarding/basics");
  });

  it("skips unbuilt steps 3-4 to 'What to watch'", () => {
    // Users who finished Basics before M2 are on step 3.
    for (const step of [3, 4, 5]) {
      expect(
        pendingOnboardingPath({ invitedAt: INVITED, onboardingStep: step }),
      ).toBe("/onboarding/watch");
    }
  });

  it("lets users past the last built step into the app", () => {
    expect(
      pendingOnboardingPath({ invitedAt: INVITED, onboardingStep: 6 }),
    ).toBeNull();
  });
});

describe("step numbers", () => {
  it("finds the next built step", () => {
    expect(nextBuiltStep(3)).toBe(5);
    expect(nextBuiltStep(6)).toBeNull();
  });

  it("shows built steps as 1, 2, 3", () => {
    expect(displayStepNumber(1)).toBe(1);
    expect(displayStepNumber(2)).toBe(2);
    expect(displayStepNumber(5)).toBe(3);
  });
});
