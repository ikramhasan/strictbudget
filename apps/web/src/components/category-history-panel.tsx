import type { BudgetMonth, MonthRange } from "@strictbudget/engine";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import { CategoryHistoryChart } from "@/components/reports/category-history-chart";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import {
  type CategoryHistory,
  categoryHistoryOptions,
  categoryNames,
  inspectorRange,
} from "@/lib/category-history";
import { shortMonthName } from "@/lib/months";
import { chartNumber, monthLabel, rangeLabel } from "@/lib/reports";

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

/** Whether a category has nothing to chart yet: nothing assigned or spent in any month. */
export const emptyHistory = (history: CategoryHistory) =>
  history.months.every((m) => BigInt(m.assigned) === 0n && BigInt(m.activity) === 0n);

/** The next round number at or above `n` (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × a power of ten). */
function niceCeil(n: number) {
  if (n <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(n));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * power >= n - 1e-9) ?? 10;
  return step * power;
}

/**
 * The value axis' top for the inspector's chart, kept while the category stays open: it starts a
 * fifth above the tallest bar and only grows once a bar outgrows it, so raising an amount makes its
 * bar taller instead of quietly rescaling the rest.
 */
export function stableMax(previous: number | undefined, tallest: number) {
  if (previous !== undefined && tallest <= previous) return previous;
  return niceCeil(tallest * 1.2);
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
  const { currency } = budget;
  const max = useRef<number | undefined>(undefined);
  if (data) {
    const tallest = Math.max(
      ...data.months.flatMap((m) => [
        chartNumber(m.assigned, currency),
        chartNumber(-BigInt(m.activity), currency),
      ]),
      0,
    );
    max.current = stableMax(max.current, tallest);
  }
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
      ) : emptyHistory(data) ? (
        <p className="text-muted-foreground text-xs">No history yet</p>
      ) : (
        <div role="img" aria-label={`Assigned and spent, ${rangeLabel(shown)}`}>
          <CategoryHistoryChart history={data} names={names} compact yMax={max.current} />
        </div>
      )}
    </section>
  );
}
