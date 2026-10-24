import {
  addMonths,
  type BudgetMonth,
  money,
  monthsOfRunway,
  percentOf,
} from "@strictbudget/engine";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Bar, BarChart, ResponsiveContainer, XAxis } from "recharts";
import {
  describeObservation,
  KeyTile,
  PreviewCard,
  type ReportTarget,
} from "@/components/reports/home-parts";
import { ReportPage } from "@/components/reports/report-page";
import { ageOfMoneyOptions, changeLabel, daysLabel } from "@/lib/age-of-money";
import { useBudget } from "@/lib/budget-context";
import { chartNumber, monthLabel, UNCATEGORIZED_COLOR } from "@/lib/reports";
import { averageSpent, savingsRate, useReportsHomeData } from "@/lib/reports-home";

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/")({
  component: ReportsHome,
});

/**
 * The Reports home: key numbers with their change and a 12-month sparkline, a live preview per
 * question, and rule-based observations, each
 * opening the report that shows it.
 */
function ReportsHome() {
  const { budget, formatAmount } = useBudget();
  const home = useReportsHomeData(budget.id);
  const age = useQuery(ageOfMoneyOptions(budget.id));
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
  // Runway: cash in budget accounts over the average spending of the last 6 complete months.
  const runway = monthsOfRunway(home.cash, previousSix);
  const spark = (values: Map<BudgetMonth, bigint>) =>
    home.months.map((m) => chartNumber(values.get(m) ?? 0n, budget.currency));
  const topCategories = home.byCategory
    .filter((r) => r.month === month && BigInt(r.net) < 0n && r.categoryId)
    .sort((a, b) => (BigInt(a.net) < BigInt(b.net) ? -1 : 1))
    .slice(0, 5);
  const largest = topCategories[0] ? -BigInt(topCategories[0].net) : 0n;

  return (
    <ReportPage title="Reports">
      {home.failed ? (
        <p className="text-muted-foreground text-sm">Couldn't load the reports. Try again later.</p>
      ) : home.loading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <section
            aria-label="Key numbers"
            // As many tiles per row as fit, sharing the full width (between two and five show).
            className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3"
          >
            <KeyTile
              budgetId={budget.id}
              label={`Spent in ${monthLabel(month, "long")}`}
              value={format(spentNow)}
              change={
                vsAverage === null
                  ? null
                  : {
                      text: `${Math.abs(vsAverage).toFixed(0)}% ${vsAverage >= 0 ? "above" : "below"} the 6-month average (${format(average)})`,
                      up: vsAverage >= 0,
                      good: vsAverage <= 0,
                    }
              }
              spark={{ values: spark(home.spent), label: "Spending over the last 12 months" }}
              target={{
                to: "/budgets/$budgetId/reports/spending-trends",
                search: { range: "last_12_months" },
              }}
            />
            {worthNow && (
              <KeyTile
                budgetId={budget.id}
                label="Net worth"
                value={format(BigInt(worthNow.netWorth))}
                change={
                  worthChange === null
                    ? null
                    : {
                        text: `${format(worthChange < 0n ? -worthChange : worthChange)} since ${monthLabel(last, "long")}`,
                        up: worthChange >= 0n,
                        good: worthChange >= 0n,
                      }
                }
                spark={{
                  values: worthMonths.map((m) => chartNumber(m.netWorth, budget.currency)),
                  label: "Net worth over the last 12 months",
                }}
                target={{ to: "/budgets/$budgetId/reports/net-worth" }}
              />
            )}
            {rate !== null && (
              <KeyTile
                budgetId={budget.id}
                label={`Savings rate in ${monthLabel(last, "long")}`}
                value={`${rate.toFixed(1)}%`}
                change={
                  rateBefore === null
                    ? null
                    : {
                        text: `${Math.abs(rate - rateBefore).toFixed(1)} points vs ${monthLabel(addMonths(month, -2), "long")}`,
                        up: rate >= rateBefore,
                        good: rate >= rateBefore,
                      }
                }
                spark={{
                  values: home.months.map(
                    (m) => savingsRate(home.earned.get(m) ?? 0n, home.spent.get(m) ?? 0n) ?? 0,
                  ),
                  label: "Savings rate over the last 12 months",
                }}
                target={{
                  to: "/budgets/$budgetId/reports/income-expense",
                  search: { range: "last_12_months" },
                }}
              />
            )}
            {age.data?.current != null && (
              <KeyTile
                budgetId={budget.id}
                label="Age of Money"
                value={daysLabel(age.data.current)}
                change={
                  age.data.thirtyDaysAgo == null
                    ? null
                    : {
                        text: changeLabel(age.data.current, age.data.thirtyDaysAgo) ?? "",
                        up: age.data.current >= age.data.thirtyDaysAgo,
                        good: age.data.current >= age.data.thirtyDaysAgo,
                      }
                }
                spark={{
                  values: age.data.months
                    .slice(-12)
                    .flatMap((m) => (m.days === null ? [] : [m.days])),
                  label: "Age of Money over the last 12 months",
                }}
                target={{ to: "/budgets/$budgetId/reports/age-of-money" }}
              />
            )}
            {runway !== null && (
              <KeyTile
                budgetId={budget.id}
                label="Months of runway"
                value={runway.toFixed(1)}
                change={{
                  text: `${format(home.cash)} in cash over ${format(average)} a month`,
                  up: true,
                  good: true,
                  neutral: true,
                }}
                target={{
                  to: "/budgets/$budgetId/reports/spending-trends",
                  search: { range: "last_6_months" },
                }}
              />
            )}
          </section>

          <div className="grid gap-3 md:grid-cols-2">
            <PreviewCard
              budgetId={budget.id}
              title="Spending"
              target={{
                to: "/budgets/$budgetId/reports/spending-breakdown",
                search: { from: month, to: month },
              }}
            >
              {topCategories.length === 0 ? (
                <p className="text-muted-foreground text-sm">No spending this month yet.</p>
              ) : (
                <ul className="grid gap-2" aria-label="Top categories this month">
                  {topCategories.map((r, i) => {
                    const spent = -BigInt(r.net);
                    return (
                      <li key={r.categoryId} className="grid gap-1 text-sm">
                        <span className="flex justify-between gap-2">
                          <span className="truncate">
                            {home.categoryNames.get(r.categoryId ?? "")}
                          </span>
                          <span className="tabular-nums">{format(spent)}</span>
                        </span>
                        <span className="h-1.5 rounded bg-muted">
                          <span
                            className="block h-full rounded"
                            style={{
                              width: `${largest ? Number((spent * 1000n) / largest) / 10 : 0}%`,
                              background:
                                home.categoryColors.get(r.categoryId ?? "") ?? UNCATEGORIZED_COLOR,
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
              target={{
                to: "/budgets/$budgetId/reports/income-expense",
                search: { range: "last_6_months" },
              }}
            >
              <div
                className="h-36"
                role="img"
                aria-label="Income and spending over the last 6 months"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={home.months.slice(-6).map((m) => ({
                      month: monthLabel(m, "axis"),
                      income: chartNumber(home.earned.get(m) ?? 0n, budget.currency),
                      spent: chartNumber(home.spent.get(m) ?? 0n, budget.currency),
                    }))}
                  >
                    <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} />
                    <Bar
                      dataKey="income"
                      fill="var(--report-3)"
                      radius={2}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="spent"
                      fill="var(--report-4)"
                      radius={2}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="flex gap-3 text-muted-foreground text-xs">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm" style={{ background: "var(--report-3)" }} />
                  Income
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm" style={{ background: "var(--report-4)" }} />
                  Spending
                </span>
              </p>
            </PreviewCard>
          </div>

          <section aria-label="Observations" className="grid gap-2 rounded-lg border p-4">
            <h2 className="font-semibold">Observations</h2>
            {home.observations.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing stands out this month.</p>
            ) : (
              <ul className="grid gap-2">
                {home.observations.map((note) => {
                  const { text, target } = describeObservation(note, month, format);
                  return (
                    <li key={`${note.rule}-${text}`} className="text-sm">
                      {text} <ObservationLink budgetId={budget.id} target={target} />
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

function ObservationLink({ budgetId, target }: { budgetId: string; target: ReportTarget }) {
  return (
    <Link
      to={target.to}
      params={{ budgetId }}
      search={target.search ?? {}}
      className="text-muted-foreground underline hover:text-foreground"
    >
      See the report
    </Link>
  );
}
