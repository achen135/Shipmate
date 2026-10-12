// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { mapStatus, parseDate, parseImport, resumeNote } from "./import";
import {
  EXPORT_COLUMNS,
  type TrackerRecord,
  recordKey,
  toExportCsv,
} from "./record";

/**
 * The fixture has the exact shape of Alex's `Applications/Application
 * Tracker.md` (same rows, dates, statuses, resume versions, spacing, and the
 * empty trailing row) with made-up company names and notes: the repo is
 * public and real application history stays out of it.
 */
const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__/application-tracker.md"),
  "utf8",
);

function records(text: string): TrackerRecord[] {
  const result = parseImport(text);
  if (!result.ok) throw new Error(result.message);
  return result.rows.map((r) => {
    if (!r.record) throw new Error(`line ${r.line}: ${r.error}`);
    return r.record;
  });
}

describe("parseImport: Alex's tracker", () => {
  const result = parseImport(FIXTURE);
  const rows = records(FIXTURE);
  const byCompany = (company: string, role: string | null = null) =>
    rows.find((r) => r.company === company && r.role === role);

  it("reads every data row and skips header, separator, and the empty row", () => {
    expect(result.ok && result.format).toBe("markdown");
    expect(rows).toHaveLength(50);
    expect(result.ok && result.rows.every((r) => r.error === null)).toBe(true);
    expect(result.ok && result.rows.flatMap((r) => r.warnings)).toEqual([]);
  });

  it("takes the term from the heading above the table", () => {
    expect(new Set(rows.map((r) => r.term))).toEqual(new Set(["Summer 2027"]));
  });

  it("matches the file's counts: 40 applied, 10 rejected (1 unsure), 2 referrals", () => {
    const count = (pred: (r: TrackerRecord) => boolean) =>
      rows.filter(pred).length;
    expect(count((r) => r.status === "applied")).toBe(40);
    expect(count((r) => r.status === "rejected")).toBe(10);
    expect(count((r) => r.status === "rejected" && !r.unsure)).toBe(9);
    expect(count((r) => r.unsure)).toBe(1);
    expect(count((r) => r.referral)).toBe(2);
  });

  it("strikethrough → rejected, with the markers removed", () => {
    expect(byCompany("Sextant")).toMatchObject({
      status: "rejected",
      unsure: false,
    });
    expect(rows.some((r) => r.company.includes("~"))).toBe(false);
  });

  it("a trailing parenthetical becomes the role", () => {
    expect(byCompany("Keel", "backend")).toMatchObject({
      appliedAt: "2026-09-27",
      status: "applied",
      resumeNote: "Resume v3",
    });
    // The earlier application at the same company stays its own row.
    expect(byCompany("Keel")).toMatchObject({
      appliedAt: "2026-09-24",
      status: "rejected",
    });
  });

  it("maps the odd statuses", () => {
    expect(byCompany("Seaglass")).toMatchObject({
      status: "rejected",
      unsure: true,
      resumeNote: null,
    });
    expect(byCompany("Driftwood")).toMatchObject({
      status: "applied",
      referral: true,
      resumeNote: "Resume v3?",
      notes:
        "Applied once and was rejected, then referred in a new application",
    });
    expect(byCompany("Mainsail Explore")).toMatchObject({
      status: "applied",
      referral: true,
      notes: "Sophomore only",
    });
    expect(byCompany("Reef")).toMatchObject({
      status: "applied",
      referral: false,
      notes: "dnc",
    });
  });

  it("parses MM/DD/YY dates and squashes double spaces in names", () => {
    expect(byCompany("Bell & Buoy")?.appliedAt).toBe("2026-09-23");
    expect(byCompany("Skipper IGNITE")?.appliedAt).toBe("2026-10-05");
  });

  it("gives each row a distinct dedupe key", () => {
    expect(new Set(rows.map(recordKey)).size).toBe(50);
  });
});

describe("parseImport: shapes", () => {
  it("supports several heading + table blocks", () => {
    const rows = records(
      [
        "# Summer 2027",
        "| Company | Status |",
        "|---|---|",
        "| Alpha | Waiting |",
        "",
        "## Fall 2026",
        "",
        "| Company | Status |",
        "| --- | --- |",
        "| Beta | OA |",
      ].join("\n"),
    );
    expect(rows.map((r) => [r.company, r.term, r.status])).toEqual([
      ["Alpha", "Summer 2027", "applied"],
      ["Beta", "Fall 2026", "oa"],
    ]);
  });

  it("maps columns by header name, in any order and case", () => {
    const [row] = records(
      "| NOTES | status | date applied | company |\n|-|-|-|-|\n| hi | Interview | 2026-10-01 | Gamma |",
    );
    expect(row).toMatchObject({
      company: "Gamma",
      status: "interview",
      appliedAt: "2026-10-01",
      notes: "hi",
      term: null,
    });
  });

  it("keeps unknown columns and unreadable dates in notes, never drops text", () => {
    const result = parseImport(
      "| Company | Date Applied | Location | Status |\n|-|-|-|-|\n| Delta | last week | Austin | Ghosted |",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = result.rows;
    expect(row.record).toMatchObject({
      status: "applied",
      appliedAt: null,
      notes: "Status: Ghosted\nLocation: Austin\nDate applied: last week",
    });
    expect(row.warnings).toEqual([
      'Couldn\'t read the date "last week"; kept it in notes.',
    ]);
  });

  it("flags rows without a company instead of dropping them silently", () => {
    const result = parseImport(
      "| Company | Notes |\n|-|-|\n|  | orphan note |\n| Echo | |",
    );
    expect(result.ok && result.rows.map((r) => r.error)).toEqual([
      "No company.",
      null,
    ]);
  });

  it("refuses tables without a Company column", () => {
    expect(parseImport("| Name | Status |\n|-|-|\n| X | Waiting |")).toEqual({
      ok: false,
      message: "The table needs a Company column.",
    });
    expect(parseImport("Name,Status\nX,Waiting")).toEqual({
      ok: false,
      message: "The table needs a Company column.",
    });
    expect(parseImport("   ")).toEqual({
      ok: false,
      message: "Paste a table first.",
    });
  });

  it("reads CSV, including quoted commas and newlines", () => {
    const rows = records(
      'Company,Status,Notes\r\n"Foxtrot, Inc.",Offer,"line one\nline two"\r\n',
    );
    expect(rows).toEqual([
      expect.objectContaining({
        company: "Foxtrot, Inc.",
        status: "offer",
        notes: "line one\nline two",
      }),
    ]);
  });

  it("keeps parentheses in the company when there's a Role column", () => {
    const [row] = records("Company,Role\nAcme (Canada),Intern");
    expect(row).toMatchObject({ company: "Acme (Canada)", role: "Intern" });
  });
});

describe("mapStatus", () => {
  it.each([
    ["Waiting", "applied", false, false, []],
    ["Rejected", "rejected", false, false, []],
    ["Rejected?", "rejected", true, false, []],
    ["*Referred*", "applied", false, true, []],
    ["Waiting - Referred", "applied", false, true, []],
    ["Waiting, but dnc", "applied", false, false, ["dnc"]],
    ["", "applied", false, false, []],
    ["OA?", "oa", true, false, []],
    ["Withdrawn", "withdrawn", false, false, []],
    ["Ghosted", "applied", false, false, ["Status: Ghosted"]],
  ] as const)("%j → %s", (raw, status, unsure, referral, notes) => {
    expect(mapStatus(raw)).toEqual({ status, unsure, referral, notes });
  });

  it("strikethrough wins, keeping a conflicting status in notes", () => {
    expect(mapStatus("Rejected", true).status).toBe("rejected");
    expect(mapStatus("Waiting", true)).toEqual({
      status: "rejected",
      unsure: false,
      referral: false,
      notes: ["Status: Waiting"],
    });
  });
});

describe("parseDate / resumeNote", () => {
  it.each([
    ["09/19/26", "2026-09-19"],
    ["9/5/2026", "2026-09-05"],
    ["2026-10-02", "2026-10-02"],
    ["02/30/26", null],
    ["13/01/26", null],
    ["Sept 19", null],
    ["", null],
  ])("parseDate(%j) = %j", (raw, expected) => {
    expect(parseDate(raw)).toBe(expected);
  });

  it.each([
    ["1", "Resume v1"],
    ["3?", "Resume v3?"],
    ["v2", "Resume v2"],
    ["Resume v4", "Resume v4"],
    ["SWE one-pager", "SWE one-pager"],
    ["", null],
  ])("resumeNote(%j) = %j", (raw, expected) => {
    expect(resumeNote(raw)).toBe(expected);
  });
});

describe("CSV round-trip", () => {
  it("export → import gives the same rows", () => {
    const original: TrackerRecord[] = [
      ...records(FIXTURE),
      {
        company: "=Formula Co",
        role: "SWE Intern, Platform",
        term: "Fall 2026",
        appliedAt: null,
        status: "interview",
        unsure: false,
        referral: true,
        referrer: 'Sam "the recruiter" Lee',
        resumeNote: "Resume v5",
        notes: "- multi\nline, with commas",
        url: "https://boards.greenhouse.io/acme/jobs/123?gh_src=x",
      },
      {
        company: "Withdrawn Co",
        role: null,
        term: null,
        appliedAt: "2026-10-03",
        status: "withdrawn",
        unsure: true,
        referral: false,
        referrer: null,
        resumeNote: null,
        notes: null,
        url: null,
      },
    ];
    const csv = toExportCsv(original);
    expect(records(csv)).toEqual(original);
  });

  it("writes the import column names and defuses formulas", () => {
    const [header, row] = toExportCsv([
      {
        company: "@Cmd",
        role: null,
        term: null,
        appliedAt: null,
        status: "applied",
        unsure: false,
        referral: false,
        referrer: null,
        resumeNote: null,
        notes: null,
        url: null,
      },
    ]).split("\r\n");
    expect(header).toBe(EXPORT_COLUMNS.join(","));
    expect(row).toBe("'@Cmd,,,,Applied,,,,,");
  });
});
