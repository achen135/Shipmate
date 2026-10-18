import { ListChecks, Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { PostingCard } from "@/components/postings/posting-card";
import { TailorAll } from "@/components/postings/tailor-all";
import { requireMember } from "@/lib/auth/viewer";
import { toCardData } from "@/lib/inbox/card";
import { postedAt } from "@/lib/inbox/group";
import { listUserPostings } from "@/lib/inbox/queries";
import { getTailorAllPlan } from "@/lib/tailor/mass-queries";

export const metadata: Metadata = { title: "To Apply" };

async function loadSaved() {
  const items = await listUserPostings("saved");
  // Oldest first: the longer a posting has been up, the sooner it may close.
  items.sort((a, b) => postedAt(a).localeCompare(postedAt(b)));
  const open = items.filter((i) => i.posting.status === "open");
  return {
    open,
    closed: items.filter((i) => i.posting.status === "closed"),
    // AI mode only: what "Tailor all" would do with the open ones.
    plan:
      open.length > 0 ? await getTailorAllPlan(open.map((i) => i.id)) : null,
    now: Date.now(),
  };
}

export default async function ToApplyPage() {
  await requireMember();
  const { open, closed, plan, now } = await loadSaved();

  if (open.length === 0 && closed.length === 0) {
    return (
      <>
        <PageHeader title="To Apply" />
        <EmptyState icon={Send} title="Nothing on deck.">
          Postings you save from the Inbox wait here until you apply.
        </EmptyState>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader title="To Apply" />
        <p className="mt-1 text-sm text-muted-foreground">
          Oldest postings first: they&apos;re the likeliest to close.
        </p>
      </div>
      {plan && <TailorAll {...plan} />}
      {open.some((i) => i.tailorings[0]?.state === "done") && (
        <Link
          href="/to-apply/review"
          data-testid="fast-review-link"
          className="flex items-center gap-2 text-sm underline underline-offset-4"
        >
          <ListChecks aria-hidden="true" className="size-4" />
          Review tailored results quickly
        </Link>
      )}
      {open.length > 0 && (
        <ul aria-label="Open" className="flex flex-col gap-3">
          {open.map((item) => (
            <li key={item.id}>
              <PostingCard data={toCardData(item, now)} mode="to-apply" />
            </li>
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <section
          aria-labelledby="closed-heading"
          className="flex flex-col gap-3"
        >
          <h2
            id="closed-heading"
            className="text-sm font-medium text-muted-foreground"
          >
            Closed
          </h2>
          <p className="text-sm text-muted-foreground">
            These were taken down by their source. The link may still work for a
            little while.
          </p>
          <ul className="flex flex-col gap-3">
            {closed.map((item) => (
              <li key={item.id}>
                <PostingCard data={toCardData(item, now)} mode="to-apply" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
