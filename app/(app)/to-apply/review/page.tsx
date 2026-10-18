import { Anchor } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { FastReview } from "@/components/review/fast-review";
import { requireMember } from "@/lib/auth/viewer";
import { QUEUE_LIMIT, listReviewQueue } from "@/lib/tailor/review-queue";

export const metadata: Metadata = { title: "Review tailored" };

/**
 * M9 §2: the fast-review queue. A quicker way to look at results that
 * already went through the tailoring pipeline; the posting's own page stays
 * the full review.
 */
export default async function FastReviewPage() {
  await requireMember();
  const items = await listReviewQueue();

  if (items.length === 0) {
    return (
      <>
        <PageHeader title="Review tailored" />
        <EmptyState icon={Anchor} title="Calm seas.">
          Nothing tailored is waiting for a look. Press Tailor all on{" "}
          <Link href="/to-apply" className="underline underline-offset-4">
            To Apply
          </Link>{" "}
          and the results line up here.
        </EmptyState>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader title="Review tailored" />
        <p className="mt-1 text-sm text-muted-foreground">
          Newest first
          {items.length === QUEUE_LIMIT ? ` (the latest ${QUEUE_LIMIT})` : ""}.
          For the whole result, or to edit the resume, open the posting.{" "}
          <Link href="/to-apply" className="underline underline-offset-4">
            Back to To Apply
          </Link>
        </p>
      </div>
      <FastReview items={items} />
    </div>
  );
}
