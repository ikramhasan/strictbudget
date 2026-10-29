import {
  addMonths,
  type BudgetMonth,
  type CategoryTarget,
  categoryMonth,
  type MonthFigures,
  targetNeed,
} from "@strictbudget/engine";
import type { Db } from "../../lib/ledger";
import { monthRange } from "../months/handlers";

export function monthsBetween(from: BudgetMonth, to: BudgetMonth) {
  const months: BudgetMonth[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m);
  return months;
}

/**
 * The months from `from` to `to` that the plan shows (as the plan screen offers them, with its
 * first month): months outside hold nothing, and the walk stays bounded however wide a range is
 * asked for.
 */
export async function planMonths(
  db: Db,
  budgetId: string,
  from: BudgetMonth,
  to: BudgetMonth,
  today: string,
) {
  const { first, last } = await monthRange(db, budgetId, today);
  const start = from < first ? first : from;
  const end = to > last ? last : to;
  return { first, months: start <= end ? monthsBetween(start, end) : [] };
}

/**
 * A category's numbers for each of `months` as the plan shows them, with what its target asked of
 * the month. Targets have no history: the current target applies from its start month.
 */
export function planFigures(
  entries: readonly MonthFigures[],
  target: CategoryTarget | undefined,
  months: readonly BudgetMonth[],
  currentMonth: BudgetMonth,
) {
  return months.map((month) => ({
    month,
    ...categoryMonth(entries, month),
    need: target ? targetNeed(entries, target, month, currentMonth) : null,
  }));
}
