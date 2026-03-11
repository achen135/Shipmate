import { redirect } from "next/navigation";

import { HOME_PATH } from "@/lib/auth/routes";
import { requireSignedIn } from "@/lib/auth/viewer";
import { pendingOnboardingPath } from "@/lib/onboarding";

/** `/onboarding` → whichever step this user is on (or the app if done). */
export default async function OnboardingIndex() {
  const viewer = await requireSignedIn();
  redirect(pendingOnboardingPath(viewer) ?? HOME_PATH);
}
