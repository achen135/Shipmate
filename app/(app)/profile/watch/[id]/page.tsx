import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PageHeader } from "@/components/app/page-header";
import { WatchProfileForm } from "@/components/watch/watch-profile-form";
import { requireMember } from "@/lib/auth/viewer";
import { formFromRow } from "@/lib/schemas/watch-profile";
import { createClient } from "@/lib/supabase/server";
import { WATCH_PROFILE_COLUMNS } from "@/lib/watch/profiles";

import { editWatchProfile, removeWatchProfile } from "../actions";
import { DeleteWatchProfileButton } from "./delete-button";

export const metadata: Metadata = { title: "Edit search" };

export default async function EditWatchProfilePage({
  params,
}: PageProps<"/profile/watch/[id]">) {
  await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("watch_profiles")
    .select(WATCH_PROFILE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`watch profile: ${error.message}`);
  if (!profile) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Edit search" />
      <WatchProfileForm
        defaultValues={formFromRow(profile)}
        action={editWatchProfile.bind(null, profile.id)}
        submitLabel="Save"
        successMessage={(added) =>
          added > 0
            ? `Saved. ${added} more from the past week in your Inbox.`
            : "Saved."
        }
      />
      <DeleteWatchProfileButton
        action={removeWatchProfile.bind(null, profile.id)}
      />
    </div>
  );
}
