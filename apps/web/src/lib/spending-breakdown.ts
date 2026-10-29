import {
  averageOf,
  type BudgetMonth,
  type ComparisonRange,
  changeOf,
  currencyExponent,
  type DelimitedCell,
  type MonthRange,
  monthBounds,
  monthsIn,
  type NumberFormat,
  plainAmount,
  shareLabel,
  splitSpending,
} from "@strictbudget/engine";
import { z } from "zod";
import type { CategoryList } from "./categories";
import { COLOR_LABEL, type Flag, type FlagColor, flagName } from "./flags";
import {
  monthLabel,
  planColors,
  type ReportSum,
  type ReportTransaction,
  reportColor,
  reportSearchSchema,
  UNCATEGORIZED_COLOR,
} from "./reports";

/**
 * What Spending Breakdown's rows are: categories or groups, or the payee, account and flag
 * breakdowns.
 */
export const BREAKDOWN_BY = ["category", "group", "payee", "account", "flag"] as const;
export type BreakdownBy = (typeof BREAKDOWN_BY)[number];

export const BREAKDOWN_LABELS: Record<BreakdownBy, { one: string; many: string }> = {
  category: { one: "Category", many: "Categories" },
  group: { one: "Group", many: "Groups" },
  payee: { one: "Payee", many: "Payees" },
  account: { one: "Account", many: "Accounts" },
  flag: { one: "Flag", many: "Flags" },
};

export const spendingBreakdownSearchSchema = reportSearchSchema.extend({
  by: z.enum(BREAKDOWN_BY).optional().catch(undefined),
  chart: z.enum(["donut", "treemap"]).optional().catch(undefined),
  /** The category group opened from the Groups breakdown ("uncategorized" for Uncategorized). */
  group: z.string().optional().catch(undefined),
});
export type SpendingBreakdownSearch = z.infer<typeof spendingBreakdownSearchSchema>;

/** The key standing for Uncategorized as a group, and for "no payee" / "no flag". */
export const UNCATEGORIZED_GROUP = "uncategorized";
export const NONE = "none";

export interface BreakdownRow {
  key: string;
  name: string;
  color: string;
  /** For a category: its group, which the treemap nests it in. */
  groupKey?: string;
  groupName?: string;
  /** Net of the row's lines: negative is spending. */
  net: bigint;
  /** Lines summed. */
  count: number;
}

export interface BreakdownNames {
  categories: CategoryList | undefined;
  payees: readonly { id: string; name: string }[];
  accounts: readonly { id: string; name: string }[];
  flags: readonly Flag[];
}

/** The plan's categories in order, Uncategorized first, each with its group and plan index. */
export function planCategories(list: CategoryList | undefined) {
  const out: {
    id: string;
    name: string;
    groupKey: string;
    groupName: string;
    index: number;
    groupIndex: number;
    color: string;
    groupColor: string;
  }[] = [];
  if (!list) return out;
  const colors = planColors(list);
  out.push({
    id: list.uncategorizedCategoryId,
    name: "Uncategorized",
    groupKey: UNCATEGORIZED_GROUP,
    groupName: "Uncategorized",
    index: 0,
    groupIndex: 0,
    color: UNCATEGORIZED_COLOR,
    groupColor: UNCATEGORIZED_COLOR,
  });
  list.groups.forEach((g, gi) => {
    for (const c of g.categories) {
      out.push({
        id: c.id,
        name: c.name,
        groupKey: g.id,
        groupName: g.name,
        index: out.length,
        groupIndex: gi + 1,
        color: colors.categories.get(c.id) ?? UNCATEGORIZED_COLOR,
        groupColor: colors.groups.get(g.id) ?? UNCATEGORIZED_COLOR,
      });
    }
  });
  return out;
}

const keyOf = (sum: ReportSum, by: Exclude<BreakdownBy, "group">) => {
  const value =
    by === "category"
      ? sum.categoryId
      : by === "payee"
        ? sum.payeeId
        : by === "account"
          ? sum.accountId
          : sum.flag;
  return value ?? NONE;
};

/**
 * The breakdown's rows from the API's sums: `sums` grouped by category for the category and group
 * breakdowns (groups are summed here, so both read one request), else by payee, account or flag.
 * `group` keeps only that group's categories (the Groups breakdown opened on one group).
 */
export function breakdownRows(
  sums: readonly ReportSum[],
  by: BreakdownBy,
  names: BreakdownNames,
  group?: string,
): BreakdownRow[] {
  if (by === "category" || by === "group") {
    const plan = new Map(planCategories(names.categories).map((c) => [c.id, c]));
    const rows = new Map<string, BreakdownRow>();
    for (const sum of sums) {
      const id = sum.categoryId ?? NONE;
      const c = plan.get(id);
      const groupKey = c?.groupKey ?? NONE;
      if (group !== undefined && groupKey !== group) continue;
      const key = by === "group" && group === undefined ? groupKey : id;
      const row = rows.get(key) ?? {
        key,
        name: by === "group" && group === undefined ? (c?.groupName ?? "") : (c?.name ?? ""),
        // The same colour in every report (planColors).
        color:
          (by === "group" && group === undefined ? c?.groupColor : c?.color) ?? UNCATEGORIZED_COLOR,
        ...(c && { groupKey: c.groupKey, groupName: c.groupName }),
        net: 0n,
        count: 0,
      };
      row.net += BigInt(sum.net);
      row.count += sum.count;
      rows.set(key, row);
    }
    return [...rows.values()];
  }
  const label = (key: string) => {
    if (by === "payee")
      return key === NONE ? "No payee" : (names.payees.find((p) => p.id === key)?.name ?? "");
    if (by === "account") return names.accounts.find((a) => a.id === key)?.name ?? "";
    return flagName(key === NONE ? null : (key as FlagColor), names.flags);
  };
  return sums.map((sum, index) => {
    const key = keyOf(sum, by);
    return {
      key,
      name: label(key),
      color: reportColor(index),
      net: BigInt(sum.net),
      count: sum.count,
    };
  });
}

// Plain code-point comparison, so ties order L1, T5, 😌, 🩺.
const byName = (a: BreakdownRow, b: BreakdownRow) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

export interface Breakdown {
  /** Rows that spent or broke even, most spent first (ties by name). */
  spending: BreakdownRow[];
  /** Rows whose inflows beat their outflows, smallest first (ties by name). */
  positive: BreakdownRow[];
  grossOutflows: bigint;
  positiveInflows: bigint;
  /** Total Spending, positive. */
  total: bigint;
}

export function breakdownOf(rows: readonly BreakdownRow[]): Breakdown {
  const split = splitSpending(rows.map((r) => ({ key: r, net: r.net })));
  return {
    spending: split.spending.map((r) => r.key).sort((a, b) => cmp(a.net, b.net) || byName(a, b)),
    positive: split.positive.map((r) => r.key).sort((a, b) => cmp(a.net, b.net) || byName(a, b)),
    grossOutflows: split.grossOutflows,
    positiveInflows: split.positiveInflows,
    total: split.total,
  };
}

/** Days in the range's months, whole months even mid-month (for Average Daily Spending). */
export function daysIn(range: MonthRange): number {
  return monthsIn(range).reduce((days, m) => days + Number(monthBounds(m).end.slice(8)), 0);
}

export interface BreakdownStats {
  total: bigint;
  averageMonthly: bigint;
  averageDaily: bigint;
  /** The row with the most lines (ties: the one that spent more, then by name). */
  mostFrequent: BreakdownRow | undefined;
}

export function breakdownStats(breakdown: Breakdown, range: MonthRange): BreakdownStats {
  const rows = [...breakdown.spending, ...breakdown.positive];
  const mostFrequent = rows.reduce<BreakdownRow | undefined>(
    (best, r) =>
      r.count > 0 &&
      (!best ||
        r.count > best.count ||
        (r.count === best.count &&
          (r.net < best.net || (r.net === best.net && byName(r, best) < 0))))
        ? r
        : best,
    undefined,
  );
  return {
    total: breakdown.total,
    averageMonthly: averageOf(breakdown.total, monthsIn(range).length),
    averageDaily: averageOf(breakdown.total, daysIn(range)),
    mostFrequent,
  };
}

/** A row's share labels: of the gross outflows and of income. */
export function shares(row: BreakdownRow, breakdown: Breakdown, income: bigint | undefined) {
  const spent = -row.net;
  return {
    ofTotal: shareLabel(spent, breakdown.grossOutflows),
    ofIncome: income === undefined ? "" : shareLabel(spent, income),
  };
}

/**
 * What each row spent in the comparison period, keyed like the rows: the period's spending, or for
 * an average comparison, the average month times the range's months.
 */
export function comparedSpending(
  rows: readonly BreakdownRow[],
  comparison: ComparisonRange,
  range: MonthRange,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const months = monthsIn(comparison).length;
  const length = BigInt(monthsIn(range).length);
  for (const r of rows) {
    out.set(r.key, comparison.average ? -averageOf(r.net, months) * length : -r.net);
  }
  return out;
}

/** A row's change against its comparison spending (missing = nothing spent then). */
export function rowChange(row: BreakdownRow, previous: Map<string, bigint>) {
  const before = previous.get(row.key) ?? 0n;
  return { before, ...changeOf(-row.net, before) };
}

/**
 * The summary file's rows: header "Category Group","Category", one column per month, "Average",
 * "Total"; a row per category with lines in the range, in plan order (Uncategorized as
 * "","Uncategorized"), plain signed amounts. `sums` are grouped by category and month.
 */
export function summaryExportRows(
  sums: readonly ReportSum[],
  categories: CategoryList,
  range: MonthRange,
  numberFormat: NumberFormat,
  currency: Parameters<typeof currencyExponent>[0],
): DelimitedCell[][] {
  const months = monthsIn(range);
  const exponent = currencyExponent(currency);
  const amount = (a: bigint) => ({ raw: plainAmount(a, exponent, numberFormat) });
  const byCategory = new Map<string, Map<BudgetMonth, bigint>>();
  for (const s of sums) {
    const id = s.categoryId ?? NONE;
    const perMonth = byCategory.get(id) ?? new Map<BudgetMonth, bigint>();
    const month = s.month ?? "";
    perMonth.set(month, (perMonth.get(month) ?? 0n) + BigInt(s.net));
    byCategory.set(id, perMonth);
  }
  const rows: DelimitedCell[][] = [
    ["Category Group", "Category", ...months.map((m) => monthLabel(m)), "Average", "Total"],
  ];
  for (const c of planCategories(categories)) {
    const perMonth = byCategory.get(c.id);
    if (!perMonth) continue;
    const values = months.map((m) => perMonth.get(m) ?? 0n);
    const total = values.reduce((a, b) => a + b, 0n);
    rows.push([
      c.groupKey === UNCATEGORIZED_GROUP ? "" : c.groupName,
      c.name,
      ...values.map(amount),
      amount(averageOf(total, months.length)),
      amount(total),
    ]);
  }
  return rows;
}

const CLEARED_LABELS = {
  uncleared: "Uncleared",
  cleared: "Cleared",
  reconciled: "Reconciled",
} as const;

/**
 * The transactions file's rows: Account, Flag (the colour's name), Date (the budget's format),
 * Payee, "Group: Category", Group, Category (all empty when uncategorized), Memo, Outflow and Inflow
 * (formatted with the symbol), Cleared.
 */
export function transactionsExportRows(
  lines: readonly ReportTransaction[],
  uncategorizedId: string,
  formatDate: (iso: string) => string,
  format: (amount: bigint) => string,
): DelimitedCell[][] {
  const rows: DelimitedCell[][] = [
    [
      "Account",
      "Flag",
      "Date",
      "Payee",
      "Category Group/Category",
      "Category Group",
      "Category",
      "Memo",
      "Outflow",
      "Inflow",
      "Cleared",
    ],
  ];
  for (const t of lines) {
    const amount = BigInt(t.amount);
    const categorized = t.categoryId !== null && t.categoryId !== uncategorizedId;
    const group = categorized ? (t.groupName ?? "") : "";
    const category = categorized ? (t.categoryName ?? "") : "";
    rows.push([
      t.accountName,
      t.flag ? COLOR_LABEL[t.flag] : "",
      formatDate(t.date),
      t.payeeName ?? "",
      categorized ? `${group}: ${category}` : "",
      group,
      category,
      t.memo,
      { raw: format(amount < 0n ? -amount : 0n) },
      { raw: format(amount > 0n ? amount : 0n) },
      CLEARED_LABELS[t.cleared],
    ]);
  }
  return rows;
}

export const exportNames = (today: string) => ({
  summary: `strictbudget-spending-breakdown-${today}.csv`,
  transactions: `strictbudget-spending-breakdown-${today}-transactions.csv`,
  zip: `strictbudget-spending-breakdown-${today}.zip`,
});
