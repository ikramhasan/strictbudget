import {
  type BudgetMonth,
  type CurrencyCode,
  comparedToAverage,
  currencyExponent,
  money,
  percentTenths,
  type TrendMonth,
} from "@strictbudget/engine";
import { type ChartConfig, ChartContainer } from "@strictbudget/ui/components/chart";
import { cn } from "@strictbudget/ui/lib/utils";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useBudget } from "@/lib/budget-context";
import { chartNumber, monthLabel } from "@/lib/reports";
import type { SeriesInfo } from "@/lib/spending-trends";

export interface TrendChartData {
  /** The range's months with their series (empty months included), oldest first. */
  months: TrendMonth<string>[];
  /** The series, in stack (plan) order. */
  keys: string[];
  info: (key: string) => SeriesInfo;
  average: bigint;
  /** Each month's previous month's total (the month before the range included). */
  previous: Map<BudgetMonth, bigint>;
  /** The rolling 3-month average, per month (null without three months of data). */
  rolling: Map<BudgetMonth, bigint | null>;
  /** The comparison's total per month of the range (a period), or one average for every month. */
  comparison:
    | { kind: "period"; label: string; totals: Map<BudgetMonth, bigint> }
    | { kind: "average"; label: string; average: bigint }
    | null;
}

export interface TrendOverlays {
  average: boolean;
  rolling: boolean;
}

/** A clicked mark: a series in a month (or the whole month when `key` is null). */
export type TrendPick = (month: BudgetMonth, key: string | null) => void;

function useFormat() {
  const { budget, formatAmount } = useBudget();
  const currency = budget.currency as CurrencyCode;
  const format = (v: bigint) => formatAmount(money(v, currency));
  /** An axis tick (a chart position, not an amount) labelled as the nearest whole minor unit. */
  const tick = (v: number) => format(BigInt(Math.round(v * 10 ** currencyExponent(currency))));
  return { format, tick, currency };
}

const spentOf = (net: bigint | undefined) => (net === undefined ? 0n : -net);

function TooltipBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-w-48 max-w-72 gap-1 rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
      <span className="font-medium">{title}</span>
      {children}
    </div>
  );
}

function TooltipRow({
  label,
  value,
  color,
  strong,
  muted,
}: {
  label: ReactNode;
  value: ReactNode;
  color?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-center justify-between gap-4 tabular-nums",
        strong && "font-semibold text-sm",
        muted && "text-muted-foreground",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {color && (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-[2px]"
            style={{ background: color }}
          />
        )}
        <span className={cn("truncate", !strong && "text-muted-foreground")}>{label}</span>
      </span>
      <span className="shrink-0">{value}</span>
    </span>
  );
}

/** "↑ +$500.00 (24.4%)": a signed difference and its size as a percent of `base`. */
export function DifferenceText({
  difference,
  percent,
  format,
}: {
  difference: bigint;
  percent: string | null;
  format: (v: bigint) => string;
}) {
  const arrow = difference > 0n ? "↑" : difference < 0n ? "↓" : "";
  const sign = difference > 0n ? "+" : "";
  return (
    <span className="tabular-nums">
      {arrow && (
        <span aria-hidden className="mr-1">
          {arrow}
        </span>
      )}
      {sign}
      {format(difference)}
      {percent !== null && ` (${percent}%)`}
    </span>
  );
}

function MonthTooltip({
  month,
  data,
  maxSeries = 8,
}: {
  month: TrendMonth<string>;
  data: TrendChartData;
  maxSeries?: number;
}) {
  const { format } = useFormat();
  const previous = data.previous.get(month.month);
  const change = previous === undefined ? null : comparedToAverage(month.total, previous);
  const vsAverage = comparedToAverage(month.total, data.average);
  const rolling = data.rolling.get(month.month);
  const comparison =
    data.comparison?.kind === "period"
      ? data.comparison.totals.get(month.month)
      : data.comparison?.average;
  const series = [...month.nets]
    .sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0))
    .filter(([, net]) => net !== 0n);
  return (
    <TooltipBox title={monthLabel(month.month)}>
      <TooltipRow label="Total Spending" value={format(month.total)} strong />
      {month.netInflows > 0n && (
        <>
          <TooltipRow label="Spending" value={format(month.spending)} muted />
          <TooltipRow label="Net Inflows" value={format(-month.netInflows)} muted />
        </>
      )}
      {change && (
        <TooltipRow
          label="From previous month"
          value={<DifferenceText {...change} format={format} />}
        />
      )}
      <TooltipRow
        label="Compared to average"
        value={<DifferenceText {...vsAverage} format={format} />}
      />
      {rolling !== undefined && rolling !== null && (
        <TooltipRow label="3-month average" value={format(rolling)} />
      )}
      {data.comparison && comparison !== undefined && (
        <TooltipRow label={data.comparison.label} value={format(comparison)} />
      )}
      {series.length > 0 && <span className="mt-1 border-t" />}
      {series.slice(0, maxSeries).map(([key, net]) => {
        const info = data.info(key);
        const share = net < 0n ? percentTenths(-net, month.spending) : null;
        return (
          <TooltipRow
            key={key}
            color={info.color}
            label={info.label}
            value={
              <>
                {format(-net)}
                <span className="ml-1 text-muted-foreground">
                  {net > 0n ? "Net Inflows" : share !== null && `${share}%`}
                </span>
              </>
            }
          />
        );
      })}
      {series.length > maxSeries && (
        <span className="text-muted-foreground">
          {series.length - maxSeries} more (click a bar for its transactions)
        </span>
      )}
    </TooltipBox>
  );
}

const monthTick = (m: string) => monthLabel(m, "axis");

const pickedMonth = (mark: unknown) =>
  (mark as { payload?: { month?: string } } | undefined)?.payload?.month as BudgetMonth | undefined;

/** Positive-inflow series stack below zero; months above the average are shaded. */
export function TrendBarsChart({
  data,
  charted,
  overlays,
  onPick,
  className,
}: {
  data: TrendChartData;
  /** Months without transactions are left out. */
  charted: TrendMonth<string>[];
  overlays: TrendOverlays;
  onPick: TrendPick;
  className?: string;
}) {
  const { tick, currency } = useFormat();
  const byMonth = new Map(data.months.map((m) => [m.month, m]));
  const ghost = data.comparison?.kind === "period" ? data.comparison : null;
  const rows = charted.map((m) => {
    const row: Record<string, number | string | null> = {
      month: m.month,
      total: chartNumber(m.total, currency),
    };
    for (const key of data.keys) {
      const net = m.nets.get(key);
      if (net !== undefined) row[key] = chartNumber(-net, currency);
    }
    const rolling = data.rolling.get(m.month);
    row.rolling = rolling === undefined || rolling === null ? null : chartNumber(rolling, currency);
    const g = ghost?.totals.get(m.month);
    if (g !== undefined) row.ghost = chartNumber(g, currency);
    return row;
  });
  const above = charted.filter((m) => m.total > data.average && m.total > 0n);
  const config = Object.fromEntries(
    data.keys.map((k) => [k, { label: data.info(k).label, color: data.info(k).color }]),
  ) satisfies ChartConfig;
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-72 w-full", className)}>
      <ComposedChart
        data={rows}
        stackOffset="sign"
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        barCategoryGap="20%"
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickFormatter={monthTick} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={84} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={({ active, label }) => {
            const m = active && typeof label === "string" ? byMonth.get(label) : undefined;
            return m ? <MonthTooltip month={m} data={data} /> : null;
          }}
        />
        {above.map((m) => (
          <ReferenceArea
            key={m.month}
            x1={m.month}
            x2={m.month}
            fill="var(--foreground)"
            fillOpacity={0.06}
            className="pointer-events-none"
          />
        ))}
        {ghost && (
          <Bar
            dataKey="ghost"
            name={ghost.label}
            fill="var(--muted-foreground)"
            fillOpacity={0.25}
            stackId="ghost"
            isAnimationActive={false}
          />
        )}
        {data.keys.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            name={data.info(key).label}
            stackId="spending"
            fill={data.info(key).color}
            cursor="pointer"
            isAnimationActive={false}
            onClick={(mark) => {
              const month = pickedMonth(mark);
              if (month) onPick(month, key);
            }}
          />
        ))}
        {overlays.average && (
          <ReferenceLine
            y={chartNumber(data.average, currency)}
            stroke="var(--foreground)"
            strokeDasharray="6 4"
            strokeOpacity={0.6}
          />
        )}
        {data.comparison?.kind === "average" && (
          <ReferenceLine
            y={chartNumber(data.comparison.average, currency)}
            stroke="var(--muted-foreground)"
            strokeDasharray="2 3"
          />
        )}
        <Line
          dataKey="total"
          name="Total Spending"
          type="linear"
          stroke="var(--muted-foreground)"
          strokeWidth={1}
          dot={{ r: 4, fill: "var(--background)", stroke: "var(--foreground)", strokeWidth: 1.5 }}
          activeDot={{
            r: 5,
            cursor: "pointer",
            onClick: (_: unknown, point: unknown) => {
              const month = pickedMonth(point);
              if (month) onPick(month, null);
            },
          }}
          isAnimationActive={false}
        />
        {overlays.rolling && (
          <Line
            dataKey="rolling"
            name="3-month average"
            type="monotone"
            stroke="var(--primary)"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ChartContainer>
  );
}

/** The top spenders and Other, one line each. */
export function TrendLinesChart({ data, onPick }: { data: TrendChartData; onPick: TrendPick }) {
  const { format, tick, currency } = useFormat();
  const byMonth = new Map(data.months.map((m) => [m.month, m]));
  const rows = data.months.map((m) => {
    const row: Record<string, number | string> = { month: m.month };
    for (const key of data.keys) row[key] = chartNumber(spentOf(m.nets.get(key)), currency);
    return row;
  });
  const config = Object.fromEntries(
    data.keys.map((k) => [k, { label: data.info(k).label, color: data.info(k).color }]),
  ) satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickFormatter={monthTick} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={84} />
        <Tooltip
          content={({ active, label }) => {
            const m = active && typeof label === "string" ? byMonth.get(label) : undefined;
            if (!m) return null;
            return (
              <TooltipBox title={monthLabel(m.month)}>
                <TooltipRow label="Total Spending" value={format(m.total)} strong />
                {data.keys.map((key) => (
                  <TooltipRow
                    key={key}
                    color={data.info(key).color}
                    label={data.info(key).label}
                    value={format(spentOf(m.nets.get(key)))}
                  />
                ))}
              </TooltipBox>
            );
          }}
        />
        {data.keys.map((key) => (
          <Line
            key={key}
            dataKey={key}
            name={data.info(key).label}
            type="linear"
            stroke={data.info(key).color}
            strokeWidth={2}
            dot={{ r: 2.5 }}
            activeDot={{
              r: 5,
              cursor: "pointer",
              onClick: (_: unknown, point: unknown) => {
                const month = pickedMonth(point);
                if (month) onPick(month, key);
              },
            }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

/** Only what was spent counts: a series with net inflows that month has no share. */
export function TrendShareChart({ data, onPick }: { data: TrendChartData; onPick: TrendPick }) {
  const { format, currency } = useFormat();
  const byMonth = new Map(data.months.map((m) => [m.month, m]));
  const spentBase = (m: TrendMonth<string>) =>
    data.keys.reduce((s, k) => {
      const spent = spentOf(m.nets.get(k));
      return spent > 0n ? s + spent : s;
    }, 0n);
  const rows = data.months.map((m) => {
    const row: Record<string, number | string> = { month: m.month };
    for (const key of data.keys) {
      const spent = spentOf(m.nets.get(key));
      row[key] = spent > 0n ? chartNumber(spent, currency) : 0;
    }
    return row;
  });
  const config = Object.fromEntries(
    data.keys.map((k) => [k, { label: data.info(k).label, color: data.info(k).color }]),
  ) satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <BarChart data={rows} stackOffset="expand" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickFormatter={monthTick} tickLine={false} axisLine={false} />
        <YAxis
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={({ active, label }) => {
            const m = active && typeof label === "string" ? byMonth.get(label) : undefined;
            if (!m) return null;
            const base = spentBase(m);
            return (
              <TooltipBox title={monthLabel(m.month)}>
                <TooltipRow label="Spending" value={format(base)} strong />
                {data.keys.map((key) => {
                  const spent = spentOf(m.nets.get(key));
                  if (spent <= 0n) return null;
                  return (
                    <TooltipRow
                      key={key}
                      color={data.info(key).color}
                      label={data.info(key).label}
                      value={
                        <>
                          {percentTenths(spent, base)}%
                          <span className="ml-1 text-muted-foreground">{format(spent)}</span>
                        </>
                      }
                    />
                  );
                })}
              </TooltipBox>
            );
          }}
        />
        {data.keys.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            name={data.info(key).label}
            stackId="share"
            fill={data.info(key).color}
            cursor="pointer"
            isAnimationActive={false}
            onClick={(mark) => {
              const month = pickedMonth(mark);
              if (month) onPick(month, key);
            }}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** One shared scale across series, biggest spenders first. */
export function TrendMultiples({ data, onPick }: { data: TrendChartData; onPick: TrendPick }) {
  const { format, currency } = useFormat();
  const totals = new Map(
    data.keys.map((k) => [k, data.months.reduce((s, m) => s + spentOf(m.nets.get(k)), 0n)]),
  );
  const keys = [...data.keys].sort((a, b) => {
    const x = totals.get(a) ?? 0n;
    const y = totals.get(b) ?? 0n;
    return x > y ? -1 : x < y ? 1 : 0;
  });
  let max = 0;
  let min = 0;
  for (const m of data.months) {
    for (const key of data.keys) {
      const v = chartNumber(spentOf(m.nets.get(key)), currency);
      max = Math.max(max, v);
      min = Math.min(min, v);
    }
  }
  const domain: [number, number] = [min, max || 1];
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {keys.map((key) => {
        const info = data.info(key);
        const rows = data.months.map((m) => ({
          month: m.month,
          value: chartNumber(spentOf(m.nets.get(key)), currency),
        }));
        return (
          <li key={key} className="grid gap-1 rounded-md border p-2">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 font-medium">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ background: info.color }}
                />
                <span className="truncate">{info.label}</span>
              </span>
              <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                {format(totals.get(key) ?? 0n)}
              </span>
            </div>
            <ChartContainer
              config={{ value: { label: info.label, color: info.color } }}
              className="aspect-auto h-20 w-full"
            >
              <BarChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="month" hide />
                <YAxis hide domain={domain} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                  content={({ active, label }) => {
                    if (!active || typeof label !== "string") return null;
                    const m = data.months.find((x) => x.month === label);
                    return m ? (
                      <TooltipBox title={`${info.label} · ${monthLabel(m.month)}`}>
                        <TooltipRow label="Spending" value={format(spentOf(m.nets.get(key)))} />
                      </TooltipBox>
                    ) : null;
                  }}
                />
                <Bar
                  dataKey="value"
                  fill={info.color}
                  cursor="pointer"
                  isAnimationActive={false}
                  onClick={(mark) => {
                    const month = pickedMonth(mark);
                    if (month) onPick(month, key);
                  }}
                />
              </BarChart>
            </ChartContainer>
          </li>
        );
      })}
    </ul>
  );
}

export function TrendLegend({
  data,
  onPick,
}: {
  data: TrendChartData;
  onPick?: (key: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
      {data.keys.map((key) => {
        const info = data.info(key);
        const body = (
          <>
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ background: info.color }}
            />
            {info.label}
          </>
        );
        return (
          <li key={key}>
            {onPick ? (
              <button
                type="button"
                className="flex items-center gap-1.5 hover:text-foreground"
                onClick={() => onPick(key)}
              >
                {body}
              </button>
            ) : (
              <span className="flex items-center gap-1.5">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function TrendBarsKey({
  data,
  overlays,
}: {
  data: TrendChartData;
  overlays: TrendOverlays;
}) {
  const { format } = useFormat();
  const hasAbove = data.months.some((m) => m.total > data.average && m.total > 0n);
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-full border-[1.5px] border-foreground" />
        Total Spending
      </li>
      {hasAbove && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-2.5 rounded-[2px] bg-foreground/10" />
          Above the average
        </li>
      )}
      {overlays.average && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="w-4 border-foreground/60 border-t border-dashed" />
          Average {format(data.average)}
        </li>
      )}
      {overlays.rolling && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="w-4 border-primary border-t-2 border-dashed" />
          3-month average
        </li>
      )}
      {data.comparison?.kind === "period" && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-2.5 rounded-[2px] bg-muted-foreground/25" />
          {data.comparison.label}
        </li>
      )}
      {data.comparison?.kind === "average" && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="w-4 border-muted-foreground border-t border-dotted" />
          {data.comparison.label}
        </li>
      )}
    </ul>
  );
}
