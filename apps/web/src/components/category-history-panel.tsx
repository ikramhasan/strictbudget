import type { BudgetMonth, MonthRange } from "@strictbudget/engine";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CategoryHistoryChart } from "@/components/reports/category-history-chart";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { categoryHistoryOptions, categoryNames, inspectorRange } from "@/lib/category-history";
import { shortMonthName } from "@/lib/months";
import { monthLabel, rangeLabel } from "@/lib/reports";

/**
 * The months the chart covers, written the same way whichever month is inspected: "Nov 2026",
 * "Sep – Nov 2026", or "Dec 2025 – Nov 2026" across a year.
 */
export function historyRange(shown: MonthRange) {
  if (shown.from === shown.to) return monthLabel(shown.to);
  if (shown.from.slice(0, 4) === shown.to.slice(0, 4)) {
    return `${shortMonthName(shown.from)} – ${monthLabel(shown.to)}`;
  }
  return rangeLabel(shown);
}

/**
 * The category inspector's history: Assigned and Spent for up to 12 months ending with the
 * inspected one, opening the full report on that range.
 */
export function CategoryHistoryPanel({
  categoryId,
  month,
}: {
  categoryId: string;
  month: BudgetMonth;
}) {
  const { budget } = useBudget();
  const range = inspectorRange(month);
  const { data, isError } = useQuery({
    ...categoryHistoryOptions(budget.id, { categoryId }, range),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const names = categories.data ? categoryNames(categories.data) : new Map<string, string>();
  if (isError) return null;
  const first = data?.months[0]?.month as BudgetMonth | undefined;
  const shown: MonthRange = { from: first ?? range.from, to: range.to };
  return (
    <section aria-label="History" className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex min-w-0 items-baseline gap-2 font-medium text-sm">
          History
          {data && (
            <span className="truncate font-normal text-muted-foreground text-xs tabular-nums">
              {historyRange(shown)}
            </span>
          )}
        </h3>
        <Link
          to="/budgets/$budgetId/reports/category-history"
          params={{ budgetId: budget.id }}
          search={{ category: categoryId, from: shown.from, to: shown.to }}
          className="text-muted-foreground text-xs underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
        >
          Open report
        </Link>
      </div>
      {!data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div role="img" aria-label={`Assigned and spent, ${rangeLabel(shown)}`}>
          <CategoryHistoryChart history={data} names={names} compact />
        </div>
      )}
    </section>
  );
}
