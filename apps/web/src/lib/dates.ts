import type { DateFormat } from "@strictbudget/engine";
import {
  addDays,
  endOfMonth,
  endOfYear,
  format as format_,
  isValid,
  parse,
  startOfMonth,
  startOfYear,
} from "date-fns";

/** The user's local calendar date as YYYY-MM-DD (what "today" means throughout the app). */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const PATTERNS: Record<DateFormat, string> = {
  "MM/DD/YYYY": "MM/dd/yyyy",
  "DD/MM/YYYY": "dd/MM/yyyy",
  "YYYY-MM-DD": "yyyy-MM-dd",
  "DD.MM.YYYY": "dd.MM.yyyy",
  "YYYY/MM/DD": "yyyy/MM/dd",
  "DD-MM-YYYY": "dd-MM-yyyy",
};

/** The same pattern with the year left out, e.g. "MM/dd" ("10/5" means this year's Oct 5). */
function withoutYear(pattern: string) {
  return pattern.replace(/^yyyy\W|\Wyyyy$/, "");
}

/**
 * Reads a date typed in the budget's format into YYYY-MM-DD, or null if it isn't one. Single
 * digits and a missing year (meaning `reference`'s year) are fine.
 */
export function parseDateInput(text: string, format: DateFormat, reference = new Date()) {
  const trimmed = text.trim();
  for (const pattern of [PATTERNS[format], withoutYear(PATTERNS[format])]) {
    const loose = pattern.replace("dd", "d").replace("MM", "M");
    const date = parse(trimmed, loose, reference);
    if (isValid(date) && date.getFullYear() >= 1900) return format_(date, "yyyy-MM-dd");
  }
  return null;
}

/** YYYY-MM-DD ↔ a local Date at midnight (for the calendar). */
export const isoToDate = (iso: string) => parse(iso, "yyyy-MM-dd", new Date());
export const dateToIso = (date: Date) => format_(date, "yyyy-MM-dd");

/**
 * Date-picker keys, applied to the field's date: + and - a day, T today, M / Shift+M the first and
 * last day of its month, Y / Shift+Y of its year, Left/Right a day and Up/Down a week. Null for any
 * other key. `dash` is false when the date format uses "-" between its parts, so typing a dash
 * still types one.
 */
export function dateForKey(
  iso: string,
  key: string,
  today: string,
  { dash = true }: { dash?: boolean } = {},
): string | null {
  const date = isoToDate(iso);
  if (!isValid(date)) return null;
  switch (key) {
    case "+":
    case "ArrowRight":
      return dateToIso(addDays(date, 1));
    case "-":
      return dash ? dateToIso(addDays(date, -1)) : null;
    case "ArrowLeft":
      return dateToIso(addDays(date, -1));
    case "ArrowDown":
      return dateToIso(addDays(date, 7));
    case "ArrowUp":
      return dateToIso(addDays(date, -7));
    case "t":
    case "T":
      return today;
    case "m":
      return dateToIso(startOfMonth(date));
    case "M":
      return dateToIso(endOfMonth(date));
    case "y":
      return dateToIso(startOfYear(date));
    case "Y":
      return dateToIso(endOfYear(date));
    default:
      return null;
  }
}
