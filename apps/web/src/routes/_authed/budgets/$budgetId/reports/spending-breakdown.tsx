import { exportDelimiter, isOnBudget, money, toDelimited } from "@strictbudget/engine";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { DrillDown } from "@/components/reports/drill-down-sheet";
import { DrillDownSheet } from "@/components/reports/drill-down-sheet";
import { ExportButton } from "@/components/reports/export-button";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportPage } from "@/components/reports/report-page";
import { SpendingBreakdownBody } from "@/components/reports/spending-breakdown-body";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { todayIso } from "@/lib/dates";
import { reportActivityOptions, reportTransactionsOptions } from "@/lib/reports";
import {
  exportNames,
  type SpendingBreakdownSearch,
  spendingBreakdownSearchSchema,
  summaryExportRows,
  transactionsExportRows,
} from "@/lib/spending-breakdown";
import { useReportState } from "@/lib/use-report";

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/spending-breakdown")({
  validateSearch: spendingBreakdownSearchSchema,
  component: Report,
});

function Report() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { budget, formatAmount, formatDate } = useBudget();
  const queryClient = useQueryClient();
  const state = useReportState(search, "this_month");
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const update = (patch: Partial<SpendingBreakdownSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });

  const exportFiles = async () => {
    const base = { budgetId: budget.id, range: state.range, kind: "spending" as const };
    const [categories, sums, lines] = await Promise.all([
      queryClient.fetchQuery(categoriesQueryOptions(budget.id)),
      queryClient.fetchQuery(
        reportActivityOptions({ ...base, groupBy: ["category", "month"], filters: state.filters }),
      ),
      queryClient.fetchQuery(
        reportTransactionsOptions({ ...base, filters: state.filters, limit: 100000 }),
      ),
    ]);
    const delimiter = exportDelimiter(budget.numberFormat);
    const names = exportNames(todayIso());
    return [
      {
        name: names.summary,
        text: toDelimited(
          summaryExportRows(
            sums.rows,
            categories,
            state.range,
            budget.numberFormat,
            budget.currency,
          ),
          delimiter,
        ),
      },
      {
        name: names.transactions,
        text: toDelimited(
          transactionsExportRows(
            lines.transactions,
            categories.uncategorizedCategoryId,
            formatDate,
            (a) => formatAmount(money(a, budget.currency)),
          ),
          delimiter,
        ),
      },
    ];
  };

  return (
    <ReportPage
      title="Spending Breakdown"
      actions={<ExportButton files={exportFiles} zipName={exportNames(todayIso()).zip} />}
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
      <SpendingBreakdownBody search={search} state={state} update={update} onDrill={setDrill} />
      <DrillDownSheet drill={drill} onClose={() => setDrill(null)} />
    </ReportPage>
  );
}
