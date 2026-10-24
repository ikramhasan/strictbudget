import { type CurrencyCode, money } from "@strictbudget/engine";
import { ToggleGroup, ToggleGroupItem } from "@strictbudget/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Flag } from "lucide-react";
import type { ReactNode } from "react";
import { accountsQueryOptions } from "@/lib/accounts";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { FLAG_CLASS, flagsQueryOptions } from "@/lib/flags";
import {
  type ReportRequest,
  rangeLabel,
  reportActivityOptions,
  reportTransactionsOptions,
} from "@/lib/reports";
import {
  BREAKDOWN_BY,
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
import { ChartCard } from "./chart-card";
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
  };
  const rows = activity.data ? breakdownRows(activity.data.rows, by, names, group) : [];
  const breakdown = breakdownOf(rows);
  const stats = breakdownStats(breakdown, state.range);
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
      ? "Positive Inflow Categories"
      : `Positive Inflow ${rowNoun.many}`;
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

  const loading = activity.isPending || categories.isPending;
  const chartKind: BreakdownChartKind = search.chart ?? "donut";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {group !== undefined ? (
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 font-medium text-lg">
            <button
              type="button"
              className="text-primary-text hover:underline"
              onClick={() => update({ group: undefined })}
            >
              All Groups
            </button>
            <ChevronRight className="size-4 text-muted-foreground" />
            <span>{groupName ?? "…"}</span>
          </nav>
        ) : null}
        <div className="-mx-1 ml-auto max-w-full overflow-x-auto px-1">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={by}
            onValueChange={(v) => v && update({ by: v as BreakdownBy, group: undefined })}
            aria-label="Break down by"
          >
            {BREAKDOWN_BY.map((b) => (
              <ToggleGroupItem key={b} value={b} className="px-2.5">
                {BREAKDOWN_LABELS[b].many}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-lg border p-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total Spending" big>
          {loading ? "…" : format(stats.total)}
        </Stat>
        <Stat label="Average Monthly Spending">{loading ? "…" : format(stats.averageMonthly)}</Stat>
        <Stat label="Average Daily Spending">{loading ? "…" : format(stats.averageDaily)}</Stat>
        <Stat label={`Most Frequent ${rowNoun.one}`}>
          {stats.mostFrequent ? (
            <>
              <span className="block truncate">{stats.mostFrequent.name}</span>
              <span className="block font-normal text-muted-foreground text-xs">
                {stats.mostFrequent.count}{" "}
                {stats.mostFrequent.count === 1 ? "transaction" : "transactions"}
              </span>
            </>
          ) : (
            "—"
          )}
        </Stat>
        <Stat label="Largest Outflow">
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
          title={`Total Spending · ${rangeLabel(state.range)}`}
          view={state.view}
          onViewChange={(view) => update({ view })}
          loading={loading}
          empty={rows.length === 0 ? "No spending in this range with these filters." : undefined}
          fileName="strictbudget-spending-breakdown"
          className="content-start"
          chart={
            <div className="grid gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={chartKind}
                onValueChange={(v) =>
                  v && update({ chart: v === "donut" ? undefined : (v as BreakdownChartKind) })
                }
                aria-label="Chart type"
                className="justify-self-end"
              >
                <ToggleGroupItem value="donut" className="px-2.5">
                  Donut
                </ToggleGroupItem>
                <ToggleGroupItem value="treemap" className="px-2.5">
                  Treemap
                </ToggleGroupItem>
              </ToggleGroup>
              <SpendingBreakdownChart
                kind={chartKind}
                breakdown={breakdown}
                nested={by === "category"}
                onSelect={select}
              />
            </div>
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
          className="grid content-start gap-2 rounded-lg border p-4"
        >
          <h2 className="flex justify-between font-semibold">
            {rowNoun.many}
            <span className="font-normal text-muted-foreground text-sm">Total Spending</span>
          </h2>
          {loading ? null : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing to show.</p>
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

      <section aria-label="Largest transactions" className="grid gap-2 rounded-lg border p-4">
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
