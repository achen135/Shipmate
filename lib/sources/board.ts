import { type ZodType, z } from "zod";

import { MAX_INVALID_SHARE } from "./simplify";
import type { FetchContext, FetchResult, SourceRow } from "./types";

/**
 * What the four official board adapters share (Greenhouse, Lever, Ashby,
 * SmartRecruiters). Their APIs have no commit SHA or ETag to ask about, so a
 * check is always a full snapshot (`fresh`, no version); the dedupe/upsert
 * step already makes re-reading an unchanged board cheap.
 */

/** The path segment that names a company's board on its ATS. */
export const boardSlugSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);

/**
 * The company's display name. The board APIs don't all say (Lever and Ashby
 * don't), so the source's config carries it, set when someone follows the
 * company.
 */
export const companyNameSchema = z.string().trim().min(1).max(120);

/** A board with no (matching) jobs right now. Not an error. */
export const EMPTY_SNAPSHOT: FetchResult = {
  kind: "fresh",
  version: null,
  rows: [],
  invalid: 0,
};

/**
 * GET JSON. A 404 is `null`: a company with no public board on this ATS just
 * has no jobs there, which is a board with zero jobs, not a failed check.
 * Anything else that isn't 2xx throws.
 */
export async function getBoardJson(
  ctx: FetchContext,
  url: string,
): Promise<unknown | null> {
  const res = await ctx.fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Parse upstream jobs one by one. `toRow` returns null for jobs we don't want
 * (not an internship, unlisted); those are not errors. Rows that don't match
 * `schema`, or a board where too many don't, are the format-changed signal.
 */
export function collectRows<T>(
  items: unknown[],
  schema: ZodType<T>,
  jobId: (item: T) => string,
  toRow: (item: T, raw: unknown) => SourceRow | null,
): { rows: SourceRow[]; invalid: number } {
  const rows: SourceRow[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const raw of items) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      invalid += 1;
      continue;
    }
    const id = jobId(parsed.data);
    if (seen.has(id)) continue;
    const row = toRow(parsed.data, raw);
    if (!row) continue;
    seen.add(id);
    rows.push(row);
  }
  if (items.length > 0 && invalid / items.length > MAX_INVALID_SHARE) {
    throw new Error(
      `${invalid} of ${items.length} jobs didn't parse (format changed?)`,
    );
  }
  return { rows, invalid };
}

/** Distinct, trimmed, non-empty. */
export function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return [
    ...new Set(values.map((v) => v?.trim() ?? "").filter((v) => v !== "")),
  ];
}

/** ISO timestamp from an upstream date string or epoch milliseconds, else null. */
export function isoOrNull(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
