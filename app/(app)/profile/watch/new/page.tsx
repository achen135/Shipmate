import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { WatchProfileForm } from "@/components/watch/watch-profile-form";
import { requireMember } from "@/lib/auth/viewer";
import { formFromPreset } from "@/lib/schemas/watch-profile";

import { addWatchProfile } from "../actions";

export const metadata: Metadata = { title: "New search" };

export default async function NewWatchProfilePage() {
  const viewer = await requireMember();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New search" />
      <WatchProfileForm
        defaultValues={formFromPreset(
          "custom",
          viewer.profile?.needs_sponsorship ?? false,
        )}
        action={addWatchProfile}
        submitLabel="Save search"
      />
    </div>
  );
}
