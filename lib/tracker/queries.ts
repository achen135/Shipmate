import "server-only";

import { createClient } from "@/lib/supabase/server";

import { type TrackerRow, toTrackerItem } from "./item";
import { TRACKER_STATUS_VALUES } from "./status";

/**
 * Tracker reads, as the signed-in user (RLS: own user_postings and their
 * status_events; postings and companies readable by members).
 */

const ROW_FIELDS =
  "id, status, status_unsure, applied_at, referral, referrer, notes, term, manual, resume_note, posting:postings(id, title, url, terms, locations, status, company:companies(name))" as const;

/** More than anyone applies to in a season; the page shows them all. */
const MAX_ROWS = 2000;

/** Every tracker row, newest application first, with its last event time. */
export async function listTrackerItems() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_postings")
    .select(`${ROW_FIELDS}, status_events(at)`)
    .in("status", TRACKER_STATUS_VALUES)
    .order("applied_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("at", { referencedTable: "status_events", ascending: false })
    .limit(1, { referencedTable: "status_events" })
    .limit(MAX_ROWS);
  if (error) throw new Error(`tracker: ${error.message}`);
  return (data satisfies TrackerRow[]).map(toTrackerItem);
}

/** One row with its whole timeline (oldest first), or null. */
export async function getTrackerDetail(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_postings")
    .select(`${ROW_FIELDS}, status_events(id, from_status, to_status, at)`)
    .eq("id", id)
    .order("at", { referencedTable: "status_events", ascending: true })
    .maybeSingle();
  if (error) throw new Error(`tracker row: ${error.message}`);
  if (!data) return null;
  const events = data.status_events;
  return {
    item: toTrackerItem({
      ...data,
      status_events: events.length ? [events[events.length - 1]] : [],
    }),
    manual: data.posting === null,
    events,
  };
}
