import type { BudgetMonth } from "@strictbudget/engine";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CategoryHistoryChart } from "@/components/reports/category-history-chart";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { categoryHistoryOptions, categoryNames, inspectorRange } from "@/lib/category-history";
import { rangeLabel } from "@/lib/reports";

/**
 * The category inspector's history: the 12 months up to the inspected one in small (Assigned,
 * Spent, Available, the target and overspent months), opening the full report on that range.
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
  return (
    <section aria-label="History" className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium text-sm">Last 12 months</h3>
        <Link
          to="/budgets/$budgetId/reports/category-history"
          params={{ budgetId: budget.id }}
          search={{ category: categoryId, from: range.from, to: range.to }}
          className="text-muted-foreground text-xs underline hover:text-foreground"
        >
          Open report
        </Link>
      </div>
      {!data ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <div role="img" aria-label={`Assigned, spent and available, ${rangeLabel(range)}`}>
          <CategoryHistoryChart history={data} names={names} compact />
        </div>
      )}
    </section>
  );
}
