import { dayKey, dayLabel } from "@/lib/format/time";

/**
 * Inbox grouping: by the day the job was posted (falling back to when
 * Shipmate first saw it), newest day first, newest posting first within a day.
 */

type Dated = {
  posting: { posted_at: string | null; first_seen_at: string };
};

export function postedAt(item: Dated): string {
  return item.posting.posted_at ?? item.posting.first_seen_at;
}

export function groupByDay<T extends Dated>(
  items: readonly T[],
  now = Date.now(),
): { key: string; label: string; items: T[] }[] {
  const sorted = [...items].sort((a, b) =>
    postedAt(b).localeCompare(postedAt(a)),
  );
  const groups = new Map<string, T[]>();
  for (const item of sorted) {
    const key = dayKey(postedAt(item));
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups].map(([key, list]) => ({
    key,
    label: dayLabel(key, now),
    items: list,
  }));
}
