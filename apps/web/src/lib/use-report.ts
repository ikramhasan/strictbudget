import type { BudgetMonth, ReportPreset } from "@strictbudget/engine";
import { useQuery } from "@tanstack/react-query";
import { useBudget } from "./budget-context";
import {
  comparisonFor,
  currentMonth,
  type ReportSearch,
  reportActivityOptions,
  reportFilters,
  resolveRange,
} from "./reports";

/** The month of the budget's oldest transaction (for All Dates), null while unknown or none. */
export function useEarliestMonth(): BudgetMonth | null {
  const { budget } = useBudget();
  const current = currentMonth();
  const { data } = useQuery({
    ...reportActivityOptions({ budgetId: budget.id, range: { from: current, to: current } }),
    staleTime: 5 * 60 * 1000,
  });
  return (data?.firstMonth as BudgetMonth | null | undefined) ?? null;
}

/**
 * What a report's URL asks for: its months (a preset or a custom range), the API filters, the
 * comparison months and the chart/table view.
 */
export function useReportState(search: ReportSearch, defaultPreset: ReportPreset) {
  const { budget } = useBudget();
  const current = currentMonth();
  const earliest = useEarliestMonth();
  const { range, preset } = resolveRange(search, defaultPreset, earliest, current);
  return {
    budgetId: budget.id,
    current,
    earliest,
    range,
    preset,
    filters: reportFilters(search),
    comparison: comparisonFor(range, search.compare),
    view: search.view ?? ("chart" as const),
  };
}
