"use client";

import { Search, Users } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCalendarDate } from "@/lib/format/time";
import { isStale } from "@/lib/tracker/badge";
import { OTHER_TERM, type TrackerItem, groupByTerm } from "@/lib/tracker/item";
import {
  COUNTED_STATUSES,
  TRACKER_STATUSES,
  statusLabel,
} from "@/lib/tracker/status";
import { cn } from "@/lib/utils";

import { StaleBadge, StatusBadge } from "./status-badge";

const ALL = "all";

/**
 * The Tracker list: counts strip, filters (status, term, search), and rows
 * grouped by term. Cards on phones, a table from `lg` up. Everything is
 * already loaded, so filtering happens here without a round-trip.
 */
export function TrackerView({
  items,
  now,
}: {
  items: TrackerItem[];
  /** Server time, so the 30-day badge can't differ after hydration. */
  now: number;
}) {
  const id = useId();
  const [status, setStatus] = useState<string>(ALL);
  const [term, setTerm] = useState<string>(ALL);
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const item of items) {
      byStatus.set(item.status, (byStatus.get(item.status) ?? 0) + 1);
    }
    return byStatus;
  }, [items]);

  const terms = useMemo(() => groupByTerm(items).map((g) => g.term), [items]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupByTerm(
      items.filter(
        (item) =>
          (status === ALL || item.status === status) &&
          (term === ALL || (item.term ?? OTHER_TERM) === term) &&
          (!q ||
            item.company.toLowerCase().includes(q) ||
            (item.role ?? "").toLowerCase().includes(q)),
      ),
    );
  }, [items, status, term, query]);

  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <ul aria-label="Counts" className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {COUNTED_STATUSES.map((s) => {
          const active = status === s;
          return (
            <li key={s}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setStatus(active ? ALL : s)}
                className={cn(
                  "flex w-full flex-col items-center rounded-lg border bg-card px-1 py-2 transition-colors hover:bg-secondary",
                  active && "border-primary bg-secondary",
                )}
              >
                <span className="font-heading text-xl font-semibold tabular-nums">
                  {counts.get(s) ?? 0}
                </span>
                <span className="text-xs text-muted-foreground">
                  {statusLabel(s)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search company or role"
            placeholder="Search company or role"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 pl-8"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger
              id={`${id}-status`}
              aria-label="Status"
              className="h-9 w-full sm:w-36"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {TRACKER_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={term} onValueChange={setTerm}>
            <SelectTrigger
              id={`${id}-term`}
              aria-label="Term"
              className="h-9 w-full sm:w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All terms</SelectItem>
              {terms.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {shown === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No applications match.
        </p>
      )}

      {groups.map((group) => {
        const headingId = `${id}-${group.term.replace(/\W+/g, "-")}`;
        return (
          <section
            key={group.term}
            aria-labelledby={headingId}
            className="flex flex-col gap-3"
          >
            <h2
              id={headingId}
              className="flex items-baseline gap-2 font-heading text-lg font-semibold"
            >
              {group.term}
              <span className="text-sm font-normal text-muted-foreground">
                {group.items.length}
              </span>
            </h2>

            <ul className="flex flex-col gap-2 lg:hidden">
              {group.items.map((item) => (
                <li key={item.id}>
                  <TrackerCard item={item} stale={isStale(item, now)} />
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Company</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">
                      Date applied
                    </th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Referral</th>
                    <th className="px-3 py-2 font-medium">Resume</th>
                    <th className="px-3 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => (
                    <TrackerTableRow
                      key={item.id}
                      item={item}
                      stale={isStale(item, now)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TrackerCard({ item, stale }: { item: TrackerItem; stale: boolean }) {
  return (
    <Link
      href={`/tracker/${item.id}`}
      aria-label={`${item.company}, ${item.role ?? "no role"}`}
      data-testid="tracker-card"
      className="block rounded-xl border bg-card p-3 transition-colors hover:bg-secondary/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{item.company}</p>
          <p className="truncate text-sm text-muted-foreground">
            {item.role ?? "—"}
          </p>
        </div>
        <StatusBadge status={item.status} unsure={item.unsure} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {item.appliedAt
            ? `Applied ${formatCalendarDate(item.appliedAt)}`
            : "No date"}
        </span>
        {item.referral && (
          <span className="inline-flex items-center gap-1">
            <Users aria-hidden="true" className="size-3" />
            Referral
          </span>
        )}
        {item.resumeNote && <span>{item.resumeNote}</span>}
        {stale && <StaleBadge />}
      </p>
      {item.notes && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {item.notes}
        </p>
      )}
    </Link>
  );
}

function TrackerTableRow({
  item,
  stale,
}: {
  item: TrackerItem;
  stale: boolean;
}) {
  return (
    <tr className="border-b align-top last:border-0 hover:bg-secondary/40">
      <td className="px-3 py-2 font-medium">
        <Link
          href={`/tracker/${item.id}`}
          className="underline-offset-4 hover:underline"
        >
          {item.company}
        </Link>
      </td>
      <td className="max-w-56 px-3 py-2">{item.role ?? "—"}</td>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
        {item.appliedAt ? formatCalendarDate(item.appliedAt) : "—"}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={item.status} unsure={item.unsure} />
          {stale && <StaleBadge />}
        </div>
      </td>
      <td className="px-3 py-2">
        {item.referral ? (item.referrer ?? "Yes") : ""}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{item.resumeNote ?? ""}</td>
      <td className="max-w-72 px-3 py-2 text-muted-foreground">
        <span className="line-clamp-2">{item.notes ?? ""}</span>
      </td>
    </tr>
  );
}
