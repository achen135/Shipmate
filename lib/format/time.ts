/**
 * Dates for the UI. Pages render on the server, which doesn't know the
 * viewer's time zone, so day boundaries use one app time zone (everyone is
 * in the US for now). Revisit if that stops being true.
 */
export const APP_TIME_ZONE = "America/Chicago";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "12m ago", "3h ago", "5d ago", then "Mar 4". */
export function formatRelative(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return formatShortDate(iso);
}

const SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: APP_TIME_ZONE,
});

export function formatShortDate(iso: string): string {
  return SHORT.format(new Date(iso));
}

const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: APP_TIME_ZONE,
});

/** YYYY-MM-DD in the app time zone, for grouping. */
export function dayKey(iso: string | number | Date): string {
  return DAY_KEY.format(new Date(iso));
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: APP_TIME_ZONE,
});

/** "Today", "Yesterday", or "Monday, Oct 5" for a dayKey(). */
export function dayLabel(key: string, now = Date.now()): string {
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(now - DAY)) return "Yesterday";
  // Noon UTC on that date stays on the same calendar day in US time zones.
  return WEEKDAY.format(new Date(`${key}T12:00:00Z`));
}

const CALENDAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const CALENDAR_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * A calendar date (YYYY-MM-DD, like applied_at) as "Sep 19" or, with the
 * year, "Sep 19, 2026". Read as UTC so no time zone can shift the day.
 */
export function formatCalendarDate(date: string, withYear = false): string {
  const at = new Date(`${date}T00:00:00Z`);
  return (withYear ? CALENDAR_YEAR : CALENDAR).format(at);
}

const LONG = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: APP_TIME_ZONE,
});

/** "Sep 19, 2026" for an instant, in the app time zone (timelines). */
export function formatLongDate(iso: string): string {
  return LONG.format(new Date(iso));
}
