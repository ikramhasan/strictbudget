import {
  type CurrencyCode,
  currencyExponent,
  exportDelimiter,
  isBudgetMonth,
} from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@strictbudget/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ImageIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ChartCard } from "@/components/reports/chart-card";
import { ExportButton } from "@/components/reports/export-button";
import { NetWorthAccountsTable } from "@/components/reports/net-worth/accounts-table";
import { CompositionChart } from "@/components/reports/net-worth/composition-chart";
import { NetWorthHeadline, NetWorthMonthTable } from "@/components/reports/net-worth/headline";
import { NetWorthChart } from "@/components/reports/net-worth/net-worth-chart";
import { WhatChanged } from "@/components/reports/net-worth/waterfall";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportPage } from "@/components/reports/report-page";
import { ShareImageDialog } from "@/components/share-image-dialog";
import { useBudget } from "@/lib/budget-context";
import { todayIso } from "@/lib/dates";
import { exportFile, type NetWorthReport, netWorthOptions } from "@/lib/net-worth";
import { type ReportSearch, rangeLabel, reportSearchSchema } from "@/lib/reports";
import { useReportState } from "@/lib/use-report";

const searchSchema = reportSearchSchema.extend({
  /** The main chart: assets and debts or the composition by account kind. */
  chart: z.enum(["bars", "composition"]).optional().catch(undefined),
  /** The month "What changed this month" explains (the range's last by default). */
  month: z.string().refine(isBudgetMonth).optional().catch(undefined),
});
type Search = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/net-worth")({
  validateSearch: searchSchema,
  component: Report,
});

/** The tagline on Net Worth's share picture. */
const TAGLINE = "From worried to worth it.";

function Report() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { budget } = useBudget();
  const state = useReportState(search, "last_12_months");
  const update = (patch: Partial<Search>) =>
    navigate({
      search: (prev: Search) => ({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });
  const query = useQuery(
    netWorthOptions({ budgetId: state.budgetId, range: state.range, accounts: search.accounts }),
  );
  const [sharing, setSharing] = useState(false);
  const report = query.data;
  const chart = search.chart ?? "bars";
  const selected =
    report?.months.find((m) => m.month === search.month)?.month ?? report?.months.at(-1)?.month;

  return (
    <ReportPage
      title="Net Worth"
      actions={
        <>
          <Button variant="default" disabled={!report} onClick={() => setSharing(true)}>
            <ImageIcon />
            <span className="hidden sm:inline">Share Your Progress</span>
            <span className="sm:hidden">Share</span>
          </Button>
          <ExportButton
            disabled={!report}
            zipName="net-worth.zip"
            files={() =>
              report
                ? [
                    exportFile(
                      report,
                      currencyExponent(report.currency as CurrencyCode),
                      budget.numberFormat,
                      exportDelimiter(budget.numberFormat),
                      todayIso(),
                    ),
                  ]
                : []
            }
          />
        </>
      }
      filters={
        <ReportFilterBar
          search={search as ReportSearch}
          update={update}
          range={state.range}
          preset={state.preset}
          current={state.current}
          earliest={state.earliest}
          show={["accounts"]}
        />
      }
    >
      {query.isError ? (
        <p className="text-destructive text-sm">Couldn't load the report.</p>
      ) : !report ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <NetWorthHeadline report={report} />
          <MissingRates report={report} />
          <ChartCard
            title={chart === "bars" ? "Assets and debts" : "By account type"}
            view={state.view}
            onViewChange={(view) => update({ view })}
            fileName={`net-worth-${state.range.from}-${state.range.to}`}
            chart={
              <div className="grid gap-3">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={chart}
                  onValueChange={(v) => v && update({ chart: v as Search["chart"] })}
                  aria-label="Chart"
                  className="justify-self-start"
                >
                  <ToggleGroupItem value="bars">Assets and debts</ToggleGroupItem>
                  <ToggleGroupItem value="composition">By account type</ToggleGroupItem>
                </ToggleGroup>
                {chart === "bars" ? (
                  <NetWorthChart
                    months={report.months}
                    currency={report.currency as CurrencyCode}
                    onSelectMonth={(month) => update({ month })}
                  />
                ) : (
                  <CompositionChart report={report} />
                )}
              </div>
            }
            table={<NetWorthMonthTable report={report} />}
          />
          {selected && (
            <WhatChanged
              report={report}
              month={selected}
              onMonthChange={(month) => update({ month })}
            />
          )}
          {state.view === "chart" && (
            <section aria-label="Months" className="grid gap-3 rounded-lg border p-4">
              <h2 className="font-semibold">{rangeLabel(state.range)}</h2>
              <div className="overflow-x-auto">
                <NetWorthMonthTable report={report} />
              </div>
            </section>
          )}
          <NetWorthAccountsTable report={report} />
          <ShareImageDialog
            open={sharing}
            onOpenChange={setSharing}
            tagline={TAGLINE}
            fileName="Net worth"
          >
            {({ showAmounts, layout }) => (
              <>
                <NetWorthHeadline
                  report={report}
                  showAmounts={showAmounts}
                  compact
                  className={layout === "row" ? "w-52 shrink-0" : undefined}
                />
                <NetWorthChart
                  months={report.months}
                  currency={report.currency as CurrencyCode}
                  showAmounts={showAmounts}
                  fill
                />
              </>
            )}
          </ShareImageDialog>
        </>
      )}
    </ReportPage>
  );
}

/** Accounts left out of a month for want of a rate (a multi-currency budget). */
function MissingRates({ report }: { report: NetWorthReport }) {
  const missing = new Set(report.months.flatMap((m) => m.missing));
  if (missing.size === 0) return null;
  const names = report.accounts.filter((a) => missing.has(a.id)).map((a) => a.name);
  return (
    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      No exchange rate is known for some month-ends, so {names.join(", ")}{" "}
      {names.length === 1 ? "is" : "are"} left out of those months' totals.
    </p>
  );
}
