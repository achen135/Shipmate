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

  it("sends users who finished Basics to the resume step", () => {
    expect(
      pendingOnboardingPath({ invitedAt: INVITED, onboardingStep: 3 }),
    ).toBe("/onboarding/resume");
  });

  it("only AI-mode users get the fact-bank step", () => {
    expect(
      pendingOnboardingPath({
        invitedAt: INVITED,
        onboardingStep: 4,
        mode: "ai",
      }),
    ).toBe("/onboarding/facts");
    for (const mode of [undefined, "simple"]) {
      expect(
        pendingOnboardingPath({ invitedAt: INVITED, onboardingStep: 4, mode }),
      ).toBe("/onboarding/watch");
    }
  });

  it("then 'What to watch'", () => {
    expect(
      pendingOnboardingPath({ invitedAt: INVITED, onboardingStep: 5 }),
    ).toBe("/onboarding/watch");
  });

  it("lets users past the last built step into the app", () => {
    expect(
      pendingOnboardingPath({ invitedAt: INVITED, onboardingStep: 6 }),
    ).toBeNull();
  });
});

describe("step numbers", () => {
  it("finds the next step this user takes", () => {
    expect(nextBuiltStep(3)).toBe(3);
    expect(nextBuiltStep(4)).toBe(5);
    expect(nextBuiltStep(4, "ai")).toBe(4);
    expect(nextBuiltStep(6)).toBeNull();
  });

  it("numbers the steps the user actually sees", () => {
    expect(displayStepNumber(1)).toBe(1);
    expect(displayStepNumber(2)).toBe(2);
    expect(displayStepNumber(3)).toBe(3);
    expect(displayStepNumber(5)).toBe(4);
    expect(displayStepNumber(4, "ai")).toBe(4);
    expect(displayStepNumber(5, "ai")).toBe(5);
  });
});
