import type { BudgetMonth } from "@strictbudget/engine";
import { type ChartConfig, ChartContainer } from "@strictbudget/ui/components/chart";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@strictbudget/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@strictbudget/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/reports/chart-card";
import { ReportPage } from "@/components/reports/report-page";
import {
  AGE_OF_MONEY_SPANS,
  type AgeOfMoneyMonth,
  type AgeOfMoneySpan,
  ageOfMoneyOptions,
  ageOfMoneySearchSchema,
  changeLabel,
  daysLabel,
  SPAN_LABELS,
  spanMonths,
} from "@/lib/age-of-money";
import { useBudget } from "@/lib/budget-context";
import { monthLabel } from "@/lib/reports";

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/age-of-money")({
  validateSearch: ageOfMoneySearchSchema,
  component: Report,
});

/**
 * The current number, its history one point per month, and what it means. No filters and no
 * export.
 */
function Report() {
  const { budget } = useBudget();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const span: AgeOfMoneySpan = search.span ?? "6m";
  const view = search.view ?? "chart";
  const query = useQuery(ageOfMoneyOptions(budget.id));
  const data = query.data;
  const points = data ? spanMonths(data.months, span) : [];
  const rows = data ? spanMonths(data.months, span, { all: true }) : [];
  const change = data ? changeLabel(data.current, data.thirtyDaysAgo) : null;

  return (
    <ReportPage
      title="Age of Money"
      filters={
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={span}
          onValueChange={(v) =>
            v &&
            navigate({
              search: (s) => ({ ...s, span: v as AgeOfMoneySpan }),
              replace: true,
              resetScroll: false,
            })
          }
          aria-label="Period"
          className="justify-self-start"
        >
          {AGE_OF_MONEY_SPANS.map((s) => (
            <ToggleGroupItem key={s} value={s} className="px-3">
              {SPAN_LABELS[s]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    >
      <section aria-label="Current Age of Money" className="grid gap-1 rounded-lg border p-4">
        <span className="text-muted-foreground text-sm">Current</span>
        {query.isPending ? (
          <Skeleton className="h-9 w-32" />
        ) : data?.current == null ? (
          <>
            <p className="font-semibold text-lg">Not enough data yet</p>
            <p className="text-muted-foreground text-sm">
              It shows once money has left your cash accounts ten times.
            </p>
          </>
        ) : (
          <p className="font-semibold text-3xl tabular-nums">{daysLabel(data.current)}</p>
        )}
        {change && <p className="text-muted-foreground text-sm">{change}</p>}
      </section>

      <ChartCard
        title="History"
        view={view}
        onViewChange={(v) =>
          navigate({ search: (s) => ({ ...s, view: v }), replace: true, resetScroll: false })
        }
        loading={query.isPending}
        empty={
          query.isError
            ? "Couldn't load Age of Money."
            : points.length === 0
              ? "No Age of Money in this period yet: it needs ten outflows from your cash accounts."
              : undefined
        }
        fileName={`age-of-money-${span}`}
        chart={<AgeChart points={points} />}
        table={<AgeTable rows={rows} />}
      />

      <section aria-labelledby="aom-about" className="grid gap-2 rounded-lg border p-4 text-sm">
        <h2 id="aom-about" className="font-semibold">
          Understanding Age of Money
        </h2>
        <p>
          Age of Money is how long, on average, your money sits in your accounts between earning it
          and spending it. The older it is, the more time you have before you need what's coming in
          next.
        </p>
        <p className="text-muted-foreground">
          It averages the last ten times money left your checking, savings and cash accounts (credit
          card payments count; moving money between those accounts doesn't), spending your oldest
          dollars first.
        </p>
      </section>
    </ReportPage>
  );
}

const config = { days: { label: "Age of Money", color: "var(--primary)" } } satisfies ChartConfig;

function AgeChart({ points }: { points: AgeOfMoneyMonth[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          tickFormatter={(m: string) => monthLabel(m as BudgetMonth)}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
          padding={{ left: 16, right: 16 }}
        />
        <YAxis
          dataKey="days"
          tickFormatter={(d: number) => daysLabel(d)}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          domain={[0, "auto"]}
          width={76}
        />
        <Tooltip
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as AgeOfMoneyMonth | undefined;
            return active && point?.days != null ? (
              <div className="grid gap-0.5 rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                <span className="text-muted-foreground">
                  {monthLabel(point.month as BudgetMonth)}
                </span>
                <span className="font-medium tabular-nums">{daysLabel(point.days)}</span>
              </div>
            ) : null;
          }}
        />
        <Line
          dataKey="days"
          type="linear"
          stroke="var(--color-days)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--color-days)" }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

function AgeTable({ rows }: { rows: AgeOfMoneyMonth[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Age of Money</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...rows].reverse().map((r) => (
          <TableRow key={r.month}>
            <TableCell>{monthLabel(r.month as BudgetMonth, "long")}</TableCell>
            <TableCell className="text-right tabular-nums">
              {r.days === null ? (
                <span className="text-muted-foreground">Not enough spending</span>
              ) : (
                daysLabel(r.days)
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
