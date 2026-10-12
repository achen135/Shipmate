import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { AddApplication } from "@/components/tracker/add-application";
import { requireMember } from "@/lib/auth/viewer";
import { dayKey } from "@/lib/format/time";

export const metadata: Metadata = { title: "Add an application" };

async function today() {
  return dayKey(Date.now());
}

export default async function AddApplicationPage() {
  await requireMember();
  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/tracker"
        className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Tracker
      </Link>
      <div>
        <PageHeader title="Add an application" />
        <p className="mt-1 text-sm text-muted-foreground">
          For jobs you found outside Shipmate. Paste the link and Shipmate fills
          in what it can.
        </p>
      </div>
      <AddApplication today={await today()} />
    </div>
  );
}
