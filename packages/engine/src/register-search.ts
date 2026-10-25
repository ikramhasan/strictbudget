import type { CurrencyCode } from "./currency";
import { parseAmount } from "./format-amount";
import type { DateFormat, NumberFormat } from "./format-settings";

/**
 * The register search: comma-separated terms, all of which must match (it's
 * additive, never subtractive). A term is either free text, found in any field, or
 * `Label: value` for one field, as the search suggestions write them:
 *
 *   `Payee: sto, Is: Cleared, Outflow: >=25,`
 *
 * Text matches ignore case and match anywhere in the name; a number on its own matches that
 * exact inflow or outflow. A term whose label or value isn't understood is searched as free
 * text, so nothing typed is ever silently dropped.
 */
export type SearchTerm =
  | { kind: "text"; text: string; amount: bigint | null }
  | { kind: "payee" | "category" | "memo" | "account"; text: string }
  /** `Category: Split`: split transactions. */
  | { kind: "split" }
  /** A flag color or the budget's name for one (resolved by the caller), or "none". */
  | { kind: "flag"; text: string }
  | { kind: "is"; state: IsState }
  | { kind: "amount"; direction: "outflow" | "inflow"; op: AmountOp; amount: bigint }
  | { kind: "date"; op: DateOp; date: string }
  /**
   * `Income: October 2026`: what went to or came from Ready to Assign in that month (`month`
   * 1–12). Without a year it's the current year, which the caller knows.
   */
  | { kind: "income"; month: number; year: number | null };

export const IS_STATES = [
  "uncleared",
  "cleared",
  "reconciled",
  "unreconciled",
  "cleared_or_reconciled",
  "matched",
  "approved",
  "unapproved",
  "needs_category",
  "unapproved_or_needs_category",
] as const;
export type IsState = (typeof IS_STATES)[number];

/** The name of each `Is:` state. */
export const IS_LABELS: Record<IsState, string> = {
  uncleared: "Uncleared",
  cleared: "Cleared",
  reconciled: "Reconciled",
  unreconciled: "Unreconciled",
  cleared_or_reconciled: "Cleared or Reconciled",
  matched: "Matched",
  approved: "Approved",
  unapproved: "Unapproved",
  needs_category: "Needs Category",
  unapproved_or_needs_category: "Unapproved or Needs Category",
};

export type AmountOp = "eq" | "gte" | "lte";
export type DateOp = "on" | "before" | "after";

/** `On:` is that day; `Before:`/`After:` include the day itself ("On or before"). */
export const DATE_LABELS: Record<DateOp, string> = { on: "On", before: "Before", after: "After" };

/** English month names, as the `Income:` term reads and writes them. */
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** `Income: October 2026` for a month (1–12) of a year. */
export function incomeTerm(month: number, year: number) {
  return `Income: ${MONTH_NAMES[month - 1]} ${year}`;
}

export interface SearchSettings {
  currency: CurrencyCode;
  numberFormat: NumberFormat;
  dateFormat: DateFormat;
}

/**
 * The terms of a search box's text. Empty terms (",,") are skipped. `today` (YYYY-MM-DD, the
 * user's; the UTC date when left out) completes partial dates (`completeDate`).
 */
export function parseSearch(
  text: string,
  settings: SearchSettings,
  today = new Date().toISOString().slice(0, 10),
): SearchTerm[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => parseTerm(t, settings, today));
}

function parseTerm(term: string, settings: SearchSettings, today: string): SearchTerm {
  const colon = term.indexOf(":");
  if (colon > 0) {
    const label = term.slice(0, colon).trim().toLowerCase();
    const value = term.slice(colon + 1).trim();
    const parsed = value ? labelled(label, value, settings, today) : null;
    if (parsed) return parsed;
  }
  return { kind: "text", text: term, amount: searchAmount(term, settings) };
}

function labelled(
  label: string,
  value: string,
  settings: SearchSettings,
  today: string,
): SearchTerm | null {
  switch (label) {
    case "payee":
    case "memo":
    case "account":
      return { kind: label, text: value };
    case "category":
      return value.toLowerCase() === "split"
        ? { kind: "split" }
        : { kind: "category", text: value };
    case "flag":
      return { kind: "flag", text: value };
    case "is": {
      const state = IS_STATES.find((s) => IS_LABELS[s].toLowerCase() === value.toLowerCase());
      return state ? { kind: "is", state } : null;
    }
    case "outflow":
    case "inflow": {
      const match = /^(>=|<=|=)?\s*(.+)$/.exec(value);
      const amount = match?.[2] ? searchAmount(match[2], settings) : null;
      if (amount === null) return null;
      const op: AmountOp = match?.[1] === ">=" ? "gte" : match?.[1] === "<=" ? "lte" : "eq";
      return { kind: "amount", direction: label, op, amount };
    }
    case "income":
      return parseIncomeMonth(value);
    case "on":
    case "before":
    case "after": {
      const date = completeDate(value, settings.dateFormat, today);
      return date ? { kind: "date", op: label, date } : null;
    }
    default:
      return null;
  }
}

/**
 * A month name, in full or its first three letters, in any case, then an optional four-digit year
 * ("October 2026", "oct", "OCTOBER"). Nothing else reads ("10/2026", "Sept" match nothing).
 */
function parseIncomeMonth(value: string): SearchTerm | null {
  const match = /^([a-z]+)(?:\s+(\d{4}))?$/i.exec(value);
  if (!match?.[1]) return null;
  const name = match[1].toLowerCase();
  const index = MONTH_NAMES.findIndex(
    (m) => m.toLowerCase() === name || m.slice(0, 3).toLowerCase() === name,
  );
  if (index < 0) return null;
  return { kind: "income", month: index + 1, year: match[2] ? Number(match[2]) : null };
}

/** The unsigned amount (minor units) `text` reads as, if it's a number. */
function searchAmount(text: string, settings: SearchSettings): bigint | null {
  try {
    const { amount } = parseAmount(
      text.trim().replace(/^[-+]/, ""),
      settings.currency,
      settings.numberFormat,
    );
    return amount < 0n ? -amount : amount;
  } catch {
    return null;
  }
}

const DATE_PARTS = /(YYYY|MM|DD)/;

function daysIn(year: number, month: number) {
  // setUTCFullYear, unlike Date.UTC, keeps years below 100 as typed.
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

/**
 * The date the search reads in `text` (YYYY-MM-DD), or null. It's what moment.js's forgiving
 * parse with the budget's date format gives, then a year window:
 *
 * - The format's parts are read in order, each from the first digits found in what's left
 *   (month and day take one or two, the year one to four), skipping whatever comes before them;
 *   a separator in the format is skipped up to its next occurrence. So in MM/DD/YYYY `5` is May
 *   1st, `105` is 10/05, `10/2026` is 10/20/2026 (day "20", year "26"), and `Card 5` reads as a
 *   date too.
 * - Year, then month, then day take today's until the first part typed; after it a missing month
 *   is January and a missing day the 1st (DD/MM/YYYY: `5` is the 5th of this month).
 * - A two-digit year is 2000–2068 or 1969–1999. A month or day that doesn't exist gives null.
 * - A year more than 20 years from today's becomes this year (`10/02/1999` → 10/02/2026), with
 *   February 29th moved to the 28th when this year has none.
 */
export function completeDate(text: string, format: DateFormat, today: string): string | null {
  let rest = text;
  const typed: Partial<Record<"YYYY" | "MM" | "DD", number>> = {};
  for (const token of format.split(DATE_PARTS).filter(Boolean)) {
    if (token === "YYYY" || token === "MM" || token === "DD") {
      const match = (token === "YYYY" ? /\d{1,4}/ : /\d{1,2}/).exec(rest);
      if (!match) continue;
      rest = rest.slice(match.index + match[0].length);
      const n = Number(match[0]);
      typed[token] = token === "YYYY" && match[0].length === 2 ? n + (n > 68 ? 1900 : 2000) : n;
    } else {
      const at = rest.indexOf(token);
      if (at >= 0) rest = rest.slice(at + token.length);
    }
  }
  const [thisYear = 0, thisMonth = 1, thisDay = 1] = today.split("-").map(Number);
  let [year, month, day] = [thisYear, thisMonth, thisDay];
  if (typed.YYYY !== undefined) {
    [year, month, day] = [typed.YYYY, typed.MM ?? 1, typed.DD ?? 1];
  } else if (typed.MM !== undefined) {
    [month, day] = [typed.MM, typed.DD ?? 1];
  } else if (typed.DD !== undefined) {
    day = typed.DD;
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
  if (Math.abs(year - thisYear) > 20) {
    year = thisYear;
    day = Math.min(day, daysIn(year, month));
  }
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}
