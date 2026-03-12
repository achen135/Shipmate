// @vitest-environment node
import { describe, expect, it } from "vitest";

import { pendingOnboardingPath } from "./onboarding";

const INVITED = "2026-10-09T00:00:00Z";

describe("pendingOnboardingPath", () => {
  it("sends anyone without an invite to the invite step, whatever their step", () => {
    expect(pendingOnboardingPath({ invitedAt: null, onboardingStep: 1 })).toBe(
      "/onboarding/invite",
    );
    expect(pendingOnboardingPath({ invitedAt: null, onboardingStep: 3 })).toBe(
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

  it("lets users past the last built step into the app", () => {
    expect(
      pendingOnboardingPath({ invitedAt: INVITED, onboardingStep: 3 }),
    ).toBeNull();
  });
});
