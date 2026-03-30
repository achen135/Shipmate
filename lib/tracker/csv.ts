/**
 * RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside
 * quotes, CRLF or LF line endings.
 *
 * Cells that a spreadsheet would run as a formula (=, +, -, @ first) are
 * written with a leading apostrophe, and read back without it, so a posting
 * title can't become a formula in the user's spreadsheet and a round-trip
 * still gives the same text.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows of cells. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const input = text.replace(/^﻿/, "");

  const endCell = () => {
    row.push(unescapeFormula(cell));
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (input[i + 1] !== "\n") endRow();
    } else cell += ch;
    i += 1;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

function unescapeFormula(cell: string): string {
  return cell.startsWith("'") && FORMULA_START.test(cell.slice(1))
    ? cell.slice(1)
    : cell;
}
