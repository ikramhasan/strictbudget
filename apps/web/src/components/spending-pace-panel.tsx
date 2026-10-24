import { type BudgetMonth, money } from "@strictbudget/engine";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SpendingPaceChart } from "@/components/reports/spending-pace-chart";
import { useBudget } from "@/lib/budget-context";
import { paceCallout, STATUS_TONES, spendingPaceOptions } from "@/lib/spending-pace";

/**
 * The plan screen's spending pace: the whole plan's burndown in
 * small under the month's summary, with its callout and today's safe amount per day, opening the
 * report. Nothing shows until there's money to pace.
 */
export function SpendingPacePanel({ month }: { month: BudgetMonth }) {
  const { budget, formatAmount } = useBudget();
  const { data } = useQuery(spendingPaceOptions(budget.id, { month }));
  const status = data?.line.status;
  if (!data || !status) return null;
  const format = (amount: bigint) => formatAmount(money(amount, budget.currency));
  const { line } = data;
  return (
    <section
      aria-label="Spending pace"
      className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-sm">Spending Pace</h2>
        <Link
          to="/budgets/$budgetId/reports/spending-pace"
          params={{ budgetId: budget.id }}
          search={data.finished ? { month } : {}}
          className="text-muted-foreground text-xs underline hover:text-foreground"
        >
          Open report
        </Link>
      </div>
      <p className={cn("text-sm", status !== "on_pace" && STATUS_TONES[status])}>
        {paceCallout(line, data.finished, format)}
      </p>
      <SpendingPaceChart
        line={line}
        elapsed={data.elapsed}
        finished={data.finished}
        compact
        className="aspect-auto h-20 w-full"
      />
      {line.safePerDay !== null && (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Safe to spend per day</span>
          <span className="tabular-nums">{format(BigInt(line.safePerDay))}</span>
        </div>
      )}
    </section>
  );
}
