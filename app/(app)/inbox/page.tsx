import { Anchor } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  await requireMember();
  return (
    <>
      <PageHeader title="Inbox" />
      <EmptyState icon={Anchor} title="Calm seas.">
        No new postings yet. Once you choose what to watch, new matches land
        here.
      </EmptyState>
    </>
  );
}
