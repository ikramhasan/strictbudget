import { addMonths, type BudgetMonth, money, monthOf } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ChartCard } from "@/components/reports/chart-card";
import {
  CardChart,
  CardSummary,
  CardTable,
  FloatTable,
} from "@/components/reports/credit-card-health";
import { ReportPage } from "@/components/reports/report-page";
import { useBudget } from "@/lib/budget-context";
import { creditCardHealthOptions, creditCardHealthSearchSchema } from "@/lib/credit-card-health";
import { todayIso } from "@/lib/dates";
import { monthLabel } from "@/lib/reports";

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/credit-card-health")({
  validateSearch: creditCardHealthSearchSchema,
  component: Report,
});

/**
 * Each card's balance next to what its payment category has set aside, where the gap came from,
 * how the card moved month by month, and how much of the cards' debt is carried on money still to
 * come. The numbers are the plan screen's own (its payment category's Available and Underfunded).
 */
function Report() {
  const { budget, formatAmount, readOnly } = useBudget();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const current = monthOf(todayIso());
  const month: BudgetMonth = search.month && search.month <= current ? search.month : current;
  const view = search.view ?? "chart";
  const query = useQuery({
    ...creditCardHealthOptions(budget.id, month),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const format = (amount: string) => formatAmount(money(BigInt(amount), budget.currency));
  const setSearch = (next: Partial<typeof search>) =>
    navigate({ search: (s) => ({ ...s, ...next }), replace: true });

  return (
    <ReportPage
      title="Credit Card Health"
      filters={
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            disabled={data !== undefined && month <= data.firstMonth}
            onClick={() => setSearch({ month: addMonths(month, -1) })}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-28 text-center font-medium text-sm tabular-nums">
            {monthLabel(month, "long")}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            disabled={month >= current}
            onClick={() => {
              const next = addMonths(month, 1);
              setSearch({ month: next >= current ? undefined : next });
            }}
          >
            <ChevronRight />
          </Button>
        </div>
      }
    >
      {query.isError ? (
        <p className="text-muted-foreground text-sm">Couldn't load the credit card health.</p>
      ) : !data ? (
        <Skeleton className="h-32 w-full" />
      ) : data.cards.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No open credit cards or lines of credit in this plan.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Total label="Owed on all cards" value={format(data.totals.balance)} />
            <Total label="Set aside" value={format(data.totals.covered)} />
            <Total label="Still to set aside" value={format(data.totals.unfunded)} />
          </dl>
          {data.cards.map((card) => (
            <section key={card.accountId} className="grid gap-3 rounded-lg border p-4">
              <CardSummary
                card={card}
                month={month}
                budgetId={budget.id}
                format={format}
                readOnly={readOnly}
              />
              <ChartCard
                title={`${card.name}, month by month`}
                view={view}
                onViewChange={(v) => setSearch({ view: v })}
                loading={query.isPending}
                empty={card.series.length === 0 ? "No activity yet." : undefined}
                fileName={`credit-card-health-${card.name}-${month}`}
                chart={<CardChart card={card} />}
                table={<CardTable card={card} />}
              />
            </section>
          ))}
          <section className="grid gap-2 rounded-lg border p-4">
            <h2 className="font-semibold">Living on the float</h2>
            <p className="text-muted-foreground text-sm">
              What the cards' payment categories lacked at each month's end. It's paid with money
              that hasn't arrived yet; a falling number means you're getting off the float.
            </p>
            <div className="overflow-x-auto">
              <FloatTable float={data.float} />
            </div>
          </section>
        </>
      )}
    </ReportPage>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-semibold text-xl tabular-nums">{value}</dd>
    </div>
  );
}
