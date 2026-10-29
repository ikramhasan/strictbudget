import type { components } from "@strictbudget/api-client";
import {
  addMonths,
  type BudgetMonth,
  currencyExponent,
  type DelimitedCell,
  type MonthRange,
  type NumberFormat,
  plainAmount,
} from "@strictbudget/engine";
import { z } from "zod";
import { $api } from "./api";
import type { CategoryList } from "./categories";
import { todayIso } from "./dates";
import { monthLabel, reportSearchSchema } from "./reports";

export type CategoryHistory = components["schemas"]["CategoryHistory"];
export type CategoryHistoryMonth = components["schemas"]["CategoryHistoryMonth"];
export type CategoryHistoryMove = components["schemas"]["CategoryHistoryMove"];

export const categoryHistorySearchSchema = reportSearchSchema.extend({
  category: z.string().optional().catch(undefined),
  group: z.string().optional().catch(undefined),
});
export type CategoryHistorySearch = z.infer<typeof categoryHistorySearchSchema>;

/** One category or group, the report's subject. */
export type HistorySubject = { categoryId: string } | { groupId: string };

/** The plan's numbers for a category or group, month by month (`GET /reports/category-history`). */
export const categoryHistoryOptions = (
  budgetId: string,
  subject: HistorySubject,
  range: MonthRange,
) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/reports/category-history", {
    params: {
      path: { budgetId },
      query: { ...subject, from: range.from, to: range.to, today: todayIso() },
    },
  });

/** The inspector's compact chart: the 12 months ending with the inspected one. */
export const inspectorRange = (month: BudgetMonth): MonthRange => ({
  from: addMonths(month, -11),
  to: month,
});

/**
 * How a month ended: overspent in cash (the plan's red), on credit (its yellow) or not. For a
 * group, whether any of its categories did (cash first), even when the group's total is positive.
 */
export function overspentKind(m: CategoryHistoryMonth): "cash" | "credit" | null {
  if (BigInt(m.cashOverspent) < 0n) return "cash";
  if (BigInt(m.creditOverspent) < 0n) return "credit";
  return null;
}

/** What was overspent, cash and credit together (≤ 0). */
export const overspentBy = (m: CategoryHistoryMonth) =>
  BigInt(m.cashOverspent) + BigInt(m.creditOverspent);

/** What the picker offers: each spending group, then its categories (no card payments). */
export function pickerGroups(list: CategoryList) {
  return list.groups.filter((g) => !g.kind);
}

/** A category's name for a move's other side, or the deleted category's. */
export function moveCounterpart(move: CategoryHistoryMove, names: Map<string, string>) {
  if (move.otherCategoryId) return names.get(move.otherCategoryId) ?? "another category";
  return `deleted category ${move.otherDeletedCategory ?? ""}`.trim();
}

/** Every category's name by id, Uncategorized included. */
export function categoryNames(list: CategoryList) {
  const names = new Map<string, string>([[list.uncategorizedCategoryId, "Uncategorized"]]);
  for (const g of list.groups) for (const c of g.categories) names.set(c.id, c.name);
  return names;
}

/** The moves' net: what came in less what went out. */
export const movedNet = (m: CategoryHistoryMonth) =>
  m.moves.reduce((sum, v) => sum + BigInt(v.amount), 0n);

/**
 * The export's rows: Month, Assigned, Activity, Available, Target, Target Met, Moved; one row per
 * month, plain signed amounts (Target and Target Met empty without a target).
 */
export function exportRows(
  history: CategoryHistory,
  numberFormat: NumberFormat,
  currency: Parameters<typeof currencyExponent>[0],
): DelimitedCell[][] {
  const exponent = currencyExponent(currency);
  const amount = (a: string | bigint) => ({ raw: plainAmount(BigInt(a), exponent, numberFormat) });
  const rows: DelimitedCell[][] = [
    ["Month", "Assigned", "Activity", "Available", "Target", "Target Met", "Moved"],
  ];
  for (const m of history.months) {
    rows.push([
      monthLabel(m.month as BudgetMonth, "long"),
      amount(m.assigned),
      amount(m.activity),
      amount(m.available),
      m.targetAmount === null ? { raw: "" } : amount(m.targetAmount),
      m.targetMet === null ? "" : m.targetMet ? "Yes" : "No",
      amount(movedNet(m)),
    ]);
  }
  return rows;
}

export function exportName(name: string, today: string, delimiter: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `strictbudget-category-history-${slug || "category"}-${today}.${delimiter === "\t" ? "tsv" : "csv"}`;
}
