import { isOnBudget, money, percentOf } from "@strictbudget/engine";
import { Label } from "@strictbudget/ui/components/label";
import { Switch } from "@strictbudget/ui/components/switch";
import { useIsMobile } from "@strictbudget/ui/hooks/use-mobile";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { z } from "zod";
import { CashFlowChart } from "@/components/reports/cash-flow-chart";
import { ChartCard } from "@/components/reports/chart-card";
import { type DrillDown, DrillDownSheet } from "@/components/reports/drill-down-sheet";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportPage } from "@/components/reports/report-page";
import { useBudget } from "@/lib/budget-context";
import {
  type CashFlowData,
  cashFlowGraph,
  cashFlowOptions,
  cashFlowSearchSchema,
  type FlowDrill,
} from "@/lib/cash-flow";
import { categoriesQueryOptions } from "@/lib/categories";
import { planColors, rangeLabel } from "@/lib/reports";
import { useReportState } from "@/lib/use-report";

export const Route = createFileRoute("/_authed/budgets/$budgetId/reports/cash-flow")({
  validateSearch: cashFlowSearchSchema,
  component: Report,
});

/**
 * Where the money came from and where it went, for a month, quarter or year: income sources into
 * Income, out to the groups (each expanding into its categories) and what was saved. Income and
 * spending are Income v Expense's, so the totals agree. A phone gets the table: a Sankey doesn't
 * fit 400px.
 */
function Report() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const update = (patch: Partial<z.infer<typeof cashFlowSearchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });
  const { budget, formatAmount } = useBudget();
  const state = useReportState(search, "this_month");
  const { budgetId, range } = state;
  const isMobile = useIsMobile();
  const flow = useQuery(cashFlowOptions(budgetId, range, search.accounts));
  const categories = useQuery(categoriesQueryOptions(budgetId));
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const open = new Set((search.open ?? "").split(",").filter(Boolean));
  const data = flow.data;
  const graph = data ? cashFlowGraph(data, { all: search.all === true, open }) : null;
  const colors = categories.data
    ? planColors({
        uncategorizedCategoryId: categories.data.uncategorizedCategoryId,
        groups: categories.data.groups.filter((g) => !g.kind),
      })
    : { groups: new Map<string, string>(), categories: new Map<string, string>() };
  const format = (amount: bigint | string) => formatAmount(money(BigInt(amount), budget.currency));
  const accountFilter = search.accounts !== undefined ? { accountIds: search.accounts } : {};

  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update({ open: next.size ? [...next].join(",") : undefined });
  };
  const pick = (title: string, d: FlowDrill) => {
    if (!d) return;
    setDrill({
      title,
      request: {
        budgetId,
        range,
        kind: d.kind,
        filters:
          d.kind === "income"
            ? {
                ...accountFilter,
                payeeIds: d.payeeIds.map((id) => id ?? "none").join(","),
              }
            : {
                ...accountFilter,
                ...(d.groupIds && { groupIds: d.groupIds.join(",") }),
                ...(d.categoryIds && { categoryIds: d.categoryIds.join(",") }),
              },
      },
    });
  };

  const hasIncome = data ? BigInt(data.income) > 0n || data.sources.length > 0 : false;
  return (
    <ReportPage
      title="Cash Flow"
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <ReportFilterBar
            search={search}
            update={update}
            range={range}
            preset={state.preset}
            current={state.current}
            earliest={state.earliest}
            show={["accounts"]}
            accountFilter={(a) => isOnBudget(a.type)}
          />
          {graph && (graph.folding || search.all) && !isMobile && (
            <div className="flex items-center gap-2">
              <Switch
                id="cash-flow-all"
                checked={search.all === true}
                onCheckedChange={(on) => update({ all: on || undefined })}
              />
              <Label htmlFor="cash-flow-all" className="font-normal text-sm">
                Show small flows
              </Label>
            </div>
          )}
        </div>
      }
    >
      {data && (
        <p className="text-sm">
          <span className="text-muted-foreground">{rangeLabel(range)}: </span>
          {format(data.income)} came in, {format(-BigInt(data.spending))} went out
          {BigInt(data.saved) > 0n && `, ${format(data.saved)} saved`}
          {BigInt(data.fromSavings) > 0n && `, ${format(data.fromSavings)} more than came in`}.
        </p>
      )}
      <ChartCard
        title="Where the money came from and went"
        view={state.view}
        onViewChange={(view) => update({ view })}
        forceTable={isMobile}
        loading={!graph}
        empty={
          graph && graph.nodes.length === 0
            ? "Nothing came in or went out in this range."
            : undefined
        }
        fileName="cash-flow"
        chart={
          graph && (
            <CashFlowChart
              graph={graph}
              hasIncome={hasIncome}
              colors={colors}
              onToggle={toggle}
              onPick={(node) => pick(node.name, node.drill)}
            />
          )
        }
        table={data && <CashFlowTable data={data} format={format} onPick={pick} />}
      />
      {isMobile && graph && graph.nodes.length > 0 && (
        <p className="text-muted-foreground text-xs">The diagram shows on a wider screen.</p>
      )}
      <DrillDownSheet drill={drill} onClose={() => setDrill(null)} />
    </ReportPage>
  );
}

/** Every flow, unfolded: what came in, then where it went, each with its share. */
function CashFlowTable({
  data,
  format,
  onPick,
}: {
  data: CashFlowData;
  format: (amount: bigint | string) => string;
  onPick: (title: string, drill: FlowDrill) => void;
}) {
  const total =
    data.sources.reduce((s, r) => s + BigInt(r.amount), 0n) +
    data.refunds.reduce((s, r) => s + BigInt(r.amount), 0n) +
    BigInt(data.fromSavings);
  const share = (amount: string | bigint) => {
    const p = percentOf(BigInt(amount), total);
    return p === null ? "–" : `${p.toFixed(1)}%`;
  };
  const row = (
    key: string,
    name: string,
    amount: string | bigint,
    drill: FlowDrill,
    level: 0 | 1 = 0,
  ) => (
    <tr key={key} className="border-b">
      <th scope="row" className={cn("px-2 py-1.5 text-left font-normal", level && "pl-6")}>
        {drill ? (
          <button
            type="button"
            className="text-left underline-offset-2 hover:underline"
            onClick={() => onPick(name, drill)}
          >
            {name}
          </button>
        ) : (
          name
        )}
      </th>
      <td className="px-2 py-1.5 text-right tabular-nums">{format(amount)}</td>
      <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">{share(amount)}</td>
    </tr>
  );
  const heading = (label: string) => (
    <tr className="border-b bg-muted/40">
      <th scope="colgroup" colSpan={3} className="px-2 py-1.5 text-left font-semibold">
        {label}
      </th>
    </tr>
  );
  const totalRow = (label: string) => (
    <tr className="border-b font-semibold">
      <th scope="row" className="px-2 py-1.5 text-left">
        {label}
      </th>
      <td className="px-2 py-1.5 text-right tabular-nums">{format(total)}</td>
      <td />
    </tr>
  );
  return (
    <table className="w-full min-w-max text-sm">
      <thead>
        <tr className="border-b text-muted-foreground text-xs">
          <th scope="col" className="px-2 py-1.5 text-left font-medium">
            Flow
          </th>
          <th scope="col" className="px-2 py-1.5 text-right font-medium">
            Amount
          </th>
          <th scope="col" className="px-2 py-1.5 text-right font-medium">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {heading("Came in")}
        {data.sources.map((s) =>
          row(`s:${s.payeeId ?? ""}`, s.name, s.amount, { kind: "income", payeeIds: [s.payeeId] }),
        )}
        {data.refunds.map((r) =>
          row(`r:${r.categoryId}`, `Refunds: ${r.name}`, r.amount, {
            kind: "spending",
            categoryIds: [r.categoryId],
          }),
        )}
        {BigInt(data.fromSavings) > 0n &&
          row("from-savings", "From savings", data.fromSavings, null)}
        {totalRow("Total in")}
        {heading("Went out")}
        {data.groups.flatMap((g) => [
          row(
            `g:${g.groupId ?? ""}`,
            g.name,
            g.amount,
            g.groupId
              ? { kind: "spending", groupIds: [g.groupId] }
              : { kind: "spending", categoryIds: g.categories.map((c) => c.categoryId) },
          ),
          ...g.categories.map((c) =>
            row(
              `c:${c.categoryId}`,
              c.name,
              c.amount,
              { kind: "spending", categoryIds: [c.categoryId] },
              1,
            ),
          ),
        ])}
        {data.paidBack.map((p) =>
          row(`p:${p.payeeId ?? ""}`, `Paid back: ${p.name}`, p.amount, {
            kind: "income",
            payeeIds: [p.payeeId],
          }),
        )}
        {BigInt(data.saved) > 0n && row("saved", "Saved", data.saved, null)}
        {totalRow("Total out")}
      </tbody>
    </table>
  );
}
