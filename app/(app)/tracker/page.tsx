import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Tracker" };

export default async function TrackerPage() {
  await requireMember();
  return (
    <>
      <PageHeader title="Tracker" />
      <EmptyState icon={ClipboardList} title="The logbook is empty.">
        Applications you mark as applied are tracked here, from submitted to
        offer.
      </EmptyState>
    </>
  );
}
