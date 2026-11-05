import { addMonths, type BudgetMonth, type Observation } from "@strictbudget/engine";
import { cn } from "@strictbudget/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
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
    | "/budgets/$budgetId/reports/spending-pace";
  search?: ReportSearch;
};

/**
 * A tile's trend line: `values` are display numbers (chartNumber), oldest first, null for points
 * still to come; `reference` is a dashed line to read them against. The span's ends are labelled
 * under it, so it reads without hovering.
 */
export function Sparkline({
  values,
  reference,
  label,
  span,
}: {
  values: (number | null)[];
  reference?: number[];
  label: string;
  span: [string, string];
}) {
  const data = values.map((v, i) => ({ i, v, ref: reference?.[i] ?? null }));
  const lastIndex = values.findLastIndex((v) => v !== null);
  return (
    <div className="grid gap-1">
      <div className="h-9 w-full" role="img" aria-label={`${label}, ${span[0]} to ${span[1]}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <YAxis hide domain={["dataMin", "dataMax"]} />
            {reference && (
              <Line
                dataKey="ref"
                stroke="var(--muted-foreground)"
                strokeOpacity={0.6}
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              type="linear"
              dataKey="v"
              stroke="var(--report-1)"
              strokeWidth={1.5}
              dot={(props: { cx?: number; cy?: number; index?: number }) =>
                props.index === lastIndex && props.cx !== undefined && props.cy !== undefined ? (
                  <circle
                    key="last"
                    cx={props.cx}
                    cy={props.cy}
                    r={2.5}
                    fill="var(--report-1)"
                    stroke="var(--background)"
                    strokeWidth={1}
                  />
                ) : (
                  <g key={props.index} />
                )
              }
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <SpanLabels span={span} />
    </div>
  );
}

function SpanLabels({ span }: { span: [string, string] }) {
  return (
    <span
      aria-hidden
      className="flex justify-between text-[10px] text-muted-foreground leading-none"
    >
      <span>{span[0]}</span>
      <span>{span[1]}</span>
    </span>
  );
}

/** Where a tile's sparkline goes when there's no trend to draw yet. */
function SparkPlaceholder({ text }: { text: string }) {
  return (
    <div className="grid gap-1">
      <div className="relative grid h-9 place-items-center">
        <span
          aria-hidden
          className="absolute inset-x-1 top-1/2 border-border border-t border-dashed"
        />
        <span className="relative bg-background px-1.5 text-[11px] text-muted-foreground transition-colors duration-150 group-hover:bg-muted">
          {text}
        </span>
      </div>
      <span className="text-[10px] leading-none">&nbsp;</span>
    </div>
  );
}

/**
 * A key number. Its parts sit on fixed tracks (a one-line label, the number, a two-line note, the
 * trend), so the numbers line up across a row. The change is green when good and red when not.
 */
export function KeyTile({
  budgetId,
  label,
  value,
  change,
  spark,
  placeholder,
  target,
}: {
  budgetId: string;
  label: string;
  value: string;
  /** `neutral`: a note under the number rather than a change (no arrow or colour). */
  change?: { text: string; up: boolean; good: boolean; neutral?: boolean } | null;
  spark?: {
    values: (number | null)[];
    reference?: number[];
    label: string;
    span: [string, string];
  };
  /** Shown in the sparkline's place when `spark` has fewer than two points or is all zero. */
  placeholder: string;
  target: ReportTarget;
}) {
  const values = spark?.values.filter((v) => v !== null) ?? [];
  // A flat line at zero says nothing: there's no trend to draw yet.
  const drawn = values.length >= 2 && values.some((v) => v !== 0);
  return (
    <Link
      to={target.to}
      params={{ budgetId }}
      search={target.search ?? {}}
      className="group grid min-w-0 grid-rows-[auto_auto_minmax(2rem,auto)_1fr] gap-1 rounded-lg border p-3 transition-colors @md:p-4 duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate text-muted-foreground text-sm">{label}</span>
      <span className="truncate font-semibold text-xl tabular-nums tracking-tight @md:text-2xl">
        {value}
      </span>
      <span
        title={change?.text}
        className={cn(
          "min-w-0 text-xs tabular-nums",
          !change || change.neutral
            ? "text-muted-foreground"
            : change.good
              ? "text-green-700 dark:text-green-400"
              : "text-red-700 dark:text-red-400",
        )}
      >
        {/* Clamped inside: the grid stretches the outer box to its row. */}
        <span className="line-clamp-2">
          {change &&
            !change.neutral &&
            (change.up ? (
              <ArrowUp aria-label="Up" className="mr-0.5 inline size-3 align-[-0.125em]" />
            ) : (
              <ArrowDown aria-label="Down" className="mr-0.5 inline size-3 align-[-0.125em]" />
            ))}
          {change?.text}
        </span>
      </span>
      <span className="mt-2 self-end">
        {spark && drawn ? <Sparkline {...spark} /> : <SparkPlaceholder text={placeholder} />}
      </span>
    </Link>
  );
}

export function PreviewCard({
  budgetId,
  title,
  note,
  target,
  children,
}: {
  budgetId: string;
  title: string;
  /** What the card covers ("November 2026"), beside the title. */
  note?: string;
  target: ReportTarget;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid content-start gap-3 rounded-lg border p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="min-w-0 truncate font-semibold">
          {title}
          {note && <span className="ml-2 font-normal text-muted-foreground text-sm">{note}</span>}
        </h2>
        <Link
          to={target.to}
          params={{ budgetId }}
          search={target.search ?? {}}
          aria-label={`Open the ${title} report`}
          className="-m-1 flex shrink-0 items-center gap-0.5 rounded-md p-1 text-muted-foreground text-sm transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Just the arrow on a phone, so the title keeps its room. */}
          <span className="hidden sm:inline">Open report</span>
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </header>
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
