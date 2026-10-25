import {
  averageOf,
  type BudgetMonth,
  type DelimitedCell,
  type NumberFormat,
  percentOf,
  plainAmount,
  toDelimited,
} from "@strictbudget/engine";
import { useCallback, useState } from "react";
import { monthLabel } from "./reports";

/**
 * The Income v Expense table:
 * - Income: Ready to Assign lines (no starting balances) per payee under "All Income Sources",
 *   alphabetical ignoring case, "[No Payee]" for lines without one; then "Total All Income
 *   Sources" and "Total Income". The category filter doesn't touch it, the account filter does.
 * - Expense: "Uncategorized Transactions" first, then each group in budget order with its
 *   categories in budget order (hidden ones too), each a net (inflows positive), and "Total
 *   <Group>"; then "Total Expenses" and "Net Income" = income + expenses.
 * - Only rows with activity in the range are listed (a category netting $0.00 with lines is).
 * - Each row has a cell per month, an Average (the total over the months, half away from zero)
 *   and a Total.
 */

export interface RowValues {
  months: bigint[];
  average: bigint;
  total: bigint;
}

export interface IncomeRow {
  /** null: lines with no payee ("[No Payee]"). */
  payeeId: string | null;
  name: string;
  values: RowValues;
}

export interface CategoryRow {
  categoryId: string;
  name: string;
  values: RowValues;
}

export interface GroupRows {
  groupId: string;
  name: string;
  categories: CategoryRow[];
  total: RowValues;
}

export interface IncomeExpenseTable {
  months: BudgetMonth[];
  income: IncomeRow[];
  /** "Total All Income Sources", which is also "Total Income". */
  totalIncome: RowValues;
  /** "Uncategorized Transactions", when it had activity. */
  uncategorized: CategoryRow | null;
  groups: GroupRows[];
  totalExpenses: RowValues;
  netIncome: RowValues;
  /**
   * Savings rate (net income ÷ income) per month, then Average and Total, in percent for display
   * only; null when there's no income to divide by.
   */
  savingsRate: { months: (number | null)[]; average: number | null; total: number | null };
}

/** A sum from `GET /reports/activity` (amounts are integer strings). */
interface Sum {
  month?: string | null;
  categoryId?: string | null;
  payeeId?: string | null;
  net: string;
}

export interface IncomeExpenseInput {
  months: readonly BudgetMonth[];
  /** Income sums grouped by month and payee. */
  income: readonly Sum[];
  /** Spending sums grouped by month and category. */
  expenses: readonly Sum[];
  payees: readonly { id: string; name: string }[];
  /** The plan's groups in order (no internal or payment groups), categories in order. */
  groups: readonly {
    id: string;
    name: string;
    categories: readonly { id: string; name: string }[];
  }[];
  uncategorizedCategoryId: string;
}

export const NO_PAYEE = "[No Payee]";
export const UNCATEGORIZED = "Uncategorized Transactions";

export function rowValues(months: bigint[]): RowValues {
  const total = months.reduce((s, v) => s + v, 0n);
  return { months, average: averageOf(total, months.length), total };
}

const addValues = (rows: readonly RowValues[], count: number) =>
  rowValues(
    Array.from({ length: count }, (_, i) => rows.reduce((s, r) => s + (r.months[i] ?? 0n), 0n)),
  );

/** Sums `sums` per key, one cell per month; only keys with a sum are present. */
function perMonth(
  sums: readonly Sum[],
  months: readonly BudgetMonth[],
  key: (s: Sum) => string,
): Map<string, bigint[]> {
  const index = new Map(months.map((m, i) => [m as string, i]));
  const out = new Map<string, bigint[]>();
  for (const s of sums) {
    const i = s.month ? index.get(s.month) : undefined;
    if (i === undefined) continue;
    const k = key(s);
    const cells = out.get(k) ?? months.map(() => 0n);
    cells[i] = (cells[i] ?? 0n) + BigInt(s.net);
    out.set(k, cells);
  }
  return out;
}

const NONE = "";

export function buildIncomeExpense(input: IncomeExpenseInput): IncomeExpenseTable {
  const { months } = input;
  const names = new Map(input.payees.map((p) => [p.id, p.name]));
  const income = [...perMonth(input.income, months, (s) => s.payeeId ?? NONE)]
    .map(([id, cells]) => ({
      payeeId: id === NONE ? null : id,
      name: id === NONE ? NO_PAYEE : (names.get(id) ?? NO_PAYEE),
      values: rowValues(cells),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const totalIncome = addValues(
    income.map((r) => r.values),
    months.length,
  );

  const spent = perMonth(input.expenses, months, (s) => s.categoryId ?? NONE);
  const uncategorizedCells = spent.get(input.uncategorizedCategoryId);
  const uncategorized = uncategorizedCells
    ? {
        categoryId: input.uncategorizedCategoryId,
        name: UNCATEGORIZED,
        values: rowValues(uncategorizedCells),
      }
    : null;
  const groups: GroupRows[] = input.groups.flatMap((g) => {
    const categories = g.categories.flatMap((c) => {
      const cells = spent.get(c.id);
      return cells ? [{ categoryId: c.id, name: c.name, values: rowValues(cells) }] : [];
    });
    if (!categories.length) return [];
    return [
      {
        groupId: g.id,
        name: g.name,
        categories,
        total: addValues(
          categories.map((c) => c.values),
          months.length,
        ),
      },
    ];
  });
  // Every spending line counts, even one whose category isn't in the plan's list.
  const totalExpenses = addValues([...spent.values()].map(rowValues), months.length);
  const netIncome = addValues([totalIncome, totalExpenses], months.length);
  const rate = (net: bigint, inc: bigint) => (inc > 0n ? percentOf(net, inc) : null);
  return {
    months: [...months],
    income,
    totalIncome,
    uncategorized,
    groups,
    totalExpenses,
    netIncome,
    savingsRate: {
      months: netIncome.months.map((n, i) => rate(n, totalIncome.months[i] ?? 0n)),
      average: rate(netIncome.total, totalIncome.total),
      total: rate(netIncome.total, totalIncome.total),
    },
  };
}

/**
 * Export rows: "Category", the months ("Aug 2026"), "Average", "Total"; then "All Income Sources"
 * carrying the income total, each payee, "Total Income", "Uncategorized Transactions", each group as
 * a row carrying its total followed by its categories (no "Total <Group>" rows), "Total Expenses"
 * and "Net Income". Text quoted, amounts plain.
 */
export function incomeExpenseExportRows(
  table: IncomeExpenseTable,
  exponent: number,
  numberFormat: NumberFormat,
): DelimitedCell[][] {
  const row = (label: string, v: RowValues): DelimitedCell[] => [
    label,
    ...[...v.months, v.average, v.total].map((a) => ({
      raw: plainAmount(a, exponent, numberFormat),
    })),
  ];
  return [
    ["Category", ...table.months.map((m) => monthLabel(m)), "Average", "Total"],
    row("All Income Sources", table.totalIncome),
    ...table.income.map((r) => row(r.name, r.values)),
    row("Total Income", table.totalIncome),
    ...(table.uncategorized ? [row(UNCATEGORIZED, table.uncategorized.values)] : []),
    ...table.groups.flatMap((g) => [
      row(g.name, g.total),
      ...g.categories.map((c) => row(c.name, c.values)),
    ]),
    row("Total Expenses", table.totalExpenses),
    row("Net Income", table.netIncome),
  ];
}

/** The Income v Expense CSV (or TSV) has no byte-order mark. */
export function incomeExpenseExport(
  table: IncomeExpenseTable,
  exponent: number,
  numberFormat: NumberFormat,
  delimiter: "," | "\t",
) {
  return toDelimited(incomeExpenseExportRows(table, exponent, numberFormat), delimiter).replace(
    /^\uFEFF/,
    "",
  );
}

/**
 * How far a month's cell is from its row's average, for the heat shading (display only): positive
 * when it spent more than usual, negative when less, as a share of |average| capped at ±1; null
 * when the row has no average to compare with.
 */
export function heatOf(cell: bigint, average: bigint): number | null {
  if (average === 0n) return null;
  const share = percentOf(average - cell, average < 0n ? -average : average);
  if (share === null) return null;
  return Math.max(-1, Math.min(1, share / 100));
}

/**
 * The table's folded sections and groups, remembered by the browser: keys are "income",
 * "expense", "income-sources" and group ids.
 */
const COLLAPSE_KEY = "strictbudget:income-expense-collapse";

function readCollapsed(): Record<string, true> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, true>) : {};
  } catch {
    return {};
  }
}

export function useIncomeExpenseCollapse() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = useCallback((key: string) => {
    setCollapsed((current) => {
      const { [key]: was, ...rest } = current;
      const next: Record<string, true> = was ? rest : { ...current, [key]: true };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        // Blocked storage: the fold still applies until the page closes.
      }
      return next;
    });
  }, []);
  return [collapsed, toggle] as const;
}
