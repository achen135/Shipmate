import { Activity, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { PrivacyNote } from "@/components/auth/privacy-note";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { BasicsForm } from "@/components/profile/basics-form";
import { WatchProfileList } from "@/components/watch/watch-profile-list";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/viewer";
import { basicsFromProfile, gradYearOptions } from "@/lib/schemas/basics";
import { createClient } from "@/lib/supabase/server";
import { WATCH_PROFILE_COLUMNS } from "@/lib/watch/profiles";

import { updateBasics } from "./actions";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const viewer = await requireMember();
  const supabase = await createClient();
  const { data: watchProfiles, error } = await supabase
    .from("watch_profiles")
    .select(WATCH_PROFILE_COLUMNS)
    .order("created_at");
  if (error) throw new Error(`watch profiles: ${error.message}`);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Profile" />

      <section aria-labelledby="watch-heading" className="flex flex-col gap-4">
        <h2 id="watch-heading" className="text-lg font-medium">
          What you&apos;re watching
        </h2>
        <WatchProfileList profiles={watchProfiles} />
      </section>

      <section aria-labelledby="basics-heading" className="flex flex-col gap-4">
        <h2 id="basics-heading" className="text-lg font-medium">
          Basics
        </h2>
        <BasicsForm
          defaultValues={basicsFromProfile(viewer.profile)}
          gradYears={gradYearOptions(
            new Date().getFullYear(),
            viewer.profile?.grad_year,
          )}
          action={updateBasics}
          submitLabel="Save"
          successMessage="Saved."
        />
      </section>

      <section
        aria-labelledby="account-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="account-heading" className="text-lg font-medium">
          Account
        </h2>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="text-foreground">{viewer.email}</span>
        </p>
        <div className="flex flex-wrap gap-3">
          {viewer.isAdmin && (
            <>
              <Button asChild variant="outline">
                <Link href="/admin/invites">
                  <ShieldCheck aria-hidden="true" />
                  Manage invites
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/sources">
                  <Activity aria-hidden="true" />
                  Source health
                </Link>
              </Button>
            </>
          )}
          <SignOutButton />
        </div>
        <PrivacyNote />
      </section>
    </div>
  );
}
