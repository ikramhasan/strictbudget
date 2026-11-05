import { type BudgetMonth, money } from "@strictbudget/engine";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SpendingPaceChart, SpendingPaceLegend } from "@/components/reports/spending-pace-chart";
import { useBudget } from "@/lib/budget-context";
import { paceCallout, paceScope, STATUS_TONES, spendingPaceOptions } from "@/lib/spending-pace";

/**
 * The plan screen's spending pace: the whole plan's burndown in small under the month's summary,
 * with its callout, what it covers and today's safe amount per day, opening the report. It reads
 * the same answer as the report and the Reports home for the month.
 */
export function SpendingPacePanel({ month }: { month: BudgetMonth }) {
  const { budget, formatAmount } = useBudget();
  const { data, isError } = useQuery(spendingPaceOptions(budget.id, { month }));
  const format = (amount: bigint) => formatAmount(money(amount, budget.currency));
  const line = data?.line;
  const status = line?.status;
  return (
    <section
      aria-labelledby="pace-panel-title"
      className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border bg-card p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="pace-panel-title" className="font-semibold text-sm">
          Spending Pace
        </h2>
        <Link
          to="/budgets/$budgetId/reports/spending-pace"
          params={{ budgetId: budget.id }}
          search={data?.finished ? { month } : {}}
          className="rounded-sm text-muted-foreground text-xs underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open report
        </Link>
      </div>
      {isError ? (
        <p className="text-muted-foreground text-sm">Couldn't load the spending pace.</p>
      ) : !data || !line ? (
        <div className="grid gap-2" aria-hidden>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : !status ? (
        <p className="text-muted-foreground text-sm leading-relaxed">
          Nothing to pace yet. Assign money to the categories you spend from and this tracks how
          fast it goes, day by day.
        </p>
      ) : (
        <>
          <p className={cn("text-sm", status !== "on_pace" && STATUS_TONES[status])}>
            {paceCallout(line, data.finished, format)}
          </p>
          <div
            role="img"
            aria-label={`Money left to spend each day of the month, against an even pace to zero. ${paceCallout(line, data.finished, format)}`}
          >
            <SpendingPaceChart
              line={line}
              elapsed={data.elapsed}
              finished={data.finished}
              compact
              className="aspect-auto h-32 w-full"
            />
          </div>
          <SpendingPaceLegend line={line} finished={data.finished} />
          {line.safePerDay !== null && (
            <div className="flex items-baseline justify-between gap-2 border-t pt-2 text-sm">
              <span className="text-muted-foreground">Safe to spend per day</span>
              <span className="font-medium tabular-nums">{format(BigInt(line.safePerDay))}</span>
            </div>
          )}
          <p className="text-muted-foreground text-xs leading-relaxed">
            {paceScope(data.categories)}
          </p>
        </>
      )}
    </section>
  );
}
