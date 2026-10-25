import type { NumberFormat } from "./format-settings";
import { NUMBER_FORMAT_SPECS } from "./format-settings";
import { addMonths, type BudgetMonth } from "./months";
import { divideRounded } from "./rounding";

/** An inclusive range of budget months. */
export interface MonthRange {
  from: BudgetMonth;
  to: BudgetMonth;
}

/** Report date presets; any other range is a custom one. */
export const REPORT_PRESETS = [
  "this_month",
  "last_3_months",
  "last_6_months",
  "last_12_months",
  "year_to_date",
  "last_year",
  "all_dates",
] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

/**
 * The months a preset covers, counting back from `current` (the user's month). "All dates" starts
 * at the budget's first month with a transaction (`earliest`), or `current` when there's none.
 */
export function presetRange(
  preset: ReportPreset,
  current: BudgetMonth,
  earliest: BudgetMonth | null = null,
): MonthRange {
  const year = current.slice(0, 4);
  switch (preset) {
    case "this_month":
      return { from: current, to: current };
    case "last_3_months":
      return { from: addMonths(current, -2), to: current };
    case "last_6_months":
      return { from: addMonths(current, -5), to: current };
    case "last_12_months":
      return { from: addMonths(current, -11), to: current };
    case "year_to_date":
      return { from: `${year}-01`, to: current };
    case "last_year": {
      const last = String(Number(year) - 1).padStart(4, "0");
      return { from: `${last}-01`, to: `${last}-12` };
    }
    case "all_dates":
      return { from: earliest && earliest < current ? earliest : current, to: current };
  }
}

/** The preset that gives exactly `range` (checked in REPORT_PRESETS' order), if any. */
export function presetOf(
  range: MonthRange,
  current: BudgetMonth,
  earliest: BudgetMonth | null = null,
): ReportPreset | undefined {
  return REPORT_PRESETS.find((p) => {
    const r = presetRange(p, current, earliest);
    return r.from === range.from && r.to === range.to;
  });
}

export function monthsIn(range: MonthRange): BudgetMonth[] {
  const months: BudgetMonth[] = [];
  for (let m = range.from; m <= range.to; m = addMonths(m, 1)) months.push(m);
  return months;
}

export function shiftRange(range: MonthRange, count: number): MonthRange {
  return { from: addMonths(range.from, count), to: addMonths(range.to, count) };
}

/**
 * The previous period of the same length, the same months a year earlier, or the average month
 * over the N months before the range.
 */
export const REPORT_COMPARISONS = [
  "previous_period",
  "last_year",
  "average_3",
  "average_6",
  "average_12",
] as const;
export type ReportComparison = (typeof REPORT_COMPARISONS)[number];

export interface ComparisonRange extends MonthRange {
  /**
   * Whether the comparison is one average month (the average modes), to set against each month of
   * the range, rather than a period of the same length, set month by month or as a whole.
   */
  average: boolean;
}

export function comparisonRange(range: MonthRange, comparison: ReportComparison): ComparisonRange {
  const length = monthsIn(range).length;
  switch (comparison) {
    case "previous_period":
      return { ...shiftRange(range, -length), average: false };
    case "last_year":
      return { ...shiftRange(range, -12), average: false };
    default: {
      const n = Number(comparison.slice("average_".length));
      return { from: addMonths(range.from, -n), to: addMonths(range.from, -1), average: true };
    }
  }
}

/**
 * An average of `total` over `count` (months, days), rounded half away from zero to the minor
 * unit (−$5,732.00 over 3 months = −$1,910.67).
 */
export function averageOf(total: bigint, count: number): bigint {
  if (count <= 0) return 0n;
  return divideRounded(total, BigInt(count), "half-up");
}

/** `part` as a share of `whole` in percent, for display only; null when `whole` is zero. */
export function percentOf(part: bigint, whole: bigint): number | null {
  if (whole === 0n) return null;
  // Basis points keep two decimals exact before the one conversion to a number.
  return Number(divideRounded(part * 10000n, whole, "half-up")) / 100;
}

/**
 * Spending Breakdown's share label: a rounded whole percent of the gross
 * outflows ($2,832 of $3,653 is "78%"), "<1%" for anything under one percent before rounding
 * ($30 of $3,653), nothing for a category that spent nothing.
 */
export function shareLabel(spent: bigint, grossOutflows: bigint): string {
  if (spent <= 0n || grossOutflows <= 0n) return "";
  if (spent * 100n < grossOutflows) return "<1%";
  return `${divideRounded(spent * 100n, grossOutflows, "half-up")}%`;
}

/** A change from `previous` to `current`, its percent of |previous| for display (null from zero). */
export function changeOf(
  current: bigint,
  previous: bigint,
): { amount: bigint; percent: number | null } {
  const amount = current - previous;
  return { amount, percent: percentOf(amount, previous < 0n ? -previous : previous) };
}

export interface SpendingRow<K> {
  key: K;
  /** The net of the row's lines: negative is money spent, positive money that came back. */
  net: bigint;
}

export interface SpendingSplit<K> {
  /** Rows that spent money or broke even (net ≤ 0), most spent first. */
  spending: SpendingRow<K>[];
  /** Rows whose inflows beat their outflows, smallest first. */
  positive: SpendingRow<K>[];
  /** What the spending rows spent, as a positive amount (the base for their shares). */
  grossOutflows: bigint;
  positiveInflows: bigint;
  /** Total spending, as a positive amount: what was spent less the positive rows. */
  total: bigint;
}

/** Splits per-category (or per-group) nets into Spending Breakdown's two lists and totals. */
export function splitSpending<K>(rows: readonly SpendingRow<K>[]): SpendingSplit<K> {
  const spending = rows.filter((r) => r.net <= 0n).sort((a, b) => cmp(a.net, b.net));
  const positive = rows.filter((r) => r.net > 0n).sort((a, b) => cmp(a.net, b.net));
  const grossOutflows = -spending.reduce((s, r) => s + r.net, 0n);
  const positiveInflows = positive.reduce((s, r) => s + r.net, 0n);
  return {
    spending,
    positive,
    grossOutflows,
    positiveInflows,
    total: grossOutflows - positiveInflows,
  };
}

const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/** A cell for `toDelimited`: text is quoted, `{ raw }` (numbers) is written as is. */
export type DelimitedCell = string | { raw: string };

/**
 * CSV or TSV text for an export: every text cell quoted, numbers bare, a
 * byte-order mark first so spreadsheets read UTF-8, lines joined by "\n" with no trailing newline.
 */
export function toDelimited(rows: readonly (readonly DelimitedCell[])[], delimiter: "," | "\t") {
  const cell = (c: DelimitedCell) =>
    typeof c === "string" ? `"${c.replaceAll('"', '""')}"` : c.raw;
  return `\uFEFF${rows.map((r) => r.map(cell).join(delimiter)).join("\n")}`;
}

export function exportDelimiter(numberFormat: NumberFormat): "," | "\t" {
  return NUMBER_FORMAT_SPECS[numberFormat].decimal === "," ? "\t" : ",";
}

/**
 * A plain signed amount for an export ("-130.00", "2,00"): no symbol or grouping, the number
 * format's decimal mark, all of the currency's decimals.
 */
export function plainAmount(amount: bigint, exponent: number, numberFormat: NumberFormat): string {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  const mark = NUMBER_FORMAT_SPECS[numberFormat].decimal;
  return `${negative ? "-" : ""}${whole}${exponent ? `${mark}${fraction}` : ""}`;
}
