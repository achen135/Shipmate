import { ExternalLink, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/viewer";
import { formatRelative, formatShortDate } from "@/lib/format/time";
import { getPostingDetail } from "@/lib/inbox/queries";

import { PostingActions } from "./posting-actions";

export const metadata: Metadata = { title: "Posting" };

const SPONSORSHIP: Record<string, string | null> = {
  unknown: null,
  offers: "Offers visa sponsorship",
  no_sponsorship: "Does not offer visa sponsorship",
  citizens_only: "U.S. citizenship required",
};

async function loadPosting(id: string) {
  const detail = await getPostingDetail(id);
  return { detail, now: Date.now() };
}

export default async function PostingPage({
  params,
}: PageProps<"/postings/[id]">) {
  await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { detail, now } = await loadPosting(id);
  if (!detail) notFound();

  const { posting, item } = detail;
  const posted = posting.posted_at ?? posting.first_seen_at;
  const sponsorship = SPONSORSHIP[posting.sponsorship] ?? null;

  const facts: [string, string][] = [
    ["Location", posting.locations.join(" · ") || "Not listed"],
    ["Term", posting.terms.join(", ") || "Not listed (matches any term)"],
    ...(posting.category
      ? [["Category", posting.category] as [string, string]]
      : []),
    ...(posting.degrees.length > 0
      ? [["Degrees", posting.degrees.join(", ")] as [string, string]]
      : []),
    ...(sponsorship ? [["Sponsorship", sponsorship] as [string, string]] : []),
    ["Posted", `${formatShortDate(posted)} (${formatRelative(posted, now)})`],
    ["Source", posting.source_names.join(", ") || "Unknown"],
  ];

  return (
    <article className="flex flex-col gap-6">
      {posting.status === "closed" && (
        <p
          role="alert"
          className="flex gap-2 rounded-lg bg-warning/20 p-3 text-sm text-warning-foreground dark:text-foreground"
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          This posting looks closed: its source took it down. The link may still
          work for a little while.
        </p>
      )}

      <header>
        <p className="text-sm font-medium text-muted-foreground">
          {posting.company?.name ?? "Unknown company"}
        </p>
        <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-balance">
          {posting.title}
        </h1>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3">
        <Button asChild size="lg" className="self-start">
          <a href={posting.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" />
            Apply on the company site
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          Opens in a new tab. Shipmate never submits anything for you.
        </p>
      </div>

      <PostingActions
        postingId={posting.id}
        item={
          item && {
            id: item.id,
            status: item.status,
            skipReason: item.skip_reason,
            unseen: item.seen_at === null,
          }
        }
      />
    </article>
  );
}
