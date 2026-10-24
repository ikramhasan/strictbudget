import {
  addMonths,
  averageMonthlySpending,
  averageOf,
  type BudgetMonth,
  type CurrencyCode,
  exportDelimiter,
  isOnBudget,
  type MonthRange,
  money,
  monthsIn,
  rollingAverage,
  toDelimited,
  trendMonths,
} from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@strictbudget/ui/components/table";
import { Toggle } from "@strictbudget/ui/components/toggle";
import { ToggleGroup, ToggleGroupItem } from "@strictbudget/ui/components/toggle-group";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarDays,
  ChartColumnStacked,
  ChartLine,
  ChevronRight,
  LayoutGrid,
  Percent,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { ChartCard } from "@/components/reports/chart-card";
import { type DrillDown, DrillDownSheet } from "@/components/reports/drill-down-sheet";
import { ExportButton } from "@/components/reports/export-button";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportPage } from "@/components/reports/report-page";
import { SpendingCalendar } from "@/components/reports/spending-trends-calendar";
import {
  TrendBarsChart,
  TrendBarsKey,
  type TrendChartData,
  TrendLegend,
  TrendLinesChart,
  TrendMultiples,
  type TrendOverlays,
  TrendShareChart,
} from "@/components/reports/spending-trends-charts";
import { TrendMonthsTable, TrendSeriesTable } from "@/components/reports/spending-trends-tables";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { todayIso } from "@/lib/dates";
import {
  COMPARISON_LABELS,
  type ReportRequest,
  reportActivityOptions,
  reportTransactionsOptions,
} from "@/lib/reports";
import {
  type CalendarDay,
  type Catalog,
  catalogOf,
  cellsOf,
  chartedMonths,
  exportBaseName,
  OTHER_KEY,
  seriesInfo,
  seriesKeys,
  summaryExportRows,
  TOP_SERIES,
  TREND_MODE_LABELS,
  TREND_MODES,
  type TrendLevel,
  type TrendMode,
  type TrendsSearch,
  transactionExportRows,
  trendsSearchSchema,
  withOther,
} from "@/lib/spending-trends";
import { useReportState } from "@/lib/use-report";

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/spending-trends")({
  validateSearch: trendsSearchSchema,
  component: Report,
});

/** Months read before the range, for the first month's change and rolling average. */
const LEAD_MONTHS = 2;

const MODE_ICONS: Record<TrendMode, ReactNode> = {
  bars: <ChartColumnStacked />,
  lines: <ChartLine />,
  share: <Percent />,
  multiples: <LayoutGrid />,
  calendar: <CalendarDays />,
};

function Report() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const update = (patch: Partial<TrendsSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });
  const state = useReportState(search, "last_3_months");
  const { budget, formatAmount, formatDate } = useBudget();
  const queryClient = useQueryClient();
  const currency = budget.currency as CurrencyCode;
  const format = (v: bigint) => formatAmount(money(v, currency));

  const mode = search.mode ?? "bars";
  const level: TrendLevel = search.group ? "category" : (search.by ?? "category");
  const [overlays, setOverlays] = useState<TrendOverlays>({ average: true, rolling: false });
  const [drill, setDrill] = useState<DrillDown | null>(null);

  const categories = useQuery(categoriesQueryOptions(budget.id));
  const catalog = useMemo(
    () => (categories.data ? catalogOf(categories.data) : null),
    [categories.data],
  );
  const filters = { ...state.filters, ...(search.group && { groupIds: search.group }) };
  const request = (range: MonthRange, extra?: Partial<ReportRequest>): ReportRequest => ({
    budgetId: budget.id,
    range,
    kind: "spending",
    filters,
    ...extra,
  });
  const lead = { from: addMonths(state.range.from, -LEAD_MONTHS), to: state.range.to };
  const activity = useQuery(
    reportActivityOptions(request(lead, { groupBy: ["month", "category"] })),
  );
  const comparison = useQuery({
    ...reportActivityOptions(request(state.comparison ?? state.range, { groupBy: ["month"] })),
    enabled: state.comparison !== undefined,
  });
  const daily = useQuery({
    ...reportActivityOptions(request(state.range, { groupBy: ["day"] })),
    enabled: mode === "calendar",
  });

  const derived = useMemo(() => {
    if (!catalog || !activity.data) return null;
    const leadMonths = trendMonths(cellsOf(activity.data.rows, catalog, level), monthsIn(lead));
    const months = leadMonths.slice(LEAD_MONTHS);
    const rollingValues = rollingAverage(
      leadMonths.map((m) => m.total),
      3,
    );
    const previous = new Map<BudgetMonth, bigint>();
    const rolling = new Map<BudgetMonth, bigint | null>();
    leadMonths.forEach((m, i) => {
      const before = leadMonths[i - 1];
      if (before) previous.set(m.month, before.total);
      rolling.set(m.month, rollingValues[i] ?? null);
    });
    const average = averageMonthlySpending(months);
    const total = months.reduce((s, m) => s + m.total, 0n);
    let compared: TrendChartData["comparison"] = null;
    if (state.comparison && comparison.data && search.compare) {
      const label = COMPARISON_LABELS[search.compare];
      const compMonths = trendMonths(
        comparison.data.rows.flatMap((r) =>
          r.month ? [{ month: r.month as BudgetMonth, key: "all", net: BigInt(r.net) }] : [],
        ),
        monthsIn(state.comparison),
      );
      if (state.comparison.average) {
        compared = { kind: "average", label, average: averageMonthlySpending(compMonths) };
      } else {
        compared = {
          kind: "period",
          label,
          totals: new Map(months.map((m, i) => [m.month, compMonths[i]?.total ?? 0n])),
        };
      }
    }
    const info = (key: string) => seriesInfo(catalog, level, key);
    const base = { average, previous, rolling, comparison: compared, info };
    const all: TrendChartData = { ...base, months, keys: seriesKeys(months, catalog, level) };
    const folded = withOther(months, TOP_SERIES);
    const top: TrendChartData = { ...base, months: folded.months, keys: folded.keys };
    return { all, top, total, average };
  }, [
    catalog,
    activity.data,
    comparison.data,
    level,
    state.range,
    state.comparison,
    search.compare,
  ]);

  const pick = (month: BudgetMonth | null, key: string | null, data: TrendChartData) => {
    if (!catalog) return;
    const range = month ? { from: month, to: month } : state.range;
    if (key === null) {
      setDrill({ title: "Total Spending", request: request(range) });
      return;
    }
    if (level === "group" && key !== catalog.uncategorizedId && key !== OTHER_KEY) {
      update({ group: key, by: undefined });
      return;
    }
    const chosen = filters.categoryIds?.split(",");
    const categoryIds = (
      key === OTHER_KEY ? otherCategories(catalog, level, data) : categoryIdsOf(catalog, level, key)
    ).filter((id) => !chosen || chosen.includes(id));
    setDrill({
      title: key === catalog.uncategorizedId ? "Uncategorized Transactions" : data.info(key).label,
      request: request(range, { filters: { ...filters, categoryIds: categoryIds.join(",") } }),
    });
  };

  const pickDay = (day: CalendarDay) =>
    setDrill({
      title: "Spending",
      period: formatDate(day.date),
      request: request(
        { from: day.date.slice(0, 7), to: day.date.slice(0, 7) },
        { days: { fromDate: day.date, toDate: day.date } },
      ),
    });

  const exportFiles = async () => {
    if (!catalog || !activity.data) return [];
    const delimiter = exportDelimiter(budget.numberFormat);
    const lines = await queryClient.fetchQuery(reportTransactionsOptions(request(state.range)));
    const base = exportBaseName(todayIso());
    return [
      {
        name: `${base}.csv`,
        text: toDelimited(
          summaryExportRows({
            rows: activity.data.rows.filter((r) => r.month && r.month >= state.range.from),
            catalog,
            range: state.range,
            average: averageOf,
            currency,
            numberFormat: budget.numberFormat,
          }),
          delimiter,
        ),
      },
      {
        name: `${base}-transactions.csv`,
        text: toDelimited(
          transactionExportRows({
            transactions: lines.transactions,
            uncategorizedId: catalog.uncategorizedId,
            currency,
            settings: budget,
            formatDate,
          }),
          delimiter,
        ),
      },
    ];
  };

  const groupName = search.group && catalog?.groups.get(search.group)?.label;
  const loading = !derived;
  const empty = derived && derived.all.keys.length === 0 ? "No spending in this range." : undefined;
  const dayMap = new Map(
    (daily.data?.rows ?? []).flatMap((r) =>
      r.day ? [[r.day, { total: -BigInt(r.net), count: r.count }] as const] : [],
    ),
  );

  const chart = (() => {
    if (!derived) return null;
    const { all, top } = derived;
    switch (mode) {
      case "bars":
        return (
          <div className="grid gap-2">
            <TrendBarsChart
              data={all}
              charted={chartedMonths(all.months)}
              overlays={overlays}
              onPick={(m, k) => pick(m, k, all)}
            />
            <TrendBarsKey data={all} overlays={overlays} />
            <TrendLegend data={all} onPick={(k) => pick(null, k, all)} />
          </div>
        );
      case "lines":
        return (
          <div className="grid gap-2">
            <TrendLinesChart data={top} onPick={(m, k) => pick(m, k, top)} />
            <TrendLegend data={top} onPick={(k) => pick(null, k, top)} />
          </div>
        );
      case "share":
        return (
          <div className="grid gap-2">
            <TrendShareChart data={top} onPick={(m, k) => pick(m, k, top)} />
            <TrendLegend data={top} onPick={(k) => pick(null, k, top)} />
          </div>
        );
      case "multiples":
        return <TrendMultiples data={all} onPick={(m, k) => pick(m, k, all)} />;
      case "calendar":
        return daily.data ? (
          <SpendingCalendar range={state.range} days={dayMap} today={todayIso()} onPick={pickDay} />
        ) : null;
    }
  })();

  const table = !derived ? null : mode === "calendar" ? (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Spending</TableHead>
          <TableHead className="text-right">Transactions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...dayMap]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([date, d]) => (
            <TableRow key={date}>
              <TableCell>
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => pickDay({ date, ...d, future: false })}
                >
                  {formatDate(date)}
                </button>
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(d.total)}</TableCell>
              <TableCell className="text-right tabular-nums">{d.count}</TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  ) : (
    <TrendSeriesTable
      data={mode === "lines" || mode === "share" ? derived.top : derived.all}
      onPick={(k) =>
        pick(null, k, mode === "lines" || mode === "share" ? derived.top : derived.all)
      }
    />
  );

  return (
    <ReportPage
      title="Spending Trends"
      actions={
        <ExportButton
          files={exportFiles}
          zipName={`${exportBaseName(todayIso())}.zip`}
          disabled={loading}
        />
      }
      filters={
        <ReportFilterBar
          search={search}
          update={update}
          range={state.range}
          preset={state.preset}
          current={state.current}
          earliest={state.earliest}
          show={["categories", "accounts", "payees", "flags", "compare"]}
          accountFilter={(a) => isOnBudget(a.type)}
        />
      }
    >
      <section aria-label="Summary" className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <p className="text-muted-foreground text-sm">Average Monthly Spending</p>
          <p className="font-semibold text-3xl tabular-nums">
            {derived ? format(derived.average) : "–"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-sm">Total Spending</p>
          <p className="font-semibold text-lg tabular-nums">
            {derived ? format(derived.total) : "–"}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={mode}
          onValueChange={(v) => v && update({ mode: v === "bars" ? undefined : (v as TrendMode) })}
          aria-label="Chart type"
        >
          {TREND_MODES.map((m) => (
            <ToggleGroupItem
              key={m}
              value={m}
              aria-label={TREND_MODE_LABELS[m]}
              title={TREND_MODE_LABELS[m]}
            >
              {MODE_ICONS[m]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {mode !== "calendar" &&
          (search.group ? (
            <nav aria-label="Drill-down" className="flex items-center gap-1 text-sm">
              <Button
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={() => update({ group: undefined, by: "group" })}
              >
                All groups
              </Button>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-medium">{groupName ?? "Group"}</span>
            </nav>
          ) : (
            <NativeSelect
              aria-label="Series"
              size="sm"
              value={level}
              onChange={(e) => update({ by: e.target.value === "group" ? "group" : undefined })}
            >
              <NativeSelectOption value="category">By category</NativeSelectOption>
              <NativeSelectOption value="group">By category group</NativeSelectOption>
            </NativeSelect>
          ))}
        {mode === "bars" && (
          <div className="flex items-center gap-1">
            <Toggle
              size="sm"
              variant="outline"
              pressed={overlays.average}
              onPressedChange={(average) => setOverlays((o) => ({ ...o, average }))}
            >
              Average
            </Toggle>
            <Toggle
              size="sm"
              variant="outline"
              pressed={overlays.rolling}
              onPressedChange={(rolling) => setOverlays((o) => ({ ...o, rolling }))}
            >
              3-month average
            </Toggle>
          </div>
        )}
      </div>

      <ChartCard
        title={TREND_MODE_LABELS[mode]}
        view={state.view}
        onViewChange={(view) => update({ view: view === "chart" ? undefined : view })}
        loading={loading || (mode === "calendar" && daily.isPending)}
        empty={empty}
        chart={chart}
        table={table}
        fileName={exportBaseName(todayIso())}
      />

      {derived && (
        <section aria-label="Months" className="overflow-x-auto rounded-lg border">
          <TrendMonthsTable data={derived.all} />
        </section>
      )}

      <DrillDownSheet drill={drill} onClose={() => setDrill(null)} />
    </ReportPage>
  );
}

/** The categories a series stands for (a group's own categories, or the category itself). */
function categoryIdsOf(catalog: Catalog, level: TrendLevel, key: string): string[] {
  if (level === "category" || key === catalog.uncategorizedId) return [key];
  return [...catalog.categories.values()].filter((c) => c.groupId === key).map((c) => c.key);
}

/** The categories folded into "Other": every series with lines that isn't shown by name. */
function otherCategories(catalog: Catalog, level: TrendLevel, data: TrendChartData): string[] {
  const named = new Set(data.keys);
  const ids = new Set<string>();
  for (const c of catalog.categories.values()) {
    const key = level === "group" && c.key !== catalog.uncategorizedId ? c.groupId : c.key;
    if (key && !named.has(key)) ids.add(c.key);
  }
  return [...ids];
}
