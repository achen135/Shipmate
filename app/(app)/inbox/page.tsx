import { Anchor, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { PostingCard } from "@/components/postings/posting-card";
import { requireMember } from "@/lib/auth/viewer";
import { toCardData } from "@/lib/inbox/card";
import { groupByDay } from "@/lib/inbox/group";
import { LIST_LIMIT, listUserPostings } from "@/lib/inbox/queries";

export const metadata: Metadata = { title: "Inbox" };

async function loadInbox() {
  const items = await listUserPostings("new");
  return { items, now: Date.now() };
}

export default async function InboxPage() {
  await requireMember();
  const { items, now } = await loadInbox();

  if (items.length === 0) {
    return (
      <>
        <PageHeader title="Inbox" />
        <EmptyState icon={Anchor} title="Calm seas.">
          Nothing new right now. Shipmate checks every 30 minutes and new
          matches land here. Change what you&apos;re watching in{" "}
          <Link href="/profile" className="underline underline-offset-4">
            Profile
          </Link>
          .
        </EmptyState>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader title="Inbox" />
        <p className="mt-1 text-sm text-muted-foreground">
          {items.length === LIST_LIMIT
            ? `Showing the newest ${LIST_LIMIT}. Save or skip to see more.`
            : `${items.length} new posting${items.length === 1 ? "" : "s"}. Save the ones worth applying to.`}
        </p>
      </div>
      {items.some((i) => i.tailorings[0]?.state === "done") && (
        <Link
          href="/to-apply/review"
          data-testid="fast-review-link"
          className="flex items-center gap-2 text-sm underline underline-offset-4"
        >
          <ListChecks aria-hidden="true" className="size-4" />
          Review tailored results quickly
        </Link>
      )}
      {groupByDay(items, now).map((group) => (
        <section
          key={group.key}
          aria-labelledby={`day-${group.key}`}
          className="flex flex-col gap-3"
        >
          <h2
            id={`day-${group.key}`}
            className="text-sm font-medium text-muted-foreground"
          >
            {group.label}
          </h2>
          <ul className="flex flex-col gap-3">
            {group.items.map((item) => (
              <li key={item.id}>
                <PostingCard data={toCardData(item, now)} mode="inbox" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
