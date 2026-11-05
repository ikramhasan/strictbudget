import {
  addMonths,
  type BudgetMonth,
  money,
  monthsOfRunway,
  NUMBER_FORMAT_SPECS,
  percentOf,
} from "@strictbudget/engine";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ReportEmpty } from "@/components/reports/chart-card";
import {
  describeObservation,
  KeyTile,
  PreviewCard,
  type ReportTarget,
} from "@/components/reports/home-parts";
import { ReportPage } from "@/components/reports/report-page";
import { ageOfMoneyOptions, changeLabel, daysLabel } from "@/lib/age-of-money";
import { useBudget } from "@/lib/budget-context";
import { shortMonthName } from "@/lib/months";
import {
  chartNumber,
  chartTick,
  distinctColors,
  monthLabel,
  UNCATEGORIZED_COLOR,
} from "@/lib/reports";
import { averageSpent, savingsRate, useReportsHomeData } from "@/lib/reports-home";
import { paceCallout, spendingPaceOptions } from "@/lib/spending-pace";

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/")({
  component: ReportsHome,
});

/**
 * The Reports home: key numbers with their change and a 12-month sparkline, a live preview per
 * question, and rule-based observations, each opening the report that shows it.
 */
function ReportsHome() {
  const { budget, formatAmount } = useBudget();
  const home = useReportsHomeData(budget.id);
  const age = useQuery(ageOfMoneyOptions(budget.id));
  const pace = useQuery(spendingPaceOptions(budget.id, {})).data;
  const format = (minorUnits: bigint) => formatAmount(money(minorUnits, budget.currency));
  const { month } = home;
  const last = addMonths(month, -1);
  const spentNow = home.spent.get(month) ?? 0n;
  // The last 6 complete months, from the first with spending (a newer budget averages fewer).
  const { months: previousSix, average } = averageSpent(home.spent, month);
  const vsAverage = previousSix.length ? percentOf(spentNow - average, average) : null;
  // Savings rate of the last complete month: this month's income may still be on its way.
  const rate = savingsRate(home.earned.get(last) ?? 0n, home.spent.get(last) ?? 0n);
  const rateBefore = savingsRate(
    home.earned.get(addMonths(month, -2)) ?? 0n,
    home.spent.get(addMonths(month, -2)) ?? 0n,
  );
  const worthMonths = home.netWorth?.months ?? [];
  const worthNow = worthMonths.at(-1);
  const worthBefore = worthMonths.at(-2) ?? home.netWorth?.opening;
  const worthChange =
    worthNow && worthBefore ? BigInt(worthNow.netWorth) - BigInt(worthBefore.netWorth) : null;
  // Nothing to report yet: no account has had a balance, nothing earned or spent.
  const noWorth = worthMonths.every((m) => BigInt(m.netWorth) === 0n);
  const noSpending = home.months.every((m) => (home.spent.get(m) ?? 0n) === 0n);
  const noFlow = noSpending && home.months.every((m) => (home.earned.get(m) ?? 0n) === 0n);
  // Runway: cash in budget accounts over the average spending of the last 6 complete months.
  const runway = monthsOfRunway(home.cash, previousSix);
  const spark = (values: Map<BudgetMonth, bigint>) =>
    home.months.map((m) => chartNumber(values.get(m) ?? 0n, budget.currency));
  const topCategories = home.byCategory
    .filter((r) => r.month === month && BigInt(r.net) < 0n && r.categoryId)
    .sort((a, b) => (BigInt(a.net) < BigInt(b.net) ? -1 : 1))
    .slice(0, 5);
  const largest = topCategories[0] ? -BigInt(topCategories[0].net) : 0n;

  const short = (m: BudgetMonth) => shortMonthName(m);
  const yearSpan: [string, string] = [
    monthLabel(home.months[0] ?? month),
    monthLabel(home.months.at(-1) ?? month),
  ];
  const ageMonths = (age.data?.months ?? []).slice(-12).filter((m) => m.days !== null);
  const runwayHistory = home.months.map((m) =>
    monthsOfRunway(home.cashByMonth.get(m) ?? 0n, averageSpent(home.spent, m).months),
  );
  const paceLine = pace?.line;
  const paceDays = pace?.days ?? 0;
  // A group's hue, its categories its tints (biggest strongest), as in Spending Breakdown.
  const topColors = distinctColors(
    topCategories.map((r) => {
      const plan = home.categoryHues.get(r.categoryId ?? "");
      return plan
        ? { key: r.categoryId ?? "", ...plan }
        : { key: r.categoryId ?? "", color: UNCATEGORIZED_COLOR };
    }),
  );
  const tick = (units: number) =>
    chartTick(units, budget.currency, format, NUMBER_FORMAT_SPECS[budget.numberFormat].decimal);
  const flowMonths = home.months.slice(-6);

  return (
    <ReportPage title="Reports">
      {home.failed ? (
        <p className="text-muted-foreground text-sm">Couldn't load the reports. Try again later.</p>
      ) : home.loading ? (
        <div className="@container">
          <div className="grid @2xl:grid-cols-3 @[84rem]:grid-cols-6 @xs:grid-cols-2 gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="@container">
            <section
              aria-label="Key numbers"
              // Six tiles in whole rows: 2, 3 or 6 across as the page widens (1 on the narrowest).
              className="grid @2xl:grid-cols-3 @[84rem]:grid-cols-6 @xs:grid-cols-2 gap-3"
            >
              <KeyTile
                budgetId={budget.id}
                label={`Spent · ${short(month)}`}
                value={format(spentNow)}
                change={
                  noSpending
                    ? {
                        text: "Fills in as you add transactions",
                        up: true,
                        good: true,
                        neutral: true,
                      }
                    : vsAverage === null
                      ? {
                          text: "No earlier months to compare with",
                          up: true,
                          good: true,
                          neutral: true,
                        }
                      : {
                          text: `${Math.abs(vsAverage).toFixed(0)}% ${vsAverage >= 0 ? "above" : "below"} the 6-month average of ${format(average)}`,
                          up: vsAverage >= 0,
                          good: vsAverage <= 0,
                        }
                }
                spark={{
                  values: spark(home.spent),
                  label: "Spending each month",
                  span: yearSpan,
                }}
                placeholder="Not enough history yet"
                target={{
                  to: "/budgets/$budgetId/reports/spending-trends",
                  search: { range: "last_12_months" },
                }}
              />
              <KeyTile
                budgetId={budget.id}
                label="Net worth"
                value={worthNow ? format(BigInt(worthNow.netWorth)) : "—"}
                change={
                  worthChange === null || noWorth
                    ? {
                        text: "Shows once an account has a balance",
                        up: true,
                        good: true,
                        neutral: true,
                      }
                    : worthChange === 0n
                      ? {
                          text: `No change since ${short(last)}`,
                          up: true,
                          good: true,
                          neutral: true,
                        }
                      : {
                          text: `${format(worthChange < 0n ? -worthChange : worthChange)} since ${short(last)}`,
                          up: worthChange > 0n,
                          good: worthChange > 0n,
                        }
                }
                spark={{
                  values: worthMonths.map((m) => chartNumber(m.netWorth, budget.currency)),
                  label: "Net worth at each month's end",
                  span: [
                    monthLabel((worthMonths[0]?.month ?? month) as BudgetMonth),
                    monthLabel((worthMonths.at(-1)?.month ?? month) as BudgetMonth),
                  ],
                }}
                placeholder="Not enough history yet"
                target={{ to: "/budgets/$budgetId/reports/net-worth" }}
              />
              <KeyTile
                budgetId={budget.id}
                label={`Savings rate · ${short(last)}`}
                value={rate === null ? "—" : `${rate.toFixed(1)}%`}
                change={
                  rate === null
                    ? {
                        text: `No income in ${monthLabel(last, "long")}`,
                        up: true,
                        good: true,
                        neutral: true,
                      }
                    : rateBefore === null
                      ? {
                          text: `What ${short(last)}'s income didn't spend`,
                          up: true,
                          good: true,
                          neutral: true,
                        }
                      : {
                          text: `${Math.abs(rate - rateBefore).toFixed(1)} points vs ${short(addMonths(month, -2))}`,
                          up: rate >= rateBefore,
                          good: rate >= rateBefore,
                        }
                }
                spark={{
                  values: home.months.map((m) =>
                    savingsRate(home.earned.get(m) ?? 0n, home.spent.get(m) ?? 0n),
                  ),
                  label: "Savings rate each month",
                  span: yearSpan,
                }}
                placeholder="Not enough history yet"
                target={{
                  to: "/budgets/$budgetId/reports/income-expense",
                  search: { range: "last_12_months" },
                }}
              />
              <KeyTile
                budgetId={budget.id}
                label="Safe to spend / day"
                value={
                  paceLine?.safePerDay != null && paceLine.status !== null
                    ? format(BigInt(paceLine.safePerDay))
                    : "—"
                }
                change={{
                  text:
                    paceLine && pace && paceLine.status !== null
                      ? paceCallout(paceLine, pace.finished, format)
                      : "Assign money to spend this month to see your pace",
                  up: true,
                  good: true,
                  neutral: true,
                }}
                spark={
                  paceLine && paceLine.status !== null
                    ? {
                        values: paceLine.points.map((p) =>
                          p.remaining === null ? null : chartNumber(p.remaining, budget.currency),
                        ),
                        reference: paceLine.points.map((p) =>
                          chartNumber(p.ideal, budget.currency),
                        ),
                        label: "Money left to spend each day, against an even pace (dashed)",
                        span: [`${short(month)} 1`, `${short(month)} ${paceDays}`],
                      }
                    : undefined
                }
                placeholder="No pace this month"
                target={{ to: "/budgets/$budgetId/reports/spending-pace" }}
              />
              <KeyTile
                budgetId={budget.id}
                label="Age of Money"
                value={age.data?.current != null ? daysLabel(age.data.current) : "—"}
                change={
                  age.data?.current == null
                    ? {
                        text: "Shows once money has come in and gone out",
                        up: true,
                        good: true,
                        neutral: true,
                      }
                    : age.data.thirtyDaysAgo == null
                      ? {
                          text: "How long money sits before it's spent",
                          up: true,
                          good: true,
                          neutral: true,
                        }
                      : {
                          text: changeLabel(age.data.current, age.data.thirtyDaysAgo) ?? "",
                          up: age.data.current >= age.data.thirtyDaysAgo,
                          good: age.data.current >= age.data.thirtyDaysAgo,
                        }
                }
                spark={{
                  values: ageMonths.map((m) => m.days),
                  label: "Age of Money at each month's end",
                  span: [
                    monthLabel((ageMonths[0]?.month ?? month) as BudgetMonth),
                    monthLabel((ageMonths.at(-1)?.month ?? month) as BudgetMonth),
                  ],
                }}
                placeholder="Trend after two months"
                target={{ to: "/budgets/$budgetId/reports/age-of-money" }}
              />
              <KeyTile
                budgetId={budget.id}
                label="Runway"
                value={runway === null ? "—" : `${runway.toFixed(1)} months`}
                change={{
                  text:
                    runway === null
                      ? "Needs a month of spending to measure"
                      : `${format(home.cash)} in cash at ${format(average)} a month`,
                  up: true,
                  good: true,
                  neutral: true,
                }}
                spark={{
                  values: runwayHistory,
                  label: "Months of runway at each month's end",
                  span: yearSpan,
                }}
                placeholder="Not enough history yet"
                target={{
                  to: "/budgets/$budgetId/reports/spending-trends",
                  search: { range: "last_6_months" },
                }}
              />
            </section>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <PreviewCard
              budgetId={budget.id}
              title="Top spending"
              note={monthLabel(month, "long")}
              target={{
                to: "/budgets/$budgetId/reports/spending-breakdown",
                search: { from: month, to: month },
              }}
            >
              {topCategories.length === 0 ? (
                <ReportEmpty>
                  {noSpending
                    ? "Your biggest categories this month will be listed here once you add transactions."
                    : `Nothing spent in ${monthLabel(month, "long")} yet. Your biggest categories will be listed here.`}
                </ReportEmpty>
              ) : (
                <ul className="grid gap-2.5" aria-label="Top categories this month">
                  {topCategories.map((r) => {
                    const spent = -BigInt(r.net);
                    return (
                      <li key={r.categoryId} className="grid gap-1 text-sm">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate">
                            {home.categoryNames.get(r.categoryId ?? "")}
                            {home.groupNames.has(r.categoryId ?? "") && (
                              <span className="ml-1.5 text-muted-foreground text-xs">
                                {home.groupNames.get(r.categoryId ?? "")}
                              </span>
                            )}
                          </span>
                          <span className="tabular-nums">{format(spent)}</span>
                        </span>
                        <span className="h-1.5 rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${largest ? Number((spent * 1000n) / largest) / 10 : 0}%`,
                              background: topColors.get(r.categoryId ?? "") ?? UNCATEGORIZED_COLOR,
                            }}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </PreviewCard>
            <PreviewCard
              budgetId={budget.id}
              title="Income and spending"
              note="Last 6 months"
              target={{
                to: "/budgets/$budgetId/reports/income-expense",
                search: { range: "last_6_months" },
              }}
            >
              {noFlow ? (
                <ReportEmpty>
                  Money in and money out, month by month, will chart here once you add transactions.
                </ReportEmpty>
              ) : (
                <>
                  <div
                    className="h-40"
                    role="img"
                    aria-label={`Income and spending, ${monthLabel(flowMonths[0] ?? month)} to ${monthLabel(month)}`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={flowMonths.map((m) => ({
                          month: m,
                          income: chartNumber(home.earned.get(m) ?? 0n, budget.currency),
                          spent: chartNumber(home.spent.get(m) ?? 0n, budget.currency),
                        }))}
                        margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                        barGap={2}
                      >
                        <CartesianGrid vertical={false} stroke="var(--border)" />
                        <XAxis
                          dataKey="month"
                          tickFormatter={(m: string) => shortMonthName(m as BudgetMonth)}
                          tickLine={false}
                          axisLine={false}
                          fontSize={11}
                          tick={{ fill: "var(--muted-foreground)" }}
                        />
                        <YAxis
                          niceTicks="snap125"
                          tickFormatter={tick}
                          tickLine={false}
                          axisLine={false}
                          tickCount={3}
                          width={56}
                          fontSize={11}
                          tick={{ fill: "var(--muted-foreground)" }}
                        />
                        <Tooltip
                          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                          content={({ active, label }) => {
                            if (!active || typeof label !== "string") return null;
                            const m = label as BudgetMonth;
                            return (
                              <div className="grid min-w-40 gap-1 rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                                <span className="font-medium">{monthLabel(m, "long")}</span>
                                {(
                                  [
                                    ["Income", home.earned.get(m) ?? 0n, INCOME_COLOR],
                                    ["Spending", home.spent.get(m) ?? 0n, SPENDING_COLOR],
                                  ] as const
                                ).map(([name, amount, color]) => (
                                  <span key={name} className="flex items-center gap-2">
                                    <span
                                      aria-hidden
                                      className="size-2 rounded-[2px]"
                                      style={{ background: color }}
                                    />
                                    <span className="text-muted-foreground">{name}</span>
                                    <span className="ml-auto tabular-nums">{format(amount)}</span>
                                  </span>
                                ))}
                              </div>
                            );
                          }}
                        />
                        <Bar
                          dataKey="income"
                          fill={INCOME_COLOR}
                          radius={[2, 2, 0, 0]}
                          maxBarSize={20}
                          isAnimationActive={false}
                        />
                        <Bar
                          dataKey="spent"
                          fill={SPENDING_COLOR}
                          radius={[2, 2, 0, 0]}
                          maxBarSize={20}
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="flex gap-4 text-muted-foreground text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-[2px]" style={{ background: INCOME_COLOR }} />
                      Income
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-[2px]"
                        style={{ background: SPENDING_COLOR }}
                      />
                      Spending
                    </span>
                  </p>
                </>
              )}
            </PreviewCard>
          </div>

          <section aria-label="Observations" className="grid gap-2 rounded-lg border p-4">
            <h2 className="font-semibold">Observations</h2>
            {home.observations.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing stands out this month.</p>
            ) : (
              <ul className="grid divide-y">
                {home.observations.map((note) => {
                  const { text, target } = describeObservation(note, month, format);
                  return (
                    <li
                      key={`${note.rule}-${text}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm first:pt-0 last:pb-0"
                    >
                      <span className="min-w-0">{text}</span>
                      <ObservationLink budgetId={budget.id} target={target} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </ReportPage>
  );
}

const INCOME_COLOR = "var(--report-3)";
const SPENDING_COLOR = "var(--report-4)";

function ObservationLink({ budgetId, target }: { budgetId: string; target: ReportTarget }) {
  return (
    <Link
      to={target.to}
      params={{ budgetId }}
      search={target.search ?? {}}
      className="flex shrink-0 items-center gap-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
    >
      See the report
      <ChevronRight aria-hidden className="size-4" />
    </Link>
  );
}
