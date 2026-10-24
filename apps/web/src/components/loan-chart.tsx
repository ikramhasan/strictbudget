import { type BudgetMonth, monthBounds, NUMBER_FORMAT_SPECS } from "@strictbudget/engine";
import { type ChartConfig, ChartContainer } from "@strictbudget/ui/components/chart";
import { cn } from "@strictbudget/ui/lib/utils";
import { format as formatDateFns } from "date-fns";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useBudget } from "@/lib/budget-context";
import { isoToDate } from "@/lib/dates";
import { chartMonths, plotValue, type Track, trackAt } from "@/lib/loan-planner";

export type LoanSeries = "past" | "original" | "minimum" | "current" | "simulation";

/**
 * A target below the minimum draws Current Track yellow; a paid-off loan's Past Balance is green
 * and filled.
 */
export const SERIES_LABELS: Record<LoanSeries, string> = {
  past: "Past Balance",
  original: "Original Payment Schedule",
  minimum: "Minimum Payment",
  current: "Current Track",
  simulation: "Simulation",
};

export const SERIES_HINTS: Partial<Record<LoanSeries, string>> = {
  original:
    "Estimated balance based on paying the minimum since the start of the loan. You can change the starting point by clicking into any Past Balance in the chart.",
  minimum:
    "Estimated future balance if you pay the minimum required amount due per payment period.",
  simulation:
    "Estimated future balance if you pay the updated amounts on the left side of the simulator.",
};

const config = {
  past: { label: SERIES_LABELS.past, color: "var(--primary)" },
  original: { label: SERIES_LABELS.original, color: "var(--muted-foreground)" },
  minimum: {
    label: SERIES_LABELS.minimum,
    color: "color-mix(in oklab, var(--primary) 45%, transparent)",
  },
  current: { label: SERIES_LABELS.current, color: "var(--primary)" },
  simulation: { label: SERIES_LABELS.simulation, color: "var(--chart-2, #16a34a)" },
} satisfies ChartConfig;

const tickLabel = (month: BudgetMonth, years: boolean) =>
  formatDateFns(isoToDate(monthBounds(month).start), years ? "yyyy" : "MMM ''yy");

/** Every month for a year or less, the first month and each July up to ten years, then years. */
function ticksFor(months: readonly BudgetMonth[]) {
  if (months.length <= 13) return { ticks: [...months], years: false };
  if (months.length <= 121) {
    return {
      ticks: months.filter((m, i) => i === 0 || m.endsWith("-07")),
      years: false,
    };
  }
  const step = months.length > 600 ? 20 : months.length > 240 ? 10 : 2;
  return {
    ticks: months.filter(
      (m, i) => i === 0 || (m.endsWith("-01") && Number(m.slice(0, 4)) % step === 0),
    ),
    years: true,
  };
}

export function LoanChart({
  tracks,
  exponent,
  showAmounts = true,
  paidOff = false,
  warning = false,
  className,
  onPickPast,
}: {
  tracks: Partial<Record<LoanSeries, Track | null>>;
  exponent: number;
  showAmounts?: boolean;
  paidOff?: boolean;
  /** Draw Current Track (or Simulation) yellow: a target below the minimum. */
  warning?: boolean;
  className?: string;
  /** Clicking a Past Balance point moves the original schedule's start. */
  onPickPast?: (month: BudgetMonth) => void;
}) {
  const { budget, formatAmount } = useBudget();
  const months = chartMonths(Object.values(tracks));
  const shown = (Object.keys(tracks) as LoanSeries[]).filter((k) => tracks[k]);
  const data = months.map((month) => {
    const row: Record<string, number | string | undefined> = { month };
    for (const key of shown) {
      const value = trackAt(tracks[key] ?? null, month);
      if (value !== undefined) row[key] = plotValue(value, exponent);
    }
    return row;
  });
  const { ticks, years } = ticksFor(months);
  const spec = NUMBER_FORMAT_SPECS[budget.numberFormat];
  const whole = (units: number) =>
    formatAmount({
      amount: BigInt(units) * 10n ** BigInt(exponent),
      currency: budget.currency,
    }).replace(new RegExp(`\\${spec.decimal}\\d+`), "");
  const exact = (key: LoanSeries, month: BudgetMonth) => {
    const value = trackAt(tracks[key] ?? null, month);
    return value === undefined ? null : formatAmount({ amount: value, currency: budget.currency });
  };
  const color = (key: LoanSeries) =>
    paidOff && key === "past"
      ? "var(--color-emerald-500, #10b981)"
      : warning && (key === "current" || key === "simulation")
        ? "var(--color-amber-500, #f59e0b)"
        : `var(--color-${key})`;
  const first = shown.includes("past") ? tracks.past?.from : undefined;

  return (
    <ChartContainer config={config} className={cn("aspect-auto h-64 w-full", className)}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 12, bottom: 0, left: showAmounts ? 8 : 0 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          ticks={ticks}
          interval="preserveStartEnd"
          tickFormatter={(m: string) => tickLabel(m, years)}
          tickLine={false}
          axisLine={false}
          minTickGap={8}
        />
        <YAxis
          hide={!showAmounts}
          tickFormatter={whole}
          tickLine={false}
          axisLine={false}
          width={showAmounts ? 72 : 0}
          domain={[0, "auto"]}
        />
        {showAmounts && (
          <Tooltip
            content={({ active, label }) =>
              active && typeof label === "string" ? (
                <div className="grid gap-1 rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                  <span className="font-medium">{tickLabel(label, false)}</span>
                  {shown.map((key) => {
                    const value = exact(key, label);
                    return value ? (
                      <span key={key} className="flex justify-between gap-4 tabular-nums">
                        <span className="text-muted-foreground">{SERIES_LABELS[key]}</span>
                        {value}
                      </span>
                    ) : null;
                  })}
                </div>
              ) : null
            }
          />
        )}
        {paidOff && shown.includes("past") && (
          <Area
            dataKey="past"
            type="linear"
            stroke="none"
            fill="var(--color-emerald-500, #10b981)"
            fillOpacity={0.12}
            isAnimationActive={false}
            connectNulls={false}
          />
        )}
        {shown.map((key) => (
          <Line
            key={key}
            dataKey={key}
            name={SERIES_LABELS[key]}
            type="linear"
            stroke={color(key)}
            strokeWidth={2}
            strokeDasharray={key === "past" ? undefined : "6 4"}
            dot={false}
            activeDot={
              key === "past" && onPickPast
                ? {
                    r: 5,
                    cursor: "pointer",
                    onClick: (...args: unknown[]) => {
                      const point = args[1] as { payload?: { month?: string } } | undefined;
                      if (point?.payload?.month) onPickPast(point.payload.month);
                    },
                  }
                : { r: 3 }
            }
            isAnimationActive={false}
          />
        ))}
        {first && data[0]?.past !== undefined && (
          <ReferenceDot
            x={first}
            y={data[0].past as number}
            r={5}
            fill="var(--background)"
            stroke={color("past")}
            strokeWidth={2}
          />
        )}
      </ComposedChart>
    </ChartContainer>
  );
}

export function LoanChartLegend({
  series,
  paidOff = false,
  warning = false,
  hints = SERIES_HINTS,
}: {
  series: readonly LoanSeries[];
  paidOff?: boolean;
  warning?: boolean;
  hints?: Partial<Record<LoanSeries, string>>;
}) {
  return (
    <ul className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-muted-foreground text-xs">
      {series.map((key) => (
        <li key={key} className="flex items-center gap-1.5" title={hints[key]}>
          <svg width="18" height="4" aria-hidden className="shrink-0">
            <line
              x1="0"
              y1="2"
              x2="18"
              y2="2"
              strokeWidth="3"
              strokeDasharray={key === "past" ? undefined : "5 3"}
              className={cn(
                key === "past" && (paidOff ? "stroke-emerald-500" : "stroke-primary"),
                key === "original" && "stroke-muted-foreground",
                key === "minimum" && "stroke-primary/45",
                (key === "current" || key === "simulation") &&
                  (warning
                    ? "stroke-amber-500"
                    : key === "simulation"
                      ? "stroke-emerald-600"
                      : "stroke-primary"),
              )}
            />
          </svg>
          {SERIES_LABELS[key]}
          {hints[key] && <span aria-hidden>ⓘ</span>}
        </li>
      ))}
    </ul>
  );
}
