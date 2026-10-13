import { Activity, ChevronRight, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { PrivacyNote } from "@/components/auth/privacy-note";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { BasicsForm } from "@/components/profile/basics-form";
import { WatchProfileList } from "@/components/watch/watch-profile-list";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/viewer";
import { getResume } from "@/lib/resume/queries";
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
  const { count: followedCount, error: followsError } = await supabase
    .from("follows")
    .select("company_id", { count: "exact", head: true });
  if (followsError) throw new Error(`follows: ${followsError.message}`);
  const hasResume = (await getResume()) !== null;
  const { count: deviceCount, error: devicesError } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true });
  if (devicesError) throw new Error(`devices: ${devicesError.message}`);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Profile" />

      <section aria-labelledby="watch-heading" className="flex flex-col gap-4">
        <h2 id="watch-heading" className="text-lg font-medium">
          What you&apos;re watching
        </h2>
        <WatchProfileList profiles={watchProfiles} />
      </section>

      <section
        aria-labelledby="application-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="application-heading" className="text-lg font-medium">
          Applying
        </h2>
        <Link
          href="/profile/application"
          className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/50"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">Resume and answers</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasResume
                ? "Your resume PDF, links, and standard answers."
                : "Upload your resume PDF and set the answers applications ask for."}
            </p>
          </div>
          <ChevronRight
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
        </Link>
      </section>

      <section
        aria-labelledby="notifications-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="notifications-heading" className="text-lg font-medium">
          Notifications
        </h2>
        <Link
          href="/profile/notifications"
          className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/50"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">Push and email</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {deviceCount
                ? `${deviceCount} ${deviceCount === 1 ? "device" : "devices"} on.`
                : "Get told when new matches arrive."}
            </p>
          </div>
          <ChevronRight
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
        </Link>
      </section>

      <section
        aria-labelledby="companies-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="companies-heading" className="text-lg font-medium">
          Companies
        </h2>
        <Link
          href="/profile/companies"
          className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/50"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">Followed companies</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {!followedCount
                ? "Watch a company's own careers page."
                : `${followedCount} followed`}
            </p>
          </div>
          <ChevronRight
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
        </Link>
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
