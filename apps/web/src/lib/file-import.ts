import type { components } from "@strictbudget/api-client";
import {
  type CsvDateFormat,
  type CsvMapping,
  csvColumnNames,
  guessCsvMapping,
  parseImportDate,
  possibleDateFormats,
} from "@strictbudget/engine";

export type CsvImportSettings = components["schemas"]["CsvImportSettings"];
export type ImportContext = components["schemas"]["ImportContext"];

export const IMPORT_FILE_ACCEPT = ".csv,.tsv,.ofx,.qfx,.qif";

export type ImportFileKind = "csv" | "ofx" | "qif";

export function importFileKind(name: string): ImportFileKind | null {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "ofx" || ext === "qfx") return "ofx";
  if (ext === "qif") return "qif";
  return null;
}

const INTRO_KEY = "strictbudget.fileImportIntroHidden";
export function introHidden(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return false;
  }
}
export function hideIntro() {
  try {
    localStorage.setItem(INTRO_KEY, "1");
  } catch {
    // Private windows can refuse storage; the explainer just shows again.
  }
}

export interface CsvSetup {
  mapping: CsvMapping;
  noHeaderRow: boolean;
  swapInflowOutflow: boolean;
  dateFormat: CsvDateFormat | null;
}

/**
 * Where a CSV import starts: what the account remembered, when it was set for these column names;
 * otherwise a guess, with the date format read from the file when only one fits.
 */
export function initialCsvSetup(
  table: readonly string[][],
  remembered: CsvImportSettings | null,
): CsvSetup {
  if (remembered) {
    const columns = csvColumnNames(table, remembered.noHeaderRow);
    if (sameColumns(columns, remembered.columns)) {
      return {
        mapping: remembered.mapping,
        noHeaderRow: remembered.noHeaderRow,
        swapInflowOutflow: remembered.swapInflowOutflow,
        dateFormat: remembered.dateFormat,
      };
    }
  }
  const mapping = guessCsvMapping(csvColumnNames(table, false));
  const formats = dateCandidates(table, mapping.date, false);
  return {
    mapping,
    noHeaderRow: false,
    swapInflowOutflow: false,
    dateFormat: formats.length === 1 ? (formats[0] ?? null) : null,
  };
}

function sameColumns(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/** The date formats every value in the date column reads in. */
export function dateCandidates(
  table: readonly string[][],
  dateColumn: number | null,
  noHeaderRow: boolean,
): CsvDateFormat[] {
  if (dateColumn === null) return [];
  const values = table.slice(noHeaderRow ? 0 : 1).map((r) => r[dateColumn] ?? "");
  return possibleDateFormats(values);
}

/**
 * The choices when the format is unclear: the readings of the first date ("October 10, 2026
 * (MM/DD/YYYY)") when some formats fit, otherwise every format by name.
 */
export function dateFormatChoices(
  first: string,
  candidates: readonly CsvDateFormat[],
  all: readonly CsvDateFormat[],
): { format: CsvDateFormat; label: string }[] {
  if (candidates.length === 0) return all.map((format) => ({ format, label: format }));
  return candidates.map((format) => {
    const iso = parseImportDate(first, format) ?? "";
    return { format, label: `${longDate(iso)} (${format})` };
  });
}

function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
