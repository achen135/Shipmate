import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { DeleteRowButton } from "@/components/tracker/delete-row-button";
import { StaleBadge, StatusBadge } from "@/components/tracker/status-badge";
import { TrackerRowForm } from "@/components/tracker/tracker-row-form";
import { requireMember } from "@/lib/auth/viewer";
import { formatCalendarDate, formatLongDate } from "@/lib/format/time";
import { isStale } from "@/lib/tracker/badge";
import { sameCompany } from "@/lib/tracker/item";
import { getTrackerDetail, listTrackerItems } from "@/lib/tracker/queries";
import { isTrackerStatus, statusLabel } from "@/lib/tracker/status";

export const metadata: Metadata = { title: "Application" };

async function loadApplication(id: string) {
  const [detail, all] = await Promise.all([
    getTrackerDetail(id),
    listTrackerItems(),
  ]);
  const others = detail
    ? all.filter(
        (o) => o.id !== id && sameCompany(o.company, detail.item.company),
      )
    : [];
  return { detail, others, now: Date.now() };
}

export default async function TrackerRowPage({
  params,
}: PageProps<"/tracker/[id]">) {
  await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { detail, others, now } = await loadApplication(id);
  if (!detail) notFound();

  const { item, manual, events } = detail;
  // Moved back out of the Tracker (e.g. Undo): show it where it lives now.
  if (!isTrackerStatus(item.status)) {
    redirect(item.postingId ? `/postings/${item.postingId}` : "/tracker");
  }

  return (
    <article className="flex flex-col gap-6">
      <Link
        href="/tracker"
        className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Tracker
      </Link>

      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          {item.company}
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">
          {item.role ?? item.company}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} unsure={item.unsure} />
          {isStale(item, now) && <StaleBadge />}
          {item.appliedAt && (
            <span className="text-sm text-muted-foreground">
              Applied {formatCalendarDate(item.appliedAt, true)}
            </span>
          )}
        </div>
        {item.location && (
          <p className="text-sm text-muted-foreground">{item.location}</p>
        )}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {item.postingId && (
            <Link
              href={`/postings/${item.postingId}`}
              className="underline underline-offset-4"
            >
              Posting details
            </Link>
          )}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-4"
            >
              Job page
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          )}
          {item.postingClosed && (
            <span className="text-muted-foreground">
              (the posting has closed)
            </span>
          )}
        </p>
      </header>

      <section
        aria-labelledby="timeline-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="timeline-heading"
          className="font-heading text-lg font-semibold"
        >
          Timeline
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ol
            aria-label="Timeline"
            className="flex flex-col gap-2 border-l pl-4"
          >
            {events.map((e) => (
              <li key={e.id} className="relative text-sm">
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-brass"
                />
                <span className="font-medium">
                  {e.from_status
                    ? `${statusLabel(e.from_status)} → ${statusLabel(e.to_status)}`
                    : `Added as ${statusLabel(e.to_status)}`}
                </span>{" "}
                <time dateTime={e.at} className="text-muted-foreground">
                  {formatLongDate(e.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="edit-heading" className="flex flex-col gap-3">
        <h2 id="edit-heading" className="font-heading text-lg font-semibold">
          Details
        </h2>
        <TrackerRowForm
          id={item.id}
          manual={manual}
          defaultValues={{
            status: item.status,
            unsure: item.unsure,
            appliedAt: item.appliedAt ?? "",
            referral: item.referral,
            referrer: item.referrer ?? "",
            term: item.term ?? "",
            resumeNote: item.resumeNote ?? "",
            notes: item.notes ?? "",
            ...(manual
              ? {
                  company: item.company,
                  role: item.role ?? "",
                  url: item.url ?? "",
                }
              : {}),
          }}
        />
      </section>

      {others.length > 0 && (
        <section
          aria-labelledby="others-heading"
          className="flex flex-col gap-3"
        >
          <h2
            id="others-heading"
            className="font-heading text-lg font-semibold"
          >
            Other applications at {item.company}
          </h2>
          <ul className="flex flex-col gap-2">
            {others.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/tracker/${o.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm hover:bg-secondary/50"
                >
                  <span className="min-w-0 truncate">
                    {o.role ?? "—"}
                    {o.appliedAt && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatCalendarDate(o.appliedAt, true)}
                      </span>
                    )}
                  </span>
                  <StatusBadge status={o.status} unsure={o.unsure} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {manual && <DeleteRowButton id={item.id} />}
    </article>
  );
}
