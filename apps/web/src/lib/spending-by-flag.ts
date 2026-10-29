import {
  type BudgetMonth,
  currencyExponent,
  type DelimitedCell,
  type MonthRange,
  monthsIn,
  type NumberFormat,
  plainAmount,
} from "@strictbudget/engine";
import { z } from "zod";
import type { CategoryList } from "./categories";
import { FLAG_COLOR, FLAG_ORDER, type Flag, type FlagColor, flagName } from "./flags";
import { type ReportSum, reportSearchSchema } from "./reports";
import { type BreakdownRow, NONE, planCategories, UNCATEGORIZED_GROUP } from "./spending-breakdown";

export const spendingByFlagSearchSchema = reportSearchSchema.extend({
  /** The flag opened on its own ("none" for unflagged spending). */
  flag: z
    .string()
    .refine((key) => key === NONE || FLAG_ORDER.includes(key as FlagColor))
    .optional()
    .catch(undefined),
  /** The monthly card's chart or table. */
  months: z.enum(["chart", "table"]).optional().catch(undefined),
});
export type SpendingByFlagSearch = z.infer<typeof spendingByFlagSearchSchema>;

/** A flag (or "none") as the URL and the API's `flags` filter spell it. */
export const flagKey = (flag: FlagColor | null) => flag ?? NONE;
export const flagOfKey = (key: string) => (key === NONE ? null : (key as FlagColor));

/**
 * The flags' rows from sums grouped by flag: one per flag that has a custom name or lines in the
 * range, in the app's flag order, each in its own colour; unflagged lines aside. The rows are
 * keyed by a plain string so another dimension (tags, #52) can reuse the same view.
 */
export function flagRows(
  sums: readonly ReportSum[],
  flags: readonly Flag[],
): { rows: BreakdownRow[]; unflagged: { net: bigint; count: number } } {
  const by = new Map<string, { net: bigint; count: number }>();
  for (const s of sums) {
    const key = flagKey(s.flag ?? null);
    const row = by.get(key) ?? { net: 0n, count: 0 };
    row.net += BigInt(s.net);
    row.count += s.count;
    by.set(key, row);
  }
  const named = new Set(flags.filter((f) => f.name).map((f) => f.color));
  const rows = FLAG_ORDER.filter((color) => by.has(color) || named.has(color)).map((color) => ({
    key: color,
    name: flagName(color, flags),
    color: FLAG_COLOR[color],
    net: by.get(color)?.net ?? 0n,
    count: by.get(color)?.count ?? 0,
  }));
  return { rows, unflagged: by.get(NONE) ?? { net: 0n, count: 0 } };
}

export interface MonthBar {
  month: BudgetMonth;
  /** Spending, positive; a month of refunds is negative. */
  spent: bigint;
  count: number;
}

/** Every month of the range with what it spent (sums grouped by month), oldest first. */
export function monthBars(sums: readonly ReportSum[], range: MonthRange): MonthBar[] {
  const by = new Map<string, ReportSum>();
  for (const s of sums) if (s.month) by.set(s.month, s);
  return monthsIn(range).map((month) => {
    const s = by.get(month);
    return { month, spent: s ? -BigInt(s.net) : 0n, count: s?.count ?? 0 };
  });
}

/**
 * The export's rows: header Flag, Category Group, Category, Spending, Transactions; one row per
 * flag and category with lines in the range (sums grouped by flag and category), flags in the
 * app's order with "No flag" last, categories in plan order. Spending is positive, refunds negative.
 */
export function exportRows(
  sums: readonly ReportSum[],
  flags: readonly Flag[],
  categories: CategoryList,
  numberFormat: NumberFormat,
  currency: Parameters<typeof currencyExponent>[0],
): DelimitedCell[][] {
  const exponent = currencyExponent(currency);
  const plan = planCategories(categories);
  const order = new Map(plan.map((c, i) => [c.id, i]));
  const flagIndex = (f: FlagColor | null) =>
    f === null ? FLAG_ORDER.length : FLAG_ORDER.indexOf(f);
  const sorted = [...sums].sort(
    (a, b) =>
      flagIndex(a.flag ?? null) - flagIndex(b.flag ?? null) ||
      (order.get(a.categoryId ?? "") ?? 0) - (order.get(b.categoryId ?? "") ?? 0),
  );
  const rows: DelimitedCell[][] = [
    ["Flag", "Category Group", "Category", "Spending", "Transactions"],
  ];
  for (const s of sorted) {
    const c = plan[order.get(s.categoryId ?? "") ?? -1];
    rows.push([
      flagName(s.flag ?? null, flags),
      !c || c.groupKey === UNCATEGORIZED_GROUP ? "" : c.groupName,
      c?.name ?? "Uncategorized",
      { raw: plainAmount(-BigInt(s.net), exponent, numberFormat) },
      { raw: String(s.count) },
    ]);
  }
  return rows;
}

export const exportName = (today: string, delimiter: string) =>
  `strictbudget-spending-by-flag-${today}.${delimiter === "\t" ? "tsv" : "csv"}`;
