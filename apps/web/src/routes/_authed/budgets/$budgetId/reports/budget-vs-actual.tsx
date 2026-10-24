import {
  type BudgetMonth,
  currencyExponent,
  exportDelimiter,
  money,
  toDelimited,
} from "@strictbudget/engine";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
  BulletChart,
  Heatmap,
  HeatmapTable,
  STATUS_COLOR,
  VarianceTable,
} from "@/components/reports/budget-vs-actual";
import { ChartCard } from "@/components/reports/chart-card";
import { type DrillDown, DrillDownSheet } from "@/components/reports/drill-down-sheet";
import { ExportButton } from "@/components/reports/export-button";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportPage } from "@/components/reports/report-page";
import { useBudget } from "@/lib/budget-context";
import {
  budgetVsActual,
  budgetVsActualOptions,
  exportName,
  exportRows,
  percentOfPlan,
  planStatus,
} from "@/lib/budget-vs-actual";
import { categoriesQueryOptions } from "@/lib/categories";
import { todayIso } from "@/lib/dates";
import { monthLabel, rangeLabel, reportSearchSchema, splitIds } from "@/lib/reports";
import { useReportState } from "@/lib/use-report";

const searchSchema = reportSearchSchema.extend({
  heat: z.enum(["chart", "table"]).optional().catch(undefined),
});
type Search = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/budget-vs-actual")({
  validateSearch: searchSchema,
  component: Report,
});

/**
 * Each category's Assigned against what it spent, from the plan's own month numbers.
 */
function Report() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { budget, formatAmount } = useBudget();
  const state = useReportState(search, "this_month");
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const update = (patch: Partial<Search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });
  const format = (amount: bigint) => formatAmount(money(amount, budget.currency));

  const query = useQuery(budgetVsActualOptions(budget.id, state.range));
  const categories = useQuery(categoriesQueryOptions(budget.id));
  const report =
    query.data && categories.data
      ? budgetVsActual(query.data, categories.data, state.range, splitIds(search.categories))
      : null;
  const loading = query.isPending || categories.isPending;
  const empty = query.isError
    ? "Couldn't load the report."
    : report && report.groups.length === 0
      ? "Nothing was assigned or spent in these months."
      : undefined;

  const onCategory = (row: { categoryId: string; name: string }, month?: BudgetMonth) =>
    setDrill({
      title: row.name,
      request: {
        budgetId: budget.id,
        range: month ? { from: month, to: month } : state.range,
        kind: "spending",
        filters: { categoryIds: row.categoryId },
      },
    });

  const exportFiles = () => {
    if (!report) return [];
    const delimiter = exportDelimiter(budget.numberFormat);
    return [
      {
        name: exportName(todayIso(), delimiter),
        text: toDelimited(
          exportRows(report, budget.numberFormat, currencyExponent(budget.currency)),
          delimiter,
        ),
      },
    ];
  };

  const status = report ? planStatus(report.assigned, report.spent) : "on";
  const percent = report ? percentOfPlan(report.spent, report.assigned) : null;
  const left = report ? report.assigned - report.spent : 0n;
  const heatRange =
    report && report.months.length > 0
      ? rangeLabel({
          from: report.months[0] as BudgetMonth,
          to: report.months.at(-1) as BudgetMonth,
        })
      : "";

  return (
    <ReportPage
      title="Budget vs Actual"
      actions={
        <ExportButton
          files={exportFiles}
          zipName={exportName(todayIso(), ",")}
          disabled={!report || report.groups.length === 0}
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
          show={["categories"]}
        />
      }
    >
      <section
        aria-label="Summary"
        className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3"
      >
        {loading || !report ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <Stat label="Assigned" value={format(report.assigned)} />
            <Stat label="Spent" value={format(report.spent)} />
            <Stat
              label={left >= 0n ? "Left" : "Over plan"}
              value={format(left < 0n ? -left : left)}
              color={STATUS_COLOR[status]}
            />
            <Stat label="Spent of plan" value={percent === null ? "—" : `${percent.toFixed(1)}%`} />
          </>
        )}
      </section>
      <p className="text-muted-foreground text-sm">
        Assigned is each month's Assigned on your plan, so money you moved between categories counts
        where it ended up. Spent is the plan's Activity: spending less refunds, on cash and credit
        accounts. Ready to Assign and credit card payments aren't listed.
      </p>

      <ChartCard
        title={`Assigned vs spent · ${rangeLabel(state.range)}`}
        view={search.view ?? "chart"}
        onViewChange={(view) => update({ view })}
        loading={loading}
        empty={empty}
        fileName={`budget-vs-actual-${state.range.from}-${state.range.to}`}
        chart={report && <BulletChart report={report} onCategory={onCategory} />}
        table={report && <VarianceTable report={report} onCategory={onCategory} />}
      />

      <ChartCard
        title={`Overspending by month · ${heatRange}`}
        view={search.heat ?? "chart"}
        onViewChange={(heat) => update({ heat })}
        loading={loading}
        empty={empty}
        fileName={`budget-vs-actual-heatmap-${state.range.to}`}
        chart={report && <Heatmap report={report} onCategory={onCategory} />}
        table={report && <HeatmapTable report={report} />}
      />
      {report && report.months.length > 0 && (report.months[0] ?? "") < state.range.from && (
        <p className="-mt-2 text-muted-foreground text-xs">
          The heatmap reaches back to {monthLabel(report.months[0] as BudgetMonth, "long")} so a
          short range still shows the last 12 months.
        </p>
      )}

      <DrillDownSheet drill={drill} onClose={() => setDrill(null)} />
    </ReportPage>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="grid gap-1 rounded-lg border p-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-semibold text-2xl tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}
