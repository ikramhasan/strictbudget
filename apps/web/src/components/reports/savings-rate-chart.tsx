import { type BudgetMonth, money, NUMBER_FORMAT_SPECS } from "@strictbudget/engine";
import { type ChartConfig, ChartContainer } from "@strictbudget/ui/components/chart";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useBudget } from "@/lib/budget-context";
import {
  chartNumber,
  chartTick,
  monthLabel,
  reportColor,
  UNCATEGORIZED_COLOR,
} from "@/lib/reports";
import {
  type IncomeSource,
  percentLabel,
  ratesFor,
  type SavingsMode,
  type SavingsRateMonth,
} from "@/lib/savings-rate";

const rateConfig = {
  rate: { label: "Monthly", color: "var(--report-1)" },
  rolling: { label: "Rolling 12 months", color: "var(--report-3)" },
  goal: { label: "Goal", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

/**
 * The monthly rate and the rolling 12-month rate (the steadier number), with the goal as a dashed
 * line. A month without income has no rate: the line breaks there rather than dropping to 0%.
 */
export function SavingsRateChart({
  months,
  mode,
  goal,
}: {
  months: readonly SavingsRateMonth[];
  mode: SavingsMode;
  /** Basis points. */
  goal: number | null;
}) {
  const { budget, formatAmount } = useBudget();
  const data = months.map((m) => ({ month: m.month as BudgetMonth, ...ratesFor(m, mode), m }));
  const exact = (amount: string) => formatAmount(money(BigInt(amount), budget.currency));
  return (
    <div className="grid gap-2">
      <ChartContainer config={rateConfig} className="aspect-auto h-72 w-full">
        <ComposedChart data={data} margin={{ top: 8, right: 24, left: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => monthLabel(m as BudgetMonth, "axis")}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => `${v}%`}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={[(min: number) => Math.min(0, Math.floor(min)), "auto"]}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          {goal !== null && (
            <ReferenceLine
              y={goal / 100}
              stroke="var(--color-goal)"
              strokeDasharray="6 4"
              ifOverflow="extendDomain"
              label={{
                value: `Goal ${goal / 100}%`,
                position: "insideTopLeft",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
          )}
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            content={({ active, label }) => {
              const point = active ? data.find((d) => d.month === label) : undefined;
              if (!point) return null;
              const { m } = point;
              return (
                <div className="grid min-w-52 gap-1 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                  <p className="font-medium">{monthLabel(point.month, "long")}</p>
                  <TooltipRow color={rateConfig.rate.color} label="Monthly">
                    {point.rate === null ? "No income" : percentLabel(point.rate)}
                  </TooltipRow>
                  <TooltipRow color={rateConfig.rolling.color} label="Rolling 12 months">
                    {percentLabel(point.rolling)}
                  </TooltipRow>
                  <TooltipRow label="Income">{exact(m.income)}</TooltipRow>
                  <TooltipRow label="Left over">{exact(m.netIncome)}</TooltipRow>
                  {mode === "saving" && (
                    <>
                      <TooltipRow label="Saved via categories">
                        {exact(m.savedViaCategories)}
                      </TooltipRow>
                      <TooltipRow label="Moved to tracking accounts">
                        {exact(m.movedToTracking)}
                      </TooltipRow>
                    </>
                  )}
                </div>
              );
            }}
          />
          <Line
            dataKey="rolling"
            type="linear"
            stroke="var(--color-rolling)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="rate"
            type="linear"
            stroke="var(--color-rate)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-rate)" }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
        {(["rate", "rolling"] as const).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3" style={{ background: rateConfig[k].color }} />
            {rateConfig[k].label}
          </li>
        ))}
        {goal !== null && (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="w-3 border-t-2 border-dashed"
              style={{ borderColor: rateConfig.goal.color }}
            />
            Goal
          </li>
        )}
      </ul>
    </div>
  );
}

function TooltipRow({
  color,
  label,
  children,
}: {
  color?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-2">
      {color && <span aria-hidden className="size-2 rounded-xs" style={{ background: color }} />}
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto pl-3 font-medium tabular-nums">{children}</span>
    </p>
  );
}

export const sourceColor = (source: IncomeSource, index: number) =>
  source.key === "other" ? UNCATEGORIZED_COLOR : reportColor(index);

/** Income by source, stacked month by month; heights are positions, the tooltip is exact. */
export function IncomeSourcesChart({
  months,
  sources,
}: {
  months: readonly BudgetMonth[];
  sources: readonly IncomeSource[];
}) {
  const { budget, formatAmount } = useBudget();
  const currency = budget.currency;
  const spec = NUMBER_FORMAT_SPECS[budget.numberFormat];
  const tick = (units: number) =>
    chartTick(units, currency, (m) => formatAmount(money(m, currency)), spec.decimal);
  const config = Object.fromEntries(
    sources.map((s, i) => [`s${i}`, { label: s.name, color: sourceColor(s, i) }]),
  ) satisfies ChartConfig;
  const data = months.map((month, mi) => ({
    month,
    ...Object.fromEntries(
      sources.map((s, i) => [`s${i}`, chartNumber(s.months[mi] ?? 0n, currency)]),
    ),
  }));
  return (
    <div className="grid gap-2">
      <ChartContainer config={config} className="aspect-auto h-72 w-full">
        <AreaChart data={data} margin={{ top: 8, right: 24, left: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => monthLabel(m as BudgetMonth, "axis")}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={80} />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            content={({ active, label }) => {
              const mi = active ? months.indexOf(label as BudgetMonth) : -1;
              if (mi < 0) return null;
              const total = sources.reduce((s, src) => s + (src.months[mi] ?? 0n), 0n);
              return (
                <div className="grid min-w-52 gap-1 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                  <p className="font-medium">{monthLabel(label as BudgetMonth, "long")}</p>
                  {sources.map((s, i) => (
                    <TooltipRow key={s.key} color={sourceColor(s, i)} label={s.name}>
                      {formatAmount(money(s.months[mi] ?? 0n, currency))}
                    </TooltipRow>
                  ))}
                  <TooltipRow label="Total">{formatAmount(money(total, currency))}</TooltipRow>
                </div>
              );
            }}
          />
          {sources.map((s, i) => (
            <Area
              key={s.key}
              dataKey={`s${i}`}
              stackId="income"
              type="linear"
              stroke={`var(--color-s${i})`}
              fill={`var(--color-s${i})`}
              fillOpacity={0.35}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ChartContainer>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
        {sources.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-xs"
              style={{ background: sourceColor(s, i) }}
            />
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
