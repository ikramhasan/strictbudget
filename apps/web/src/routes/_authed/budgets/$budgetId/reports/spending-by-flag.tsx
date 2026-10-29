import {
  averageOf,
  type BudgetMonth,
  exportDelimiter,
  isOnBudget,
  money,
  monthsIn,
  toDelimited,
} from "@strictbudget/engine";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Flag } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ChartCard } from "@/components/reports/chart-card";
import { type DrillDown, DrillDownSheet } from "@/components/reports/drill-down-sheet";
import { ExportButton } from "@/components/reports/export-button";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportPage } from "@/components/reports/report-page";
import {
  SpendingBreakdownList,
  SpendingBreakdownTable,
} from "@/components/reports/spending-breakdown-list";
import { FlagMonthChart, FlagMonthTable } from "@/components/reports/spending-by-flag";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { todayIso } from "@/lib/dates";
import { FLAG_CLASS, FLAG_COLOR, flagName, flagsQueryOptions } from "@/lib/flags";
import { monthLabel, rangeLabel, reportActivityOptions, UNCATEGORIZED_COLOR } from "@/lib/reports";
import { breakdownOf, breakdownRows } from "@/lib/spending-breakdown";
import {
  exportName,
  exportRows,
  flagOfKey,
  flagRows,
  monthBars,
  type SpendingByFlagSearch,
  spendingByFlagSearchSchema,
} from "@/lib/spending-by-flag";
import { useReportState } from "@/lib/use-report";

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/spending-by-flag")({
  validateSearch: spendingByFlagSearchSchema,
  component: Report,
});

type ReportState = ReturnType<typeof useReportState>;

/**
 * Spending per flag, by each flag's custom name, so a trip, a project or what's to be reimbursed
 * adds up on its own; one flag opens on its categories and its months. Unflagged spending is kept
 * apart.
 */
function Report() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { budget } = useBudget();
  const queryClient = useQueryClient();
  // Trips and projects span months, so a year rather than this month.
  const state = useReportState(search, "last_12_months");
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const update = (patch: Partial<SpendingByFlagSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });

  const exportFiles = async () => {
    const [categories, flags, sums] = await Promise.all([
      queryClient.fetchQuery(categoriesQueryOptions(budget.id)),
      queryClient.fetchQuery(flagsQueryOptions(budget.id)),
      queryClient.fetchQuery(
        reportActivityOptions({
          budgetId: budget.id,
          range: state.range,
          kind: "spending",
          groupBy: ["flag", "category"],
          filters: state.filters,
        }),
      ),
    ]);
    const delimiter = exportDelimiter(budget.numberFormat);
    return [
      {
        name: exportName(todayIso(), delimiter),
        text: toDelimited(
          exportRows(sums.rows, flags.flags, categories, budget.numberFormat, budget.currency),
          delimiter,
        ),
      },
    ];
  };

  return (
    <ReportPage
      title="Spending by Flag"
      actions={<ExportButton files={exportFiles} zipName={exportName(todayIso(), ",")} />}
      filters={
        <ReportFilterBar
          search={search}
          update={update}
          range={state.range}
          preset={state.preset}
          current={state.current}
          earliest={state.earliest}
          show={["categories", "accounts", "payees"]}
          accountFilter={(a) => isOnBudget(a.type)}
        />
      }
    >
      {search.flag === undefined ? (
        <Overview search={search} state={state} update={update} />
      ) : (
        <OneFlag
          flagKey={search.flag}
          search={search}
          state={state}
          update={update}
          onDrill={setDrill}
        />
      )}
      <DrillDownSheet drill={drill} onClose={() => setDrill(null)} />
    </ReportPage>
  );
}

function Overview({
  search,
  state,
  update,
}: {
  search: SpendingByFlagSearch;
  state: ReportState;
  update: (patch: Partial<SpendingByFlagSearch>) => void;
}) {
  const { budget, formatAmount } = useBudget();
  const format = (a: bigint) => formatAmount(money(a, budget.currency));
  const flags = useQuery(flagsQueryOptions(budget.id));
  const activity = useQuery(
    reportActivityOptions({
      budgetId: budget.id,
      range: state.range,
      kind: "spending",
      groupBy: ["flag"],
      filters: state.filters,
    }),
  );
  const loading = activity.isPending || flags.isPending;
  const result =
    activity.data && flags.data ? flagRows(activity.data.rows, flags.data.flags) : null;
  const breakdown = breakdownOf(result?.rows ?? []);
  const used = result?.rows.filter((r) => r.count > 0) ?? [];
  const empty = activity.isError
    ? "Couldn't load the report."
    : result && used.length === 0
      ? "No flagged spending in these months. Flag transactions in a register to follow a trip, a project or what's to be reimbursed."
      : undefined;
  const open = (row: { key: string }) => update({ flag: row.key, view: undefined });

  return (
    <>
      <section
        aria-label="Summary"
        className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3"
      >
        {loading || !result ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <Stat
              label="Flagged spending"
              value={format(breakdown.total)}
              note={countLabel(used.reduce((n, r) => n + r.count, 0))}
            />
            <Stat
              label="Unflagged spending"
              value={format(-result.unflagged.net)}
              note={countLabel(result.unflagged.count)}
              onClick={result.unflagged.count > 0 ? () => update({ flag: "none" }) : undefined}
            />
          </>
        )}
      </section>
      <ChartCard
        title={`Spending by flag · ${rangeLabel(state.range)}`}
        view={search.view ?? "chart"}
        onViewChange={(view) => update({ view })}
        loading={loading}
        empty={empty}
        fileName={`spending-by-flag-${state.range.from}-${state.range.to}`}
        chart={
          <SpendingBreakdownList
            breakdown={breakdown}
            income={undefined}
            previous={undefined}
            positiveTitle="Positive Inflow Flags"
            onSelect={open}
          />
        }
        table={
          <SpendingBreakdownTable
            breakdown={breakdown}
            income={undefined}
            previous={undefined}
            rowTitle="Flag"
            positiveTitle="Positive Inflow Flags"
            onSelect={open}
          />
        }
      />
      <p className="text-muted-foreground text-sm">
        Spending is the plan's Activity: spending less refunds, on cash and credit accounts. A
        split's lines count under the split's flag. Name your flags in a register's flag menu.
      </p>
    </>
  );
}

function OneFlag({
  flagKey,
  search,
  state,
  update,
  onDrill,
}: {
  flagKey: string;
  search: SpendingByFlagSearch;
  state: ReportState;
  update: (patch: Partial<SpendingByFlagSearch>) => void;
  onDrill: (drill: DrillDown) => void;
}) {
  const { budget, formatAmount } = useBudget();
  const format = (a: bigint) => formatAmount(money(a, budget.currency));
  const flag = flagOfKey(flagKey);
  const flags = useQuery(flagsQueryOptions(budget.id));
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const filters = { ...state.filters, flags: flagKey };
  const base = { budgetId: budget.id, range: state.range, kind: "spending" as const, filters };
  const byCategory = useQuery(reportActivityOptions({ ...base, groupBy: ["category"] }));
  const byMonth = useQuery(reportActivityOptions({ ...base, groupBy: ["month"] }));

  const name = flagName(flag, flags.data?.flags ?? []);
  const color = flag ? FLAG_COLOR[flag] : UNCATEGORIZED_COLOR;
  const rows =
    byCategory.data && categories.data
      ? breakdownRows(byCategory.data.rows, "category", {
          categories: categories.data,
          payees: [],
          accounts: [],
          flags: [],
        })
      : [];
  const breakdown = breakdownOf(rows);
  const bars = byMonth.data ? monthBars(byMonth.data.rows, state.range) : [];
  const count = rows.reduce((sum, r) => sum + r.count, 0);
  const loading = byCategory.isPending || categories.isPending;
  const empty = byCategory.isError
    ? "Couldn't load the report."
    : byCategory.data && rows.length === 0
      ? `No spending with ${flag ? `the ${name} flag` : "no flag"} in these months.`
      : undefined;

  const drillCategory = (row: { key: string; name: string }) =>
    onDrill({
      title: `${name} · ${row.name}`,
      request: { ...base, filters: { ...filters, categoryIds: row.key } },
    });
  const drillMonth = (month: BudgetMonth) =>
    onDrill({
      title: `${name} · ${monthLabel(month, "long")}`,
      request: { ...base, range: { from: month, to: month } },
    });

  return (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => update({ flag: undefined, view: undefined, months: undefined })}
        >
          All flags
        </button>
        <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
        <span className="flex items-center gap-1 font-medium">
          {flag && <Flag aria-hidden className={`size-4 fill-current ${FLAG_CLASS[flag]}`} />}
          {name}
        </span>
      </nav>
      <section
        aria-label="Summary"
        className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3"
      >
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <Stat label="Spending" value={format(breakdown.total)} />
            <Stat label="Transactions" value={String(count)} />
            <Stat
              label="Average per month"
              value={format(averageOf(breakdown.total, monthsIn(state.range).length))}
            />
          </>
        )}
      </section>
      <ChartCard
        title={`Categories · ${rangeLabel(state.range)}`}
        view={search.view ?? "chart"}
        onViewChange={(view) => update({ view })}
        loading={loading}
        empty={empty}
        fileName={`spending-by-flag-${flagKey}-categories-${state.range.from}-${state.range.to}`}
        chart={
          <SpendingBreakdownList
            breakdown={breakdown}
            income={undefined}
            previous={undefined}
            positiveTitle="Positive Inflow Categories"
            onSelect={drillCategory}
          />
        }
        table={
          <SpendingBreakdownTable
            breakdown={breakdown}
            income={undefined}
            previous={undefined}
            rowTitle="Category"
            positiveTitle="Positive Inflow Categories"
            onSelect={drillCategory}
          />
        }
      />
      <ChartCard
        title={`By month · ${rangeLabel(state.range)}`}
        view={search.months ?? "chart"}
        onViewChange={(months) => update({ months })}
        loading={byMonth.isPending}
        empty={byMonth.isError ? "Couldn't load the report." : empty}
        fileName={`spending-by-flag-${flagKey}-months-${state.range.from}-${state.range.to}`}
        chart={<FlagMonthChart bars={bars} color={color} onPick={drillMonth} />}
        table={<FlagMonthTable bars={bars} onPick={drillMonth} />}
      />
    </>
  );
}

const countLabel = (count: number) => `${count} ${count === 1 ? "transaction" : "transactions"}`;

function Stat({
  label,
  value,
  note,
  onClick,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-semibold text-2xl tabular-nums">{value}</span>
      {note && <span className="text-muted-foreground text-xs tabular-nums">{note}</span>}
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="grid content-start gap-1 rounded-lg border p-4 text-left transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </button>
  ) : (
    <div className="grid content-start gap-1 rounded-lg border p-4">{body}</div>
  );
}
