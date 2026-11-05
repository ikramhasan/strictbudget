import { type CurrencyCode, money } from "@strictbudget/engine";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChartPie, ChevronRight, Flag, LayoutDashboard } from "lucide-react";
import type { ReactNode } from "react";
import { accountsQueryOptions } from "@/lib/accounts";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { FLAG_CLASS, flagsQueryOptions } from "@/lib/flags";
import {
  type ReportRequest,
  reportActivityOptions,
  reportTransactionsOptions,
} from "@/lib/reports";
import { useColorSlots } from "@/lib/reports-colors";
import {
  BREAKDOWN_LABELS,
  type BreakdownBy,
  type BreakdownRow,
  breakdownOf,
  breakdownRows,
  breakdownStats,
  comparedSpending,
  type SpendingBreakdownSearch,
  UNCATEGORIZED_GROUP,
} from "@/lib/spending-breakdown";
import type { useReportState } from "@/lib/use-report";
import { CategoryLabel } from "../category-label";
import { ChartCard, type ChartKind, ReportEmpty } from "./chart-card";
import type { DrillDown } from "./drill-down-sheet";
import { type BreakdownChartKind, SpendingBreakdownChart } from "./spending-breakdown-chart";
import { SpendingBreakdownList, SpendingBreakdownTable } from "./spending-breakdown-list";

type ReportState = ReturnType<typeof useReportState>;

/** Clicking a group opens it in place ("All Groups › Group"); anything else lists its transactions. */
export function SpendingBreakdownBody({
  search,
  state,
  update,
  onDrill,
}: {
  search: SpendingBreakdownSearch;
  state: ReportState;
  update: (patch: Partial<SpendingBreakdownSearch>) => void;
  onDrill: (drill: DrillDown) => void;
}) {
  const { budget, formatAmount } = useBudget();
  const navigate = useNavigate();
  const currency = budget.currency as CurrencyCode;
  const format = (a: bigint) => formatAmount(money(a, currency));
  const by: BreakdownBy = search.by ?? "category";
  const group = by === "group" ? search.group : undefined;
  const byCategory = by === "category" || by === "group";
  const base = { budgetId: budget.id, kind: "spending" as const };
  const groupBy = [byCategory ? "category" : by] as const;

  const categories = useQuery(categoriesQueryOptions(budget.id));
  const slots = useColorSlots();
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const flags = useQuery(flagsQueryOptions(budget.id));
  const activity = useQuery(
    reportActivityOptions({ ...base, range: state.range, groupBy, filters: state.filters }),
  );
  const compared = useQuery({
    ...reportActivityOptions({
      ...base,
      range: state.comparison ?? state.range,
      groupBy,
      filters: state.filters,
    }),
    enabled: state.comparison !== undefined,
  });
  // Income for "% of income": Ready to Assign inflows on the selected accounts.
  const income = useQuery(
    reportActivityOptions({
      budgetId: budget.id,
      range: state.range,
      kind: "income",
      filters: state.filters.accountIds ? { accountIds: state.filters.accountIds } : {},
    }),
  );

  const uncategorizedId = categories.data?.uncategorizedCategoryId;
  // The lines of the opened group, for its largest transactions and its drill-downs.
  const scope: ReportRequest["filters"] =
    group === undefined
      ? state.filters
      : group === UNCATEGORIZED_GROUP
        ? { ...state.filters, categoryIds: uncategorizedId ?? "" }
        : { ...state.filters, groupIds: group };
  const largest = useQuery({
    ...reportTransactionsOptions({
      ...base,
      range: state.range,
      filters: scope,
      order: "largest_outflow",
      limit: 10,
    }),
    enabled: group !== UNCATEGORIZED_GROUP || uncategorizedId !== undefined,
  });

  const names = {
    categories: categories.data,
    payees: activity.data?.payees ?? [],
    accounts: accounts.data?.accounts ?? [],
    flags: flags.data?.flags ?? [],
    slots,
  };
  const rows = activity.data ? breakdownRows(activity.data.rows, by, names, group) : [];
  const breakdown = breakdownOf(rows);
  // Months before the budget's first transaction aren't months of zero spending.
  const since =
    state.earliest && state.earliest > state.range.from && state.earliest <= state.range.to
      ? { ...state.range, from: state.earliest }
      : state.range;
  const stats = breakdownStats(breakdown, since);
  const previous =
    state.comparison && compared.data
      ? comparedSpending(
          breakdownRows(compared.data.rows, by, { ...names, payees: compared.data.payees }, group),
          state.comparison,
          state.range,
        )
      : undefined;
  const incomeTotal = income.data
    ? income.data.rows.reduce((s, r) => s + BigInt(r.net), 0n)
    : undefined;
  const groupName =
    group === undefined
      ? undefined
      : group === UNCATEGORIZED_GROUP
        ? "Uncategorized"
        : categories.data?.groups.find((g) => g.id === group)?.name;
  const rowNoun = BREAKDOWN_LABELS[group !== undefined ? "category" : by];
  const positiveTitle =
    byCategory && (by === "category" || group !== undefined)
      ? "Positive inflow categories"
      : `Positive inflow ${rowNoun.many.toLowerCase()}`;
  const outflow = largest.data?.transactions.find((t) => BigInt(t.amount) < 0n);

  const select = (row: BreakdownRow) => {
    if (by === "group" && group === undefined) {
      update({ group: row.key });
      return;
    }
    const key = row.key;
    const filters: ReportRequest["filters"] =
      by === "payee"
        ? { ...state.filters, payeeIds: key }
        : by === "account"
          ? { ...state.filters, accountIds: key }
          : by === "flag"
            ? { ...state.filters, flags: key }
            : { ...state.filters, categoryIds: key };
    onDrill({ title: row.name, request: { ...base, range: state.range, filters } });
  };
  const openTransaction = (t: { accountId: string; transactionId: string }) =>
    void navigate({
      to: "/budgets/$budgetId/accounts/$accountId",
      params: { budgetId: budget.id, accountId: t.accountId },
      search: { transaction: t.transactionId },
    });

  const loading = activity.isPending || categories.isPending || !slots;
  const filtered = Object.keys(state.filters).length > 0;
  const noSpending = (
    <ReportEmpty title="No spending to break down">
      {filtered
        ? "Nothing matches these filters in this range. Widen the range or clear a filter."
        : "Spending from your budget accounts in this range will be broken down here once you add transactions."}
    </ReportEmpty>
  );
  const chartKind: BreakdownChartKind = search.chart ?? "donut";
  const oneMonth = state.range.from === state.range.to;

  return (
    <>
      {group !== undefined && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 font-medium text-lg">
          <button
            type="button"
            className="rounded-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => update({ group: undefined })}
          >
            All groups
          </button>
          <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
          <span>{groupName ?? "…"}</span>
        </nav>
      )}

      <dl
        className={cn(
          "grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-3",
          oneMonth ? "lg:grid-cols-4" : "lg:grid-cols-5",
        )}
      >
        <Stat label="Total spending" big>
          {loading ? "…" : format(stats.total)}
        </Stat>
        {/* Over one month the monthly average is the total again. */}
        {!oneMonth && (
          <Stat label="Average monthly spending">
            {loading ? "…" : format(stats.averageMonthly)}
          </Stat>
        )}
        <Stat label="Average daily spending">{loading ? "…" : format(stats.averageDaily)}</Stat>
        <Stat label={`Most frequent ${rowNoun.one.toLowerCase()}`}>
          {stats.mostFrequent ? (
            <>
              <CategoryLabel name={stats.mostFrequent.name} className="flex" />
              <span className="block font-normal text-muted-foreground text-xs">
                {stats.mostFrequent.count}{" "}
                {stats.mostFrequent.count === 1 ? "transaction" : "transactions"}
              </span>
            </>
          ) : (
            "—"
          )}
        </Stat>
        <Stat label="Largest outflow">
          {outflow ? (
            <>
              <span className="block truncate">{outflow.payeeName ?? "No payee"}</span>
              <span className="block font-normal text-muted-foreground text-xs tabular-nums">
                {format(-BigInt(outflow.amount))}
              </span>
            </>
          ) : (
            "—"
          )}
        </Stat>
      </dl>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ChartCard
          title="Total spending"
          view={state.view}
          kinds={CHART_KINDS}
          kind={chartKind}
          onViewChange={(view, kind) =>
            update({
              view: view === "chart" ? undefined : view,
              ...(kind && { chart: kind === "donut" ? undefined : (kind as BreakdownChartKind) }),
            })
          }
          loading={loading}
          empty={rows.length === 0 ? noSpending : undefined}
          fileName="strictbudget-spending-breakdown"
          className="content-start"
          chart={
            <SpendingBreakdownChart
              kind={chartKind}
              breakdown={breakdown}
              nested={by === "category"}
              onSelect={select}
            />
          }
          table={
            <SpendingBreakdownTable
              breakdown={breakdown}
              income={incomeTotal}
              previous={previous}
              rowTitle={rowNoun.many}
              positiveTitle={positiveTitle}
              onSelect={select}
            />
          }
        />
        <section
          aria-label={`${rowNoun.many} list`}
          className="grid content-start gap-2 rounded-lg border bg-card p-4"
        >
          <h2 className="flex justify-between font-semibold">
            {rowNoun.many}
            <span className="font-normal text-muted-foreground text-sm">Total spending</span>
          </h2>
          {loading ? null : rows.length === 0 ? (
            <p className="py-2 text-muted-foreground text-sm">
              Each {rowNoun.one.toLowerCase()}'s share of your spending will be listed here.
            </p>
          ) : (
            <SpendingBreakdownList
              breakdown={breakdown}
              income={incomeTotal}
              previous={previous}
              positiveTitle={positiveTitle}
              onSelect={select}
            />
          )}
        </section>
      </div>

      <section
        aria-label="Largest transactions"
        className="grid gap-2 rounded-lg border bg-card p-4"
      >
        <h2 className="font-semibold">Largest transactions</h2>
        {largest.data?.transactions.some((t) => BigInt(t.amount) < 0n) ? (
          <ol className="divide-y">
            {largest.data.transactions
              .filter((t) => BigInt(t.amount) < 0n)
              .map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => openTransaction(t)}
                    className="grid w-full grid-cols-[1fr_auto] gap-x-3 px-1 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <span className="flex min-w-0 items-center gap-1 font-medium">
                      {t.flag && (
                        <Flag
                          aria-label={`${t.flag} flag`}
                          className={`size-3.5 shrink-0 fill-current ${FLAG_CLASS[t.flag]}`}
                        />
                      )}
                      <span className="truncate">{t.payeeName ?? "No payee"}</span>
                    </span>
                    <span className="text-right font-medium tabular-nums">
                      {format(-BigInt(t.amount))}
                    </span>
                    <span className="col-span-2 truncate text-muted-foreground text-xs">
                      <TransactionMeta t={t} uncategorizedId={uncategorizedId} />
                    </span>
                  </button>
                </li>
              ))}
          </ol>
        ) : (
          <p className="text-muted-foreground text-sm">
            {largest.isPending ? "…" : "No outflows in this range."}
          </p>
        )}
      </section>
    </>
  );
}

const CHART_KINDS: readonly ChartKind[] = [
  { value: "donut", label: "Donut", icon: <ChartPie /> },
  { value: "treemap", label: "Treemap", icon: <LayoutDashboard /> },
];

function TransactionMeta({
  t,
  uncategorizedId,
}: {
  t: {
    date: string;
    accountName: string;
    categoryId: string | null;
    groupName: string | null;
    categoryName: string | null;
  };
  uncategorizedId: string | undefined;
}) {
  const { formatDate } = useBudget();
  const category =
    t.categoryId === uncategorizedId
      ? "Uncategorized"
      : t.categoryName && `${t.groupName ? `${t.groupName}: ` : ""}${t.categoryName}`;
  return (
    <>
      {formatDate(t.date)} · {t.accountName}
      {category && ` · ${category}`}
    </>
  );
}

function Stat({ label, big, children }: { label: string; big?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={big ? "font-semibold text-xl tabular-nums" : "font-medium tabular-nums"}>
        {children}
      </dd>
    </div>
  );
}
