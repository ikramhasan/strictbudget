import { isValid, parse } from "date-fns";
import Papa from "papaparse";
import type { CurrencyCode } from "./currency";
import { parseAmount } from "./format-amount";
import type { NumberFormat } from "./format-settings";

/**
 * A transaction read from a bank file (CSV, OFX/QFX or QIF), before it's matched to the budget:
 * the date as YYYY-MM-DD, the amount in minor units (negative is an outflow), the payee as the
 * bank wrote it.
 */
export interface ImportRow {
  date: string;
  amount: bigint;
  payee: string;
  memo: string;
}

/**
 * The date formats the CSV import offers when it can't tell, in display order, with the date-fns
 * pattern that reads each. Single-letter day and month tokens take one
 * or two digits.
 */
export const CSV_DATE_FORMATS = [
  "MM/DD/YYYY",
  "DD/MM/YYYY",
  "DD/MMM/YYYY",
  "DD/MMMM/YYYY",
  "YYYY/MM/DD",
  "YYYY/DD/MM",
  "MM-DD-YYYY",
  "DD-MM-YY",
  "DD-MM-YYYY",
  "YYYY-MM-DD",
  "DD.MM.YYYY",
  "YYYY.MM.DD",
  "MM/DD'YYYY",
] as const;
export type CsvDateFormat = (typeof CSV_DATE_FORMATS)[number];

const DATE_PATTERNS: Record<CsvDateFormat, string> = {
  "MM/DD/YYYY": "M/d/yyyy",
  "DD/MM/YYYY": "d/M/yyyy",
  "DD/MMM/YYYY": "d/MMM/yyyy",
  "DD/MMMM/YYYY": "d/MMMM/yyyy",
  "YYYY/MM/DD": "yyyy/M/d",
  "YYYY/DD/MM": "yyyy/d/M",
  "MM-DD-YYYY": "M-d-yyyy",
  "DD-MM-YY": "d-M-yy",
  "DD-MM-YYYY": "d-M-yyyy",
  "YYYY-MM-DD": "yyyy-M-d",
  "DD.MM.YYYY": "d.M.yyyy",
  "YYYY.MM.DD": "yyyy.M.d",
  "MM/DD'YYYY": "M/d''yyyy",
};

/** Two-digit years read as 2000–2099 (date-fns places them near this date). */
const REFERENCE = new Date(2050, 0, 1);

/** A bank file's date in `format`, as YYYY-MM-DD; null when it isn't one. */
export function parseImportDate(value: string, format: CsvDateFormat): string | null {
  const text = value.trim();
  if (text === "") return null;
  const parsed = parse(text, DATE_PATTERNS[format], REFERENCE);
  if (!isValid(parsed)) return null;
  const y = parsed.getFullYear();
  if (y < 1900 || y > 2999) return null;
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The formats every one of these dates reads in. The import asks which one when there's more than
 * one, offering the readings of the first date, and lists every format when none fits.
 */
export function possibleDateFormats(values: readonly string[]): CsvDateFormat[] {
  const dates = values.map((v) => v.trim()).filter((v) => v !== "");
  if (dates.length === 0) return [];
  return CSV_DATE_FORMATS.filter((f) => dates.every((v) => parseImportDate(v, f) !== null));
}

/**
 * A bank file's amount, in minor units: the budget's number format, with currency symbols, codes
 * and spaces around it ignored ("$1,234.56", "1.234,56 €"). Null when it isn't a number (or has
 * more decimals than the currency); an empty cell is null too.
 */
export function parseImportAmount(
  value: string,
  currency: CurrencyCode,
  numberFormat: NumberFormat,
): bigint | null {
  // Accounting-style "(12.00)" is left unreadable rather than read as +12.00, so the row is
  // reported instead of imported with the wrong sign.
  if (/\(.*\d.*\)/.test(value)) return null;
  const text = value.replace(/[^\d.,'’+-]/g, "");
  if (!/\d/.test(text)) return null;
  // A sign after the number ("12.00-") is a sign too.
  const signed = /^[^+-]*-$/.test(text) ? `-${text.slice(0, -1)}` : text;
  try {
    return parseAmount(signed, currency, numberFormat).amount;
  } catch {
    return null;
  }
}

/**
 * A CSV (or TSV) file's cells. papaparse guesses the delimiter (comma, semicolon, tab, pipe);
 * blank lines are dropped.
 */
export function parseCsvText(text: string): string[][] {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  return result.data.map((row) => row.map((cell) => (cell ?? "").trim()));
}

/** Which column (0-based) feeds each field; null when none does. */
export interface CsvMapping {
  date: number | null;
  payee: number | null;
  memo: number | null;
  outflow: number | null;
  inflow: number | null;
}

export interface CsvOptions {
  noHeaderRow: boolean;
  swapInflowOutflow: boolean;
  dateFormat: CsvDateFormat | null;
}

/** The column names the selects list: the header, lowercased, or A, B, C… without one. */
export function csvColumnNames(table: readonly string[][], noHeaderRow: boolean): string[] {
  const width = Math.max(0, ...table.map((r) => r.length));
  return Array.from({ length: width }, (_, i) =>
    noHeaderRow ? columnLetter(i) : (table[0]?.[i] ?? "").toLowerCase(),
  );
}

function columnLetter(i: number): string {
  let name = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/**
 * The starting guess: a header "date" is the Date, "payee" or "description" the
 * Payee, "memo" the Memo. Nothing else is picked for you, amounts included.
 */
export function guessCsvMapping(columnNames: readonly string[]): CsvMapping {
  const find = (...names: string[]) => {
    const i = columnNames.findIndex((c) => names.includes(c.trim()));
    return i < 0 ? null : i;
  };
  return {
    date: find("date"),
    payee: find("payee", "description"),
    memo: find("memo"),
    outflow: null,
    inflow: null,
  };
}

/** A data row that couldn't be read, by its 1-based line in the file. */
export interface CsvRowError {
  line: number;
  reason: "date" | "amount";
}

/**
 * The file's transactions under a mapping. One column can be both Outflow and Inflow (a signed
 * amount: negative is an outflow); with two, the outflow column's numbers are money out whatever
 * their sign. "Swap Inflow and Outflow" turns every amount around. Rows whose date or amount
 * can't be read are listed in `errors`.
 */
export function csvRows(
  table: readonly string[][],
  mapping: CsvMapping,
  options: CsvOptions,
  currency: CurrencyCode,
  numberFormat: NumberFormat,
): { rows: ImportRow[]; errors: CsvRowError[] } {
  const rows: ImportRow[] = [];
  const errors: CsvRowError[] = [];
  const first = options.noHeaderRow ? 0 : 1;
  const cell = (row: readonly string[], i: number | null) => (i === null ? "" : (row[i] ?? ""));
  for (let r = first; r < table.length; r++) {
    const row = table[r] ?? [];
    const line = r + 1;
    const date = options.dateFormat
      ? parseImportDate(cell(row, mapping.date), options.dateFormat)
      : null;
    if (!date) {
      errors.push({ line, reason: "date" });
      continue;
    }
    let amount: bigint | null;
    if (mapping.outflow !== null && mapping.outflow === mapping.inflow) {
      amount = parseImportAmount(cell(row, mapping.outflow), currency, numberFormat);
    } else {
      const out = parseImportAmount(cell(row, mapping.outflow), currency, numberFormat);
      const inn = parseImportAmount(cell(row, mapping.inflow), currency, numberFormat);
      amount =
        out === null && inn === null
          ? null
          : (inn === null ? 0n : abs(inn)) - (out === null ? 0n : abs(out));
    }
    if (amount === null) {
      errors.push({ line, reason: "amount" });
      continue;
    }
    rows.push({
      date,
      amount: options.swapInflowOutflow ? -amount : amount,
      payee: cell(row, mapping.payee),
      memo: cell(row, mapping.memo),
    });
  }
  return { rows, errors };
}

const abs = (n: bigint) => (n < 0n ? -n : n);

/**
 * Import ids in the budget's minor units: amount, date, and which occurrence of that amount on
 * that date it is within the file. Importing the same file again gives the same ids, so its rows
 * are skipped. OFX files use these too, not the file's FITIDs.
 */
export function importIds(rows: readonly ImportRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = `${row.amount}:${row.date}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return `EC:${key}:${n}`;
  });
}
