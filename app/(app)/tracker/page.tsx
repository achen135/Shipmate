import { ClipboardList, Download, Plus, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { TrackerView } from "@/components/tracker/tracker-view";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/viewer";
import { listTrackerItems } from "@/lib/tracker/queries";

export const metadata: Metadata = { title: "Tracker" };

async function loadTracker() {
  const items = await listTrackerItems();
  return { items, now: Date.now() };
}

export default async function TrackerPage() {
  await requireMember();
  const { items, now } = await loadTracker();

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm">
        <Link href="/tracker/new">
          <Plus aria-hidden="true" />
          Add
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href="/tracker/import">
          <Upload aria-hidden="true" />
          Import
        </Link>
      </Button>
      {items.length > 0 && (
        <Button asChild size="sm" variant="outline">
          {/* A file download, not a page: plain <a>, no prefetch. */}
          <a href="/api/tracker/export" download>
            <Download aria-hidden="true" />
            Export CSV
          </a>
        </Button>
      )}
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader title="Tracker" />
          {actions}
        </div>
        <EmptyState icon={ClipboardList} title="The logbook is empty.">
          Mark a saved posting as applied, add one by link, or import your old
          tracker.
        </EmptyState>
      </div>
    );
  }

  return (
    // Wider than the other tabs on desktop, for the table.
    <div className="flex flex-col gap-5 lg:relative lg:left-1/2 lg:w-[min(72rem,calc(100vw-4rem))] lg:-translate-x-1/2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="Tracker" />
        {actions}
      </div>
      <TrackerView items={items} now={now} />
    </div>
  );
}
