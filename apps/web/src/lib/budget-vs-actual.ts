import type { components } from "@strictbudget/api-client";
import {
  type BudgetMonth,
  type DelimitedCell,
  type MonthRange,
  NUMBER_FORMAT_SPECS,
  type NumberFormat,
  percentOf,
  plainAmount,
} from "@strictbudget/engine";
import { $api } from "./api";
import type { CategoryList } from "./categories";
import { todayIso } from "./dates";

export type BudgetVsActualReport = components["schemas"]["BudgetVsActual"];

/** The plan's numbers behind the report (`GET /reports/budget-vs-actual`). */
export const budgetVsActualOptions = (budgetId: string, range: MonthRange) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/reports/budget-vs-actual", {
    params: {
      path: { budgetId },
      query: { from: range.from, to: range.to, today: todayIso() },
    },
  });

/**
 * Where spending ended against what was assigned: under (spent less), on (exactly what was
 * assigned) or over plan. Exact: no tolerance either way.
 */
export type PlanStatus = "under" | "on" | "over";

export const planStatus = (assigned: bigint, spent: bigint): PlanStatus =>
  spent < assigned ? "under" : spent === assigned ? "on" : "over";

/** A heatmap cell: spent − assigned, and whether the month ended overspent (as the plan colours it). */
export interface HeatCell {
  month: BudgetMonth;
  /** Positive: over plan. */
  variance: bigint;
  overspent: "cash" | "credit" | null;
}

export interface VarianceRow {
  categoryId: string;
  name: string;
  hidden: boolean;
  uncategorized: boolean;
  assigned: bigint;
  /** −Activity: refunds net in, so it can be negative. */
  spent: bigint;
  /** What the target asks of the range's months; null without a target asking anything. */
  target: bigint | null;
  status: PlanStatus;
  /** Months of the last 12 (to the range's end) that spent more than was assigned. */
  overMonths: number;
  /** How many of those 12 months the plan has (fewer for a young plan). */
  historyMonths: number;
  cells: HeatCell[];
}

export interface VarianceGroup {
  groupId: string;
  name: string;
  assigned: bigint;
  spent: bigint;
  status: PlanStatus;
  rows: VarianceRow[];
}

export interface BudgetVsActual {
  /** The heatmap's months (the range, reaching back to 12). */
  months: BudgetMonth[];
  groups: VarianceGroup[];
  assigned: bigint;
  spent: bigint;
}

/** Spent − assigned: how far over plan (negative: under). Sorting key, most over first. */
const variance = (r: { assigned: bigint; spent: bigint }) => r.spent - r.assigned;
const byVariance = (
  a: { assigned: bigint; spent: bigint },
  b: { assigned: bigint; spent: bigint },
) => (variance(b) > variance(a) ? 1 : variance(b) < variance(a) ? -1 : 0);

/**
 * The report's rows for `range`: each listed category's Assigned and spending summed over the
 * range, grouped by category group (Uncategorized first, then groups and the categories in them
 * most over plan first, ties in plan order), the heatmap's cells and the over-plan count of the
 * last 12 months. `categoryIds` narrows the rows (undefined: all).
 */
export function budgetVsActual(
  report: BudgetVsActualReport,
  list: CategoryList,
  range: MonthRange,
  categoryIds?: readonly string[],
): BudgetVsActual {
  const months = report.months as BudgetMonth[];
  const lastTwelve = months.slice(-12);
  const names = new Map<string, string>([[list.uncategorizedCategoryId, "Uncategorized"]]);
  const groupNames = new Map<string, string>();
  for (const g of list.groups) {
    groupNames.set(g.id, g.name);
    for (const c of g.categories) names.set(c.id, c.name);
  }
  const keep = categoryIds && new Set(categoryIds);
  const groups = new Map<string, VarianceGroup>();
  for (const category of report.categories) {
    if (keep && !keep.has(category.categoryId)) continue;
    let assigned = 0n;
    let spent = 0n;
    let target: bigint | null = null;
    let overMonths = 0;
    let historyMonths = 0;
    const cells: HeatCell[] = [];
    for (const m of category.months) {
      const month = m.month as BudgetMonth;
      const monthAssigned = BigInt(m.assigned);
      const monthSpent = -BigInt(m.activity);
      if (month >= range.from && month <= range.to) {
        assigned += monthAssigned;
        spent += monthSpent;
        if (m.targetAmount !== null && BigInt(m.targetAmount) > 0n) {
          target = (target ?? 0n) + BigInt(m.targetAmount);
        }
      }
      // Months before the plan began aren't counted (the API leaves them out too).
      if (month >= report.firstMonth && lastTwelve.includes(month)) {
        historyMonths++;
        if (monthSpent > monthAssigned) overMonths++;
      }
      cells.push({
        month,
        variance: monthSpent - monthAssigned,
        overspent:
          BigInt(m.cashOverspent) < 0n ? "cash" : BigInt(m.creditOverspent) < 0n ? "credit" : null,
      });
    }
    // Listed only when the range itself has something; the heatmap's earlier months alone don't.
    if (!category.months.some(activeIn(range))) continue;
    const row: VarianceRow = {
      categoryId: category.categoryId,
      name: names.get(category.categoryId) ?? "Unknown category",
      hidden: category.hidden,
      uncategorized: category.uncategorized,
      assigned,
      spent,
      target,
      status: planStatus(assigned, spent),
      overMonths,
      historyMonths,
      cells,
    };
    const groupId = category.uncategorized ? "uncategorized" : category.groupId;
    const group = groups.get(groupId) ?? {
      groupId,
      name: category.uncategorized ? "Uncategorized" : (groupNames.get(groupId) ?? "Other"),
      assigned: 0n,
      spent: 0n,
      status: "on" as PlanStatus,
      rows: [],
    };
    group.assigned += assigned;
    group.spent += spent;
    group.rows.push(row);
    groups.set(groupId, group);
  }
  const sorted = [...groups.values()].map((g) => ({
    ...g,
    status: planStatus(g.assigned, g.spent),
    // Array.prototype.sort is stable, so ties keep plan order.
    rows: [...g.rows].sort(byVariance),
  }));
  const uncategorized = sorted.filter((g) => g.groupId === "uncategorized");
  const rest = sorted.filter((g) => g.groupId !== "uncategorized").sort(byVariance);
  const all = [...uncategorized, ...rest];
  return {
    months,
    groups: all,
    assigned: all.reduce((sum, g) => sum + g.assigned, 0n),
    spent: all.reduce((sum, g) => sum + g.spent, 0n),
  };
}

/** A month of the range with something assigned or spent. */
const activeIn =
  (range: MonthRange) => (m: { month: string; assigned: string; activity: string }) =>
    m.month >= range.from && m.month <= range.to && (m.assigned !== "0" || m.activity !== "0");

/** Spent as a share of Assigned, one decimal; null when nothing was assigned. Display only. */
export const percentOfPlan = (spent: bigint, assigned: bigint) => percentOf(spent, assigned);

/** "3 of 12": months over plan of the months counted. */
export const overMonthsLabel = (row: Pick<VarianceRow, "overMonths" | "historyMonths">) =>
  `${row.overMonths} of ${row.historyMonths}`;

/** The variance table as CSV/TSV rows: one per category, then each group's total and the total. */
export function exportRows(
  report: BudgetVsActual,
  numberFormat: NumberFormat,
  exponent: number,
): DelimitedCell[][] {
  const amount = (a: bigint): DelimitedCell => ({ raw: plainAmount(a, exponent, numberFormat) });
  const { decimal } = NUMBER_FORMAT_SPECS[numberFormat];
  const percent = (spent: bigint, assigned: bigint): DelimitedCell => {
    const p = percentOfPlan(spent, assigned);
    return { raw: p === null ? "" : p.toFixed(1).replace(".", decimal) };
  };
  const header = [
    "Category Group",
    "Category",
    "Assigned",
    "Spent",
    "Difference",
    "% of Plan",
    "Target",
    "Months Over Plan (last 12)",
  ];
  const rows: DelimitedCell[][] = [header];
  for (const g of report.groups) {
    for (const r of g.rows) {
      rows.push([
        r.uncategorized ? "" : g.name,
        r.name,
        amount(r.assigned),
        amount(r.spent),
        amount(r.assigned - r.spent),
        percent(r.spent, r.assigned),
        r.target === null ? { raw: "" } : amount(r.target),
        overMonthsLabel(r),
      ]);
    }
    rows.push([
      `Total ${g.name}`,
      "",
      amount(g.assigned),
      amount(g.spent),
      amount(g.assigned - g.spent),
      percent(g.spent, g.assigned),
      { raw: "" },
      "",
    ]);
  }
  rows.push([
    "Total",
    "",
    amount(report.assigned),
    amount(report.spent),
    amount(report.assigned - report.spent),
    percent(report.spent, report.assigned),
    { raw: "" },
    "",
  ]);
  return rows;
}

export const exportName = (today: string, delimiter: string) =>
  `strictbudget-budget-vs-actual-${today}.${delimiter === "\t" ? "tsv" : "csv"}`;
