import {
  type BudgetMonth,
  currencyExponent,
  exportDelimiter,
  isOnBudget,
  money,
  monthsIn,
} from "@strictbudget/engine";
import { Label } from "@strictbudget/ui/components/label";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { Switch } from "@strictbudget/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { ChartCard } from "@/components/reports/chart-card";
import { type DrillDown, DrillDownSheet } from "@/components/reports/drill-down-sheet";
import { ExportButton } from "@/components/reports/export-button";
import { type ChartSeries, IncomeExpenseChart } from "@/components/reports/income-expense-chart";
import { type CellPick, IncomeExpenseTable } from "@/components/reports/income-expense-table";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportPage } from "@/components/reports/report-page";
import { useBudget } from "@/lib/budget-context";
import { categoriesQueryOptions } from "@/lib/categories";
import { todayIso } from "@/lib/dates";
import { buildIncomeExpense, incomeExpenseExport } from "@/lib/income-expense";
import {
  monthLabel,
  type ReportRequest,
  reportActivityOptions,
  reportSearchSchema,
} from "@/lib/reports";
import { useReportState } from "@/lib/use-report";

const searchSchema = reportSearchSchema.extend({
  /** Opt-in heat shading of expense cells. */
  heat: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/income-expense")({
  validateSearch: searchSchema,
  component: Report,
});

function Report() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const update = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const { budget, formatAmount } = useBudget();
  const state = useReportState(search, "last_3_months");
  const { budgetId, range } = state;
  // The account filter applies to income and expenses, the category filter to expenses only.
  const accountFilter = state.filters.accountIds ? { accountIds: state.filters.accountIds } : {};
  const expenseFilter = {
    ...accountFilter,
    ...(state.filters.categoryIds !== undefined && { categoryIds: state.filters.categoryIds }),
  };
  const income = useQuery(
    reportActivityOptions({
      budgetId,
      range,
      kind: "income",
      groupBy: ["month", "payee"],
      filters: accountFilter,
    }),
  );
  const expenses = useQuery(
    reportActivityOptions({
      budgetId,
      range,
      kind: "spending",
      groupBy: ["month", "category"],
      filters: expenseFilter,
    }),
  );
  const categories = useQuery(categoriesQueryOptions(budgetId));
  const [drill, setDrill] = useState<DrillDown | null>(null);

  const table =
    income.data && expenses.data && categories.data
      ? buildIncomeExpense({
          months: monthsIn(range),
          income: income.data.rows,
          expenses: expenses.data.rows,
          payees: income.data.payees,
          groups: categories.data.groups.filter((g) => !g.kind),
          uncategorizedCategoryId: categories.data.uncategorizedCategoryId,
        })
      : null;

  const open = (
    title: string,
    column: BudgetMonth | "range",
    request: Omit<ReportRequest, "budgetId" | "range">,
  ) =>
    setDrill({
      title: column === "range" ? title : `${title} – ${monthLabel(column)}`,
      request: {
        budgetId,
        range: column === "range" ? range : { from: column, to: column },
        ...request,
      },
    });
  const onPick = ({ title, target, column }: CellPick) =>
    target.kind === "income"
      ? open(title, column, {
          kind: "income",
          filters: {
            ...accountFilter,
            ...(target.payeeId !== undefined && { payeeIds: target.payeeId ?? "none" }),
          },
        })
      : open(title, column, {
          kind: "spending",
          filters: {
            ...expenseFilter,
            ...(target.categoryId && { categoryIds: target.categoryId }),
            ...(target.groupId && { groupIds: target.groupId }),
          },
        });
  const onChartPick = (series: ChartSeries, month: BudgetMonth) =>
    onPick({
      title: series === "income" ? "Income" : "Expenses",
      target: series === "income" ? { kind: "income" } : { kind: "spending" },
      column: month,
    });

  const exportFiles = () => {
    if (!table) return [];
    const delimiter = exportDelimiter(budget.numberFormat);
    const text = incomeExpenseExport(
      table,
      currencyExponent(budget.currency),
      budget.numberFormat,
      delimiter,
    );
    const name = `strictbudget-reflect-income-expense-${todayIso()}.${delimiter === "," ? "csv" : "tsv"}`;
    return [{ name, text }];
  };

  const loading = !table;
  return (
    <ReportPage
      title="Income v Expense"
      actions={<ExportButton files={exportFiles} zipName="income-expense.zip" disabled={loading} />}
      filters={
        <ReportFilterBar
          search={search}
          update={update}
          range={range}
          preset={state.preset}
          current={state.current}
          earliest={state.earliest}
          show={["categories", "accounts"]}
          accountFilter={(a) => isOnBudget(a.type)}
        />
      }
    >
      <ChartCard
        title="Income and expenses by month"
        view={state.view}
        onViewChange={(view) => update({ view })}
        loading={loading}
        fileName="income-expense"
        chart={table && <IncomeExpenseChart table={table} onPick={onChartPick} />}
        table={
          table && (
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    Month
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Income
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Expenses
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Net Income
                  </th>
                </tr>
              </thead>
              <tbody>
                {table.months.map((m, i) => (
                  <tr key={m} className="border-b">
                    <th scope="row" className="px-2 py-1.5 text-left font-normal">
                      {monthLabel(m, "long")}
                    </th>
                    {[table.totalIncome, table.totalExpenses, table.netIncome].map((v, j) => (
                      <td key={j} className="px-2 py-1.5 text-right tabular-nums">
                        {formatAmount(money(v.months[i] ?? 0n, budget.currency))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Table</h2>
        <div className="ml-auto flex items-center gap-2">
          <Switch
            id="income-expense-heat"
            checked={search.heat === true}
            onCheckedChange={(on) => update({ heat: on || undefined })}
          />
          <Label htmlFor="income-expense-heat" className="font-normal text-sm">
            Shade unusual spending
          </Label>
        </div>
      </div>
      {table ? (
        <IncomeExpenseTable table={table} heat={search.heat === true} onPick={onPick} />
      ) : income.isError || expenses.isError || categories.isError ? (
        <p className="text-muted-foreground text-sm">Couldn't load the report.</p>
      ) : (
        <Skeleton className="h-96 w-full" />
      )}
      <DrillDownSheet drill={drill} onClose={() => setDrill(null)} />
    </ReportPage>
  );
}
