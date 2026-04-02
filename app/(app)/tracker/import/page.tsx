import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { ImportTracker } from "@/components/tracker/import-tracker";
import { requireMember } from "@/lib/auth/viewer";
import { listTrackerItems } from "@/lib/tracker/queries";
import { recordKey } from "@/lib/tracker/record";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  await requireMember();
  // What's already tracked, so the preview can mark re-imported rows.
  const existingKeys = (await listTrackerItems()).map(recordKey);
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
        <PageHeader title="Import applications" />
        <p className="mt-1 text-sm text-muted-foreground">
          Bring in an existing tracker. Nothing is saved until you check the
          preview.
        </p>
      </div>
      <ImportTracker existingKeys={existingKeys} />
    </div>
  );
}
