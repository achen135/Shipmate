import { Send } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "To Apply" };

export default async function ToApplyPage() {
  await requireMember();
  return (
    <>
      <PageHeader title="To Apply" />
      <EmptyState icon={Send} title="Nothing on deck.">
        Postings you save from the Inbox wait here until you apply.
      </EmptyState>
    </>
  );
}
