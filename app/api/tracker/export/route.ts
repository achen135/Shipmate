import { getMember } from "@/lib/auth/viewer";
import { dayKey } from "@/lib/format/time";
import { toRecord } from "@/lib/tracker/item";
import { listTrackerItems } from "@/lib/tracker/queries";
import { toExportCsv } from "@/lib/tracker/record";

/**
 * GET /api/tracker/export → the signed-in user's tracker as CSV, with the
 * same column names import reads (lib/tracker/record.ts). Read through RLS,
 * so it can only ever contain the caller's rows.
 */
export async function GET() {
  if (!(await getMember())) {
    return new Response("Sign in first.", { status: 401 });
  }
  const items = await listTrackerItems();
  // A byte-order mark so Excel opens it as UTF-8; import strips it.
  const csv = `﻿${toExportCsv(items.map(toRecord))}`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="shipmate-tracker-${dayKey(Date.now())}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
