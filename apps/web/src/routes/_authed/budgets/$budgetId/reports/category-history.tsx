import {
  type BudgetMonth,
  exportDelimiter,
  money,
  percentOf,
  toDelimited,
} from "@strictbudget/engine";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@strictbudget/ui/components/native-select";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  CategoryHistoryChart,
  CategoryHistoryTable,
} from "@/components/reports/category-history-chart";
import { ChartCard } from "@/components/reports/chart-card";
import { type DrillDown, DrillDownSheet } from "@/components/reports/drill-down-sheet";
import { ExportButton } from "@/components/reports/export-button";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportPage } from "@/components/reports/report-page";
import { useBudget } from "@/lib/budget-context";
import { type CategoryList, categoriesQueryOptions } from "@/lib/categories";
import {
  type CategoryHistorySearch,
  categoryHistoryOptions,
  categoryHistorySearchSchema,
  categoryNames,
  exportName,
  exportRows,
  type HistorySubject,
  pickerGroups,
} from "@/lib/category-history";
import { todayIso } from "@/lib/dates";
import { monthLabel, rangeLabel } from "@/lib/reports";
import { useReportState } from "@/lib/use-report";

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/category-history")({
  validateSearch: categoryHistorySearchSchema,
  component: Report,
});

/** The category a report opens on without one in its URL: the plan's first visible one. */
function defaultSubject(list: CategoryList): HistorySubject | undefined {
  const group = pickerGroups(list).find((g) => !g.hidden && g.categories.some((c) => !c.hidden));
  const category = group?.categories.find((c) => !c.hidden);
  return category ? { categoryId: category.id } : undefined;
}

/**
 * One category's or group's life on the plan: each month's Assigned, Spent and Available, what
 * its target asked, overspent months and money moved in and out.
 */
function Report() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { budget, formatAmount } = useBudget();
  const state = useReportState(search, "last_12_months");
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const update = (patch: Partial<CategoryHistorySearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });
  const format = (amount: bigint | string) => formatAmount(money(BigInt(amount), budget.currency));

  const categories = useQuery(categoriesQueryOptions(budget.id));
  const subject: HistorySubject | undefined = search.category
    ? { categoryId: search.category }
    : search.group
      ? { groupId: search.group }
      : categories.data && defaultSubject(categories.data);
  const query = useQuery({
    ...categoryHistoryOptions(budget.id, subject ?? { categoryId: "" }, state.range),
    enabled: subject !== undefined,
    placeholderData: keepPreviousData,
  });
  const history = query.data;
  const names = categories.data ? categoryNames(categories.data) : new Map<string, string>();
  const loading = subject === undefined ? categories.isPending : query.isPending;
  const empty = query.isError
    ? "Couldn't load the report."
    : subject === undefined && categories.data
      ? "Add a category to see its history."
      : history && history.months.length === 0
        ? "The plan has no months in this range."
        : undefined;

  const onPick = (month: BudgetMonth) =>
    subject &&
    setDrill({
      title: `${history?.name ?? ""} · ${monthLabel(month, "long")}`,
      request: {
        budgetId: budget.id,
        range: { from: month, to: month },
        // The plan's Activity, saving included, as the cell shows.
        kind: "activity",
        filters:
          "categoryId" in subject
            ? { categoryIds: subject.categoryId }
            : { groupIds: subject.groupId },
      },
    });

  const exportFiles = () => {
    if (!history) return [];
    const delimiter = exportDelimiter(budget.numberFormat);
    return [
      {
        name: exportName(history.name, todayIso(), delimiter),
        text: toDelimited(exportRows(history, budget.numberFormat, budget.currency), delimiter),
      },
    ];
  };

  const stats = history?.stats;
  const metShare =
    stats && stats.targetMonths > 0
      ? percentOf(BigInt(stats.targetMonthsMet), BigInt(stats.targetMonths))
      : null;

  return (
    <ReportPage
      title="Category History"
      actions={
        <ExportButton
          files={exportFiles}
          zipName={exportName(history?.name ?? "", todayIso(), ",")}
          disabled={!history || history.months.length === 0}
        />
      }
      filters={
        <div className="flex flex-wrap items-center gap-2">
          {categories.data && (
            <SubjectPicker
              list={categories.data}
              value={
                subject
                  ? "categoryId" in subject
                    ? `c:${subject.categoryId}`
                    : `g:${subject.groupId}`
                  : ""
              }
              onChange={(v) =>
                update({
                  category: v.startsWith("c:") ? v.slice(2) : undefined,
                  group: v.startsWith("g:") ? v.slice(2) : undefined,
                })
              }
            />
          )}
          <ReportFilterBar
            search={search}
            update={update}
            range={state.range}
            preset={state.preset}
            current={state.current}
            earliest={state.earliest}
            show={[]}
          />
        </div>
      }
    >
      <section
        aria-label="Summary"
        className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3"
      >
        {!stats || !history ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <Stat label="Average assigned" value={format(stats.averageAssigned)} />
            <Stat label="Average spent" value={format(stats.averageSpent)} />
            <Stat
              label="Months overspent"
              value={String(stats.monthsOverspent)}
              note={`of ${history.months.length}`}
            />
            <Stat
              label="Target met"
              value={metShare === null ? "—" : `${Math.round(metShare)}%`}
              note={
                stats.targetMonths === 0
                  ? "No target asked for money"
                  : `${stats.targetMonthsMet} of ${stats.targetMonths} months`
              }
            />
          </>
        )}
      </section>

      <ChartCard
        title={`${history?.name ?? "Category"}${history?.hidden ? " (hidden)" : ""} · ${rangeLabel(state.range)}`}
        view={search.view ?? "chart"}
        onViewChange={(view) => update({ view })}
        loading={loading}
        empty={empty}
        fileName={`category-history-${state.range.from}-${state.range.to}`}
        chart={history && <CategoryHistoryChart history={history} names={names} onPick={onPick} />}
        table={history && <CategoryHistoryTable history={history} names={names} onPick={onPick} />}
      />
      <p className="text-muted-foreground text-sm">
        These are the plan's own numbers. Assigned includes money moved in and out, and Spent is the
        plan's Activity (spending less refunds). The target line is the current target from the
        month it started, since earlier versions of a target aren't kept. Click a month to see its
        transactions.
      </p>
      <DrillDownSheet drill={drill} onClose={() => setDrill(null)} />
    </ReportPage>
  );
}

function SubjectPicker({
  list,
  value,
  onChange,
}: {
  list: CategoryList;
  value: string;
  onChange: (value: string) => void;
}) {
  const groups = pickerGroups(list);
  const hidden = (h: boolean) => (h ? " (hidden)" : "");
  return (
    <NativeSelect
      aria-label="Category or group"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-full"
    >
      <NativeSelectOptGroup label="Groups">
        {groups.map((g) => (
          <NativeSelectOption key={g.id} value={`g:${g.id}`}>
            {g.name}
            {hidden(g.hidden)}
          </NativeSelectOption>
        ))}
      </NativeSelectOptGroup>
      {groups.map((g) => (
        <NativeSelectOptGroup key={g.id} label={g.name}>
          {g.categories.map((c) => (
            <NativeSelectOption key={c.id} value={`c:${c.id}`}>
              {c.name}
              {hidden(c.hidden)}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      ))}
      <NativeSelectOptGroup label="Other">
        <NativeSelectOption value={`c:${list.uncategorizedCategoryId}`}>
          Uncategorized
        </NativeSelectOption>
      </NativeSelectOptGroup>
    </NativeSelect>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid content-start gap-1 rounded-lg border p-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-semibold text-2xl tabular-nums">{value}</span>
      {note && <span className="text-muted-foreground text-xs tabular-nums">{note}</span>}
    </div>
  );
}
