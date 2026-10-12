import { trackerRecordSchema } from "@/lib/schemas/tracker";

import { parseCsv } from "./csv";
import type { TrackerRecord } from "./record";
import type { TrackerStatus } from "./status";

/**
 * Import: a pasted Markdown table (or several, each under a `# Term`
 * heading) or a CSV, turned into tracker records for a preview. Built for
 * Alex's old `Application Tracker.md`; also reads Shipmate's own CSV export.
 *
 * Nothing is dropped: text the parser can't place (an unknown status, an
 * extra column, an unreadable date) is appended to the row's notes.
 */

export type ImportRow = {
  /** 1-based line (Markdown) or record (CSV) number in the input. */
  line: number;
  /** null when the row can't be imported (see `error`). */
  record: TrackerRecord | null;
  error: string | null;
  /** Things the preview should point out (a date it couldn't read…). */
  warnings: string[];
};

export type ImportResult =
  | { ok: true; format: "markdown" | "csv"; rows: ImportRow[] }
  | { ok: false; message: string };

type Field =
  | "company"
  | "role"
  | "term"
  | "appliedAt"
  | "status"
  | "resume"
  | "notes"
  | "referral"
  | "referrer"
  | "url";

/** Header names (lowercase, single spaces) → field. */
const HEADERS: Record<string, Field> = {
  company: "company",
  role: "role",
  position: "role",
  title: "role",
  term: "term",
  "date applied": "appliedAt",
  "applied on": "appliedAt",
  applied: "appliedAt",
  date: "appliedAt",
  status: "status",
  "resume version": "resume",
  resume: "resume",
  notes: "notes",
  note: "notes",
  referral: "referral",
  referred: "referral",
  referrer: "referrer",
  "referred by": "referrer",
  url: "url",
  link: "url",
};

type Column = { field: Field | null; header: string };

export function parseImport(input: string): ImportResult {
  const text = input.replace(/^﻿/, "");
  if (!text.trim()) return { ok: false, message: "Paste a table first." };
  const markdown = text
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith("|"));
  return markdown ? parseMarkdown(text) : parseCsvImport(text);
}

// ---------------------------------------------------------------- Markdown

function parseMarkdown(text: string): ImportResult {
  const rows: ImportRow[] = [];
  let term: string | null = null;
  let columns: Column[] | null = null;
  let sawTable = false;
  let missingCompany = false;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const heading = line.match(/^#{1,6}\s+(.*?)\s*#*$/);
    if (heading) {
      term = heading[1].trim() || null;
      columns = null;
      return;
    }
    if (!line.startsWith("|")) {
      // Anything else ends the current table.
      columns = null;
      return;
    }
    const cells = splitMarkdownRow(line);
    if (cells.every((c) => /^:?-+:?$/.test(c) || c === "")) {
      // Separator (|---|---|) or an empty row (| | |).
      return;
    }
    if (!columns) {
      columns = toColumns(cells);
      sawTable = true;
      if (!hasCompany(columns)) missingCompany = true;
      return;
    }
    rows.push(parseRow(index + 1, columns, cells, term));
  });

  if (!sawTable) return { ok: false, message: "No table found." };
  if (missingCompany) return { ok: false, message: NO_COMPANY_COLUMN };
  return result(rows, "markdown");
}

/** `| a | b \| c |` → ["a", "b | c"]. */
function splitMarkdownRow(line: string): string[] {
  const inner = line.replace(/^\|/, "").replace(/\|$/, "");
  return inner
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

// ---------------------------------------------------------------- CSV

function parseCsvImport(text: string): ImportResult {
  const [header, ...body] = parseCsv(text);
  if (!header) return { ok: false, message: "No rows found." };
  const columns = toColumns(header.map((h) => h.trim()));
  if (!hasCompany(columns)) return { ok: false, message: NO_COMPANY_COLUMN };
  const rows = body.map((cells, i) =>
    parseRow(
      i + 2,
      columns,
      cells.map((c) => c.trim()),
      null,
    ),
  );
  return result(rows, "csv");
}

// ---------------------------------------------------------------- shared

function toColumns(headers: string[]): Column[] {
  return headers.map((header) => ({
    header,
    field: HEADERS[header.toLowerCase().replace(/\s+/g, " ")] ?? null,
  }));
}

const hasCompany = (columns: Column[]) =>
  columns.some((c) => c.field === "company");

function result(rows: ImportRow[], format: "markdown" | "csv"): ImportResult {
  if (rows.length === 0)
    return { ok: false, message: "The table has no rows." };
  return { ok: true, format, rows };
}

const NO_COMPANY_COLUMN = "The table needs a Company column.";

function parseRow(
  line: number,
  columns: Column[],
  cells: string[],
  headingTerm: string | null,
): ImportRow {
  const warnings: string[] = [];
  const extraNotes: string[] = [];
  const get = (field: Field) => {
    const i = columns.findIndex((c) => c.field === field);
    return i >= 0 ? (cells[i] ?? "").trim() : null;
  };

  // Columns we don't know: keep their text in notes.
  columns.forEach((column, i) => {
    const value = cells[i]?.trim();
    if (column.field === null && value) {
      extraNotes.push(column.header ? `${column.header}: ${value}` : value);
    }
  });
  // Cells beyond the header (a stray `|`): same.
  for (const value of cells.slice(columns.length)) {
    if (value.trim()) extraNotes.push(value.trim());
  }

  const companyCell = get("company") ?? "";
  const struck = /~~.+~~/.test(companyCell);
  let company = squashSpaces(stripMarkup(companyCell));
  let role = get("role");
  if (role === null) {
    // No Role column: "Ramp (backend)" → Ramp, backend.
    const split = company.match(/^(.*\S)\s*\(([^()]+)\)$/);
    if (split) {
      company = split[1];
      role = split[2].trim();
    }
  }
  role = role ? squashSpaces(stripMarkup(role)) : null;

  const status = mapStatus(get("status") ?? "", struck);
  extraNotes.unshift(...status.notes);

  const dateCell = get("appliedAt") ?? "";
  const appliedAt = parseDate(dateCell);
  if (dateCell && !appliedAt) {
    warnings.push(`Couldn't read the date "${dateCell}"; kept it in notes.`);
    extraNotes.push(`Date applied: ${dateCell}`);
  }

  const referralCell = get("referral") ?? "";
  const referral = status.referral || isYes(referralCell);
  let referrer = get("referrer") || null;
  if (referralCell && !isYes(referralCell) && !isNo(referralCell)) {
    // "Referral: Sam from the career fair" → a referral, with that text.
    if (referrer) extraNotes.push(`Referral: ${referralCell}`);
    else referrer = referralCell;
  }
  const referred = referral || referrer !== null;

  const urlCell = get("url") ?? "";
  const url = /^https?:\/\/\S+$/i.test(urlCell) ? urlCell : null;
  if (urlCell && !url) extraNotes.push(`URL: ${urlCell}`);

  const notes = [get("notes") ?? "", ...extraNotes]
    .map((n) => n.trim())
    .filter(Boolean)
    .join("\n");

  const record: TrackerRecord = {
    company,
    role: role || null,
    term: get("term") || headingTerm,
    appliedAt,
    status: status.status,
    unsure: status.unsure,
    referral: referred,
    referrer,
    resumeNote: resumeNote(get("resume") ?? ""),
    notes: notes || null,
    url,
  };

  const parsed = trackerRecordSchema.safeParse(record);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue.path[0] ?? "");
    return {
      line,
      record: null,
      error:
        field === "company" && !company
          ? "No company."
          : `${fieldLabel(field)}: ${issue.message}`,
      warnings,
    };
  }
  return { line, record: parsed.data, error: null, warnings };
}

function fieldLabel(field: string): string {
  return (
    {
      company: "Company",
      role: "Role",
      term: "Term",
      notes: "Notes",
      referrer: "Referrer",
      resumeNote: "Resume",
    }[field] ?? field
  );
}

/** Drop Markdown emphasis and strikethrough markers around a value. */
export function stripMarkup(value: string): string {
  return value.replace(/~~|\*\*|__|(?<!\w)[*_]|[*_](?!\w)/g, "").trim();
}

function squashSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const isYes = (s: string) => /^(y|yes|true|1|x|✓|✔)$/i.test(s.trim());
const isNo = (s: string) => /^(n|no|false|0|-|—)?$/i.test(s.trim());

// ---------------------------------------------------------------- status

/** Status words → status. Shipmate's own labels are in here (export). */
const STATUS_WORDS: Record<string, TrackerStatus> = {
  waiting: "applied",
  applied: "applied",
  submitted: "applied",
  pending: "applied",
  "in review": "applied",
  "under review": "applied",
  oa: "oa",
  "online assessment": "oa",
  assessment: "oa",
  "coding challenge": "oa",
  interview: "interview",
  interviewing: "interview",
  "phone screen": "interview",
  offer: "offer",
  rejected: "rejected",
  rejection: "rejected",
  withdrawn: "withdrawn",
  withdrew: "withdrawn",
};

const REFERRAL_WORDS = new Set(["referred", "referral", "ref"]);

export type MappedStatus = {
  status: TrackerStatus;
  unsure: boolean;
  referral: boolean;
  /** Text to keep in notes. */
  notes: string[];
};

/**
 * The old Status column → status + flags:
 *   "Waiting" → applied · "Rejected?" → rejected, unsure ·
 *   "*Referred*" and "Waiting - Referred" → applied, referral ·
 *   "Waiting, but dnc" → applied, note "dnc" ·
 *   anything unknown → applied, with the raw value kept in notes.
 * A struck-through company (`~~Lyft~~`) means rejected.
 */
export function mapStatus(raw: string, struck = false): MappedStatus {
  const value = stripMarkup(raw);
  let status: TrackerStatus | null = null;
  let unsure = false;
  let referral = false;
  const leftovers: string[] = [];

  for (const part of value.split(/\s+-\s+|\s*[,;/]\s*/)) {
    const cleaned = part.trim().replace(/^(but|and)\s+/i, "");
    if (!cleaned) continue;
    const question = cleaned.endsWith("?");
    const word = cleaned.replace(/\?+$/, "").trim().toLowerCase();
    if (REFERRAL_WORDS.has(word)) {
      referral = true;
    } else if (status === null && STATUS_WORDS[word]) {
      status = STATUS_WORDS[word];
      unsure = question;
    } else {
      leftovers.push(cleaned);
    }
  }

  const notes: string[] = [];
  if (status === null && leftovers.length > 0) {
    notes.push(`Status: ${value}`);
  } else if (leftovers.length > 0) {
    notes.push(leftovers.join(", "));
  }
  if (struck && status !== null && status !== "rejected") {
    notes.push(`Status: ${value}`);
  }

  return {
    status: struck ? "rejected" : (status ?? "applied"),
    unsure: struck && status !== "rejected" ? false : unsure,
    referral,
    notes,
  };
}

// ---------------------------------------------------------------- values

/** `09/19/26`, `9/19/2026`, or `2026-09-19` → `2026-09-19`; else null. */
export function parseDate(raw: string): string | null {
  const value = raw.trim();
  let y: number, m: number, d: number;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (us) {
    m = Number(us[1]);
    d = Number(us[2]);
    y = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
  } else if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** `3` → "Resume v3", `3?` → "Resume v3?"; other text is kept as is. */
export function resumeNote(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const version = value.match(/^v?(\d+)(\?*)$/i);
  return version ? `Resume v${version[1]}${version[2]}` : value;
}
