import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { PrivacyNote } from "@/components/auth/privacy-note";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { BasicsForm } from "@/components/profile/basics-form";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/viewer";
import { basicsFromProfile, gradYearOptions } from "@/lib/schemas/basics";

import { updateBasics } from "./actions";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const viewer = await requireMember();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Profile" />

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
            <Button asChild variant="outline">
              <Link href="/admin/invites">
                <ShieldCheck aria-hidden="true" />
                Manage invites
              </Link>
            </Button>
          )}
          <SignOutButton />
        </div>
        <PrivacyNote />
      </section>
    </div>
  );
}
