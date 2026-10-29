import { type BudgetMonth, changeOf, comparisonRange, money, monthsIn } from "@strictbudget/engine";
import { Badge } from "@strictbudget/ui/components/badge";
import { Input } from "@strictbudget/ui/components/input";
import { Label } from "@strictbudget/ui/components/label";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { Switch } from "@strictbudget/ui/components/switch";
import { ToggleGroup, ToggleGroupItem } from "@strictbudget/ui/components/toggle-group";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";
import { ChartCard } from "@/components/reports/chart-card";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportPage } from "@/components/reports/report-page";
import {
  IncomeSourcesChart,
  SavingsRateChart,
  sourceColor,
} from "@/components/reports/savings-rate-chart";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { invalidateBudgets } from "@/lib/budgets";
import { monthLabel, reportActivityOptions } from "@/lib/reports";
import {
  goalFromInput,
  goalInputText,
  incomeSources,
  percentLabel,
  ratesFor,
  type SavingsMode,
  type SavingsRate,
  type SavingsRateCategory,
  savingsRateOptions,
  savingsRateSearchSchema,
} from "@/lib/savings-rate";
import { useReportState } from "@/lib/use-report";

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/savings-rate")({
  validateSearch: savingsRateSearchSchema,
  component: Report,
});

/**
 * How much of what came in was kept: the monthly and rolling 12-month savings rate against an
 * optional goal, what counts as saving, and where the income came from.
 */
function Report() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const update = (patch: Partial<z.infer<typeof savingsRateSearchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });
  const { budget, formatAmount } = useBudget();
  const state = useReportState(search, "last_12_months");
  const { budgetId, range } = state;
  const mode: SavingsMode = search.mode ?? "saving";
  const report = useQuery(savingsRateOptions(budgetId, range));
  const data = report.data;
  const format = (amount: string | bigint) => formatAmount(money(BigInt(amount), budget.currency));

  const totals =
    data && ratesFor({ ...data.total, month: "", rollingRate: null, rollingPlainRate: null }, mode);
  const latest = data?.months.at(-1);

  return (
    <ReportPage
      title="Savings Rate"
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <ReportFilterBar
            search={search}
            update={update}
            range={range}
            preset={state.preset}
            current={state.current}
            earliest={state.earliest}
            show={[]}
          />
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            onValueChange={(v) => v && update({ mode: v === "saving" ? undefined : "plain" })}
            aria-label="Which rate"
          >
            <ToggleGroupItem value="saving">Counting savings</ToggleGroupItem>
            <ToggleGroupItem value="plain">Income v Expense</ToggleGroupItem>
          </ToggleGroup>
        </div>
      }
    >
      {report.isError ? (
        <p className="text-muted-foreground text-sm">Couldn't load the report.</p>
      ) : !data || !totals ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <section
          aria-label="Key numbers"
          className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3"
        >
          <Tile label="Savings rate for the range" value={percentLabel(totals.rate)}>
            {mode === "saving" ? (
              <>
                {format(data.total.saved)} kept of{" "}
                {format(BigInt(data.total.income) - BigInt(data.total.incomeFromTracking))}
              </>
            ) : (
              <>
                {format(data.total.netIncome)} left over of {format(data.total.income)}
              </>
            )}
          </Tile>
          <Tile
            label={
              latest
                ? `Rolling 12 months to ${monthLabel(latest.month as BudgetMonth, "long")}`
                : "Rolling 12 months"
            }
            value={percentLabel(latest ? ratesFor(latest, mode).rolling : null)}
          >
            The steadier number: a year's saving over a year's income.
          </Tile>
          <GoalTile goal={data.goal} rate={totals.rate} />
        </section>
      )}
      <ChartCard
        title="Savings rate by month"
        view={state.view}
        onViewChange={(view) => update({ view })}
        loading={!data}
        empty={
          data?.months.every((m) => ratesFor(m, mode).rate === null)
            ? "No income in this range, so there's no rate to show."
            : undefined
        }
        fileName="savings-rate"
        chart={data && <SavingsRateChart months={data.months} mode={mode} goal={data.goal} />}
        table={data && <RateTable data={data} mode={mode} format={format} />}
      />
      {data && mode === "saving" && (
        <p className="text-muted-foreground text-sm">
          Left over {format(data.total.netIncome)} · Saved via categories{" "}
          {format(data.total.savedViaCategories)} · Moved to tracking accounts{" "}
          {format(data.total.movedToTracking)}
        </p>
      )}
      {data && mode === "plain" && (
        <p className="text-muted-foreground text-sm">
          Income v Expense's rate: net income ÷ income. Money put into saving categories or moved to
          tracking accounts counts as spent here.
        </p>
      )}
      {data && <SavingCategories data={data} format={format} />}
      <IncomeSources />
    </ReportPage>
  );
}

function Tile({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1 rounded-lg border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="font-semibold text-2xl tabular-nums">{value}</p>
      {children && <p className="text-muted-foreground text-xs">{children}</p>}
    </div>
  );
}

/** The budget's goal, typed as a percent and saved on leaving the field. */
function GoalTile({ goal, rate }: { goal: number | null; rate: number | null }) {
  const { budget, readOnly } = useBudget();
  const queryClient = useQueryClient();
  const save = $api.useMutation("patch", "/v1/budgets/{budgetId}");
  const [text, setText] = useState(goalInputText(goal));
  useEffect(() => setText(goalInputText(goal)), [goal]);
  const parsed = goalFromInput(text);
  const commit = async () => {
    if (parsed === undefined || parsed === goal) return;
    try {
      await save.mutateAsync({
        params: { path: { budgetId: budget.id } },
        body: { savingsRateGoal: parsed },
      });
      await Promise.all([
        invalidateBudgets(queryClient),
        queryClient.invalidateQueries({
          queryKey: ["get", "/v1/budgets/{budgetId}/reports/savings-rate"],
        }),
      ]);
    } catch {
      toast.error("Couldn't save the goal.");
    }
  };
  const gap = goal !== null && rate !== null ? rate - goal / 100 : null;
  return (
    <div className="grid content-start gap-1 rounded-lg border p-4">
      <Label htmlFor="savings-goal" className="font-normal text-muted-foreground text-sm">
        Goal
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="savings-goal"
          inputMode="decimal"
          className="w-24 font-semibold tabular-nums"
          placeholder="None"
          value={text}
          disabled={readOnly}
          aria-invalid={parsed === undefined || undefined}
          aria-describedby="savings-goal-help"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <span className="text-muted-foreground">%</span>
      </div>
      <p
        id="savings-goal-help"
        className={cn("text-muted-foreground text-xs", parsed === undefined && "text-destructive")}
      >
        {parsed === undefined
          ? "Enter a percent from 0 to 100."
          : gap === null
            ? "Shown as a dashed line on the chart."
            : gap >= 0
              ? `${gap.toFixed(1)} points above the goal for the range.`
              : `${(-gap).toFixed(1)} points below the goal for the range.`}
      </p>
    </div>
  );
}

function RateTable({
  data,
  mode,
  format,
}: {
  data: SavingsRate;
  mode: SavingsMode;
  format: (amount: string | bigint) => string;
}) {
  const head = "px-2 py-1.5 font-medium";
  const cell = "px-2 py-1.5 text-right tabular-nums";
  return (
    <table className="w-full min-w-max text-sm">
      <thead>
        <tr className="border-b text-muted-foreground text-xs">
          <th scope="col" className={cn(head, "text-left")}>
            Month
          </th>
          <th scope="col" className={cn(head, "text-right")}>
            Income
          </th>
          <th scope="col" className={cn(head, "text-right")}>
            Left over
          </th>
          {mode === "saving" && (
            <>
              <th scope="col" className={cn(head, "text-right")}>
                Saved via categories
              </th>
              <th scope="col" className={cn(head, "text-right")}>
                Moved to tracking
              </th>
            </>
          )}
          <th scope="col" className={cn(head, "text-right")}>
            Rate
          </th>
          <th scope="col" className={cn(head, "text-right")}>
            Rolling 12 months
          </th>
        </tr>
      </thead>
      <tbody>
        {data.months.map((m) => {
          const r = ratesFor(m, mode);
          return (
            <tr key={m.month} className="border-b">
              <th scope="row" className="px-2 py-1.5 text-left font-normal">
                {monthLabel(m.month as BudgetMonth, "long")}
              </th>
              <td className={cell}>{format(m.income)}</td>
              <td className={cell}>{format(m.netIncome)}</td>
              {mode === "saving" && (
                <>
                  <td className={cell}>{format(m.savedViaCategories)}</td>
                  <td className={cell}>{format(m.movedToTracking)}</td>
                </>
              )}
              <td className={cell}>{r.rate === null ? "No income" : percentLabel(r.rate)}</td>
              <td className={cell}>{percentLabel(r.rolling)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** "Counts as saving", per category; suggested ones are marked. */
function SavingCategories({
  data,
  format,
}: {
  data: SavingsRate;
  format: (amount: string | bigint) => string;
}) {
  const { budget, readOnly } = useBudget();
  const queryClient = useQueryClient();
  const set = $api.useMutation(
    "put",
    "/v1/budgets/{budgetId}/reports/savings-rate/categories/{categoryId}",
  );
  const toggle = async (c: SavingsRateCategory, countsAsSaving: boolean) => {
    try {
      await set.mutateAsync({
        params: { path: { budgetId: budget.id, categoryId: c.categoryId } },
        body: { countsAsSaving },
      });
      await queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "get" &&
          (q.queryKey[1] === "/v1/budgets/{budgetId}/reports/savings-rate" ||
            q.queryKey[1] === "/v1/budgets/{budgetId}/reports/spending-pace"),
      });
    } catch {
      toast.error("Couldn't change the category.");
    }
  };
  // Marked and suggested first, then the plan's order.
  const rank = (c: SavingsRateCategory) => (c.countsAsSaving ? 0 : c.suggested ? 1 : 2);
  const sorted = [...data.categories].sort((a, b) => rank(a) - rank(b));
  if (!sorted.length) return null;
  return (
    <section aria-labelledby="saving-categories" className="grid gap-3 rounded-lg border p-4">
      <div className="grid gap-1">
        <h2 id="saving-categories" className="font-semibold">
          What counts as saving
        </h2>
        <p className="text-muted-foreground text-xs">
          Spending in a category that counts as saving (investments, a pension, savings you move out
          of the budget) is added back as saved. Transfers to tracking asset accounts always count;
          loan and liability payments don't. Spending Pace leaves these categories out too.
        </p>
      </div>
      <ul className="grid max-h-96 divide-y overflow-y-auto">
        {sorted.map((c) => {
          const id = `saving-${c.categoryId}`;
          return (
            <li key={c.categoryId} className="flex items-center gap-3 py-2">
              <Label htmlFor={id} className="grid flex-1 gap-0.5 font-normal">
                <span className="flex flex-wrap items-center gap-2">
                  {c.name}
                  {c.suggested && <Badge variant="secondary">Suggested</Badge>}
                </span>
                <span className="text-muted-foreground text-xs">
                  {c.groupName}
                  {c.suggested && " · most of it went to tracking accounts"}
                </span>
              </Label>
              <span className="text-right text-muted-foreground text-sm tabular-nums">
                {format(-BigInt(c.spent))} spent
              </span>
              <Switch
                id={id}
                aria-label={`${c.name} counts as saving`}
                checked={c.countsAsSaving}
                disabled={readOnly || set.isPending}
                onCheckedChange={(on) => toggle(c, on)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Income by payee (top 5 + Other), each source's share and steadiness, vs the previous period. */
function IncomeSources() {
  const search = Route.useSearch();
  const { budget, formatAmount } = useBudget();
  const state = useReportState(search, "last_12_months");
  const { budgetId, range } = state;
  const previousRange = comparisonRange(range, "previous_period");
  const income = useQuery(
    reportActivityOptions({ budgetId, range, kind: "income", groupBy: ["month", "payee"] }),
  );
  const previous = useQuery(
    reportActivityOptions({ budgetId, range: previousRange, kind: "income" }),
  );
  const [view, setView] = useState<"chart" | "table">("chart");
  const months = monthsIn(range);
  const built =
    income.data &&
    incomeSources({
      months,
      current: state.current,
      sums: income.data.rows,
      payees: income.data.payees,
    });
  const before = previous.data?.rows.reduce((s, r) => s + BigInt(r.net), 0n);
  const change = built && before !== undefined ? changeOf(built.grandTotal, before) : null;
  const format = (amount: bigint) => formatAmount(money(amount, budget.currency));
  return (
    <>
      <div className="grid gap-1">
        <h2 className="font-semibold">Income sources</h2>
        {built ? (
          <p className="text-sm">
            <span className="font-semibold text-xl tabular-nums">{format(built.grandTotal)}</span>{" "}
            <span className="text-muted-foreground">
              came in
              {change &&
                (change.amount === 0n
                  ? ", the same as the previous period"
                  : `, ${format(change.amount < 0n ? -change.amount : change.amount)}${change.percent === null ? "" : ` (${Math.abs(change.percent).toFixed(1)}%)`} ${change.amount > 0n ? "more" : "less"} than the previous period`)}
              .
            </span>
          </p>
        ) : (
          <Skeleton className="h-7 w-64" />
        )}
      </div>
      <ChartCard
        title="Income by source"
        view={view}
        onViewChange={setView}
        loading={!built}
        empty={built && built.sources.length === 0 ? "No income in this range." : undefined}
        fileName="income-sources"
        chart={built && <IncomeSourcesChart months={months} sources={built.sources} />}
        table={
          built && (
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    Source
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Total
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Share
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Months received
                  </th>
                </tr>
              </thead>
              <tbody>
                {built.sources.map((s, i) => (
                  <tr key={s.key} className="border-b">
                    <th scope="row" className="px-2 py-1.5 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-xs"
                          style={{ background: sourceColor(s, i) }}
                        />
                        {s.name}
                        {s.folded && (
                          <span className="text-muted-foreground text-xs">
                            ({s.folded} sources)
                          </span>
                        )}
                      </span>
                    </th>
                    <td className="px-2 py-1.5 text-right tabular-nums">{format(s.total)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{percentLabel(s.share)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.monthsReceived} of {built.monthsCounted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      />
    </>
  );
}
