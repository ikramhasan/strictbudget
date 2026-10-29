import { addMonths, type BudgetMonth, type Observation } from "@strictbudget/engine";
import { cn } from "@strictbudget/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { monthLabel, type ReportSearch } from "@/lib/reports";

export type ReportTarget = {
  to:
    | "/budgets/$budgetId/reports/spending-breakdown"
    | "/budgets/$budgetId/reports/spending-trends"
    | "/budgets/$budgetId/reports/net-worth"
    | "/budgets/$budgetId/reports/income-expense"
    | "/budgets/$budgetId/reports/age-of-money"
    | "/budgets/$budgetId/reports/spending-pace"
    | "/budgets/$budgetId/reports/savings-rate";
  search?: ReportSearch & { mode?: "saving" | "plain" };
};

/** A tiny trend line; `values` are display numbers (chartNumber), oldest first. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  return (
    <div className="h-8 w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={values.map((v, i) => ({ i, v }))}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="v"
            stroke="var(--report-1)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The change arrow is green when the change is good and red when it isn't. */
export function KeyTile({
  budgetId,
  label,
  value,
  change,
  spark,
  target,
}: {
  budgetId: string;
  label: string;
  value: string;
  /** `neutral`: a note under the number rather than a change (no arrow or colour). */
  change?: { text: string; up: boolean; good: boolean; neutral?: boolean } | null;
  spark?: { values: number[]; label: string };
  target: ReportTarget;
}) {
  return (
    <Link
      to={target.to}
      params={{ budgetId }}
      search={target.search ?? {}}
      // content-start: a tile with fewer lines keeps its number level with its neighbours'.
      className="grid content-start gap-1 rounded-lg border p-4 transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-semibold text-2xl tabular-nums">{value}</span>
      {change?.neutral && (
        <span className="text-muted-foreground text-xs tabular-nums">{change.text}</span>
      )}
      {change && !change.neutral && (
        <span
          className={cn(
            "flex items-start gap-1 text-xs tabular-nums",
            change.good ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400",
          )}
        >
          {change.up ? (
            <ArrowUp aria-label="Up" className="mt-0.5 size-3 shrink-0" />
          ) : (
            <ArrowDown aria-label="Down" className="mt-0.5 size-3 shrink-0" />
          )}
          {change.text}
        </span>
      )}
      {spark && <Sparkline values={spark.values} label={spark.label} />}
    </Link>
  );
}

export function PreviewCard({
  budgetId,
  title,
  target,
  children,
}: {
  budgetId: string;
  title: string;
  target: ReportTarget;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid content-start gap-3 rounded-lg border p-4">
      <Link
        to={target.to}
        params={{ budgetId }}
        search={target.search ?? {}}
        className="font-semibold hover:underline"
      >
        {title}
      </Link>
      {children}
    </section>
  );
}

const thisMonth = (month: BudgetMonth): ReportSearch => ({ from: month, to: month });

/** Wording is factual and never judgmental. */
export function describeObservation(
  note: Observation,
  month: BudgetMonth,
  format: (minorUnits: bigint) => string,
): { text: string; target: ReportTarget } {
  switch (note.rule) {
    case "category_overspent":
      return {
        text: `${note.name} is overspent by ${format(note.overspent)} in ${monthLabel(month, "long")}.`,
        target: {
          to: "/budgets/$budgetId/reports/spending-breakdown",
          search: { ...thisMonth(month), categories: note.categoryId },
        },
      };
    case "category_above_average":
      return {
        text: `${note.name}: ${format(note.spent)} so far this month, ${note.percentAbove}% above its 6-month average of ${format(note.average)}.`,
        target: {
          to: "/budgets/$budgetId/reports/spending-trends",
          search: { from: addMonths(month, -6), to: month, categories: note.categoryId },
        },
      };
    case "net_worth_high":
      return {
        text: `Net worth reached a new high of ${format(note.netWorth)}.`,
        target: { to: "/budgets/$budgetId/reports/net-worth" },
      };
    case "income_lower":
      return {
        text: `Income in ${monthLabel(note.month, "long")} was ${format(note.income)}, ${format(note.previousIncome - note.income)} less than in ${monthLabel(note.previousMonth, "long")}.`,
        target: {
          to: "/budgets/$budgetId/reports/income-expense",
          search: { from: note.previousMonth, to: note.month },
        },
      };
    case "new_top_payee":
      return {
        text: `${note.name} is new among this month's top payees (#${note.rank}, ${format(note.spent)}).`,
        target: {
          to: "/budgets/$budgetId/reports/spending-breakdown",
          search: { ...thisMonth(month), payees: note.payeeId },
        },
      };
  }
}
