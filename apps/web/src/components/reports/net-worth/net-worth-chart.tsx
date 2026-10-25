import type { CurrencyCode } from "@strictbudget/engine";
import { type ChartConfig, ChartContainer } from "@strictbudget/ui/components/chart";
import { cn } from "@strictbudget/ui/lib/utils";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { NetWorthMonth } from "@/lib/net-worth";
import { chartNumber, monthLabel } from "@/lib/reports";
import { useAmountFormat } from "./format";

const config = {
  assets: { label: "Assets", color: "var(--report-1)" },
  debts: { label: "Debts", color: "var(--report-4)" },
  netWorth: { label: "Net Worth", color: "var(--foreground)" },
} satisfies ChartConfig;

/** Assets above zero, debts below, net worth as a line; a ringed point marks a new all-time high. */
export function NetWorthChart({
  months,
  currency,
  showAmounts = true,
  onSelectMonth,
  className,
  fill = false,
}: {
  months: readonly NetWorthMonth[];
  currency: CurrencyCode;
  showAmounts?: boolean;
  onSelectMonth?: (month: string) => void;
  className?: string;
  /** Takes the height left in a flex column (the share picture) instead of a fixed one. */
  fill?: boolean;
}) {
  const format = useAmountFormat(currency);
  const data = months.map((m) => ({
    month: m.month,
    assets: chartNumber(m.assets, currency),
    debts: chartNumber(m.debts, currency),
    netWorth: chartNumber(m.netWorth, currency),
  }));
  const byMonth = new Map(months.map((m) => [m.month, m]));
  return (
    <div className={cn("grid gap-2", fill && "flex min-h-0 flex-1 flex-col")}>
      <ChartContainer
        config={config}
        className={cn("aspect-auto h-72 w-full", fill && "h-auto min-h-0 flex-1", className)}
      >
        <ComposedChart
          data={data}
          stackOffset="sign"
          margin={{ top: 12, right: 12, bottom: 0, left: showAmounts ? 8 : 0 }}
          onClick={(state) => {
            const label = (state as { activeLabel?: string } | null)?.activeLabel;
            if (label && onSelectMonth) onSelectMonth(label);
          }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => monthLabel(m, "axis")}
            tickLine={false}
            axisLine={false}
            minTickGap={8}
          />
          <YAxis
            hide={!showAmounts}
            tickFormatter={format.tick}
            tickLine={false}
            axisLine={false}
            width={showAmounts ? 80 : 0}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={({ active, label }) => {
              const m = typeof label === "string" ? byMonth.get(label) : undefined;
              if (!active || !m) return null;
              const amount = (v: string) => (showAmounts ? format.exact(v) : format.masked);
              return (
                <div className="grid gap-1 rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                  <span className="font-medium">{monthLabel(m.month, "long")}</span>
                  {(
                    [
                      ["Net Worth", m.netWorth, "var(--foreground)"],
                      ["Assets", m.assets, "var(--report-1)"],
                      ["Debts", m.debts, "var(--report-4)"],
                    ] as const
                  ).map(([name, value, color]) => (
                    <span
                      key={name}
                      className="flex items-center justify-between gap-4 tabular-nums"
                    >
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="size-2 rounded-xs" style={{ background: color }} />
                        {name}
                      </span>
                      {amount(value)}
                    </span>
                  ))}
                  {m.allTimeHigh && <span className="font-medium">New all-time high</span>}
                </div>
              );
            }}
          />
          <Bar
            dataKey="assets"
            stackId="nw"
            fill="var(--color-assets)"
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
          <Bar
            dataKey="debts"
            stackId="nw"
            fill="var(--color-debts)"
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
          <Line
            dataKey="netWorth"
            type="linear"
            stroke="var(--color-netWorth)"
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const high = props.index !== undefined && months[props.index]?.allTimeHigh;
              return (
                <circle
                  key={props.index}
                  cx={props.cx}
                  cy={props.cy}
                  r={high ? 5 : 3}
                  fill={high ? "var(--report-7)" : "var(--background)"}
                  stroke="var(--color-netWorth)"
                  strokeWidth={2}
                />
              );
            }}
          />
        </ComposedChart>
      </ChartContainer>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
        <LegendItem color="var(--report-1)" label="Assets" />
        <LegendItem color="var(--report-4)" label="Debts" />
        <LegendItem color="var(--foreground)" label="Net Worth" line />
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-full border-2 border-foreground"
            style={{ background: "var(--report-7)" }}
          />
          New all-time high
        </li>
      </ul>
    </div>
  );
}

export function LegendItem({
  color,
  label,
  line = false,
}: {
  color: string;
  label: string;
  line?: boolean;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden
        className={line ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-xs"}
        style={{ background: color }}
      />
      {label}
    </li>
  );
}
