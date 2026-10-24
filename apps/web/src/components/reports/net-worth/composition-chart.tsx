import type { CurrencyCode } from "@strictbudget/engine";
import { type ChartConfig, ChartContainer } from "@strictbudget/ui/components/chart";
import { Area, AreaChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import {
  COMPOSITION_KINDS,
  COMPOSITION_LABELS,
  type CompositionKind,
  composition,
  type NetWorthReport,
  usedKinds,
} from "@/lib/net-worth";
import { chartNumber, monthLabel } from "@/lib/reports";
import { useAmountFormat } from "./format";
import { LegendItem } from "./net-worth-chart";

/** Each kind keeps its colour whichever kinds are shown. */
const KIND_COLOR: Record<CompositionKind, string> = {
  cash: "var(--report-1)",
  savings: "var(--report-5)",
  investments: "var(--report-3)",
  credit: "var(--report-4)",
  loans: "var(--report-6)",
  liabilities: "var(--report-2)",
};

const config = Object.fromEntries(
  COMPOSITION_KINDS.map((k) => [k, { label: COMPOSITION_LABELS[k], color: KIND_COLOR[k] }]),
) satisfies ChartConfig;

/** Balances stacked by account kind, assets above zero and debts below. */
export function CompositionChart({
  report,
}: {
  report: Pick<NetWorthReport, "months" | "accounts" | "currency">;
}) {
  const currency = report.currency as CurrencyCode;
  const format = useAmountFormat(currency);
  const rows = composition(report);
  const kinds = usedKinds(rows);
  const data = rows.map((r) => ({
    month: r.month,
    ...Object.fromEntries(kinds.map((k) => [k, chartNumber(r.sums[k], currency)])),
  }));
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return (
    <div className="grid gap-2">
      <ChartContainer config={config} className="aspect-auto h-72 w-full">
        <AreaChart
          data={data}
          stackOffset="sign"
          margin={{ top: 12, right: 12, bottom: 0, left: 8 }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => monthLabel(m, "axis")}
            tickLine={false}
            axisLine={false}
            minTickGap={8}
          />
          <YAxis tickFormatter={format.tick} tickLine={false} axisLine={false} width={80} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            content={({ active, label }) => {
              const row = typeof label === "string" ? byMonth.get(label) : undefined;
              if (!active || !row) return null;
              return (
                <div className="grid gap-1 rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                  <span className="font-medium">{monthLabel(row.month, "long")}</span>
                  {kinds.map((k) => (
                    <span key={k} className="flex items-center justify-between gap-4 tabular-nums">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="size-2 rounded-xs" style={{ background: KIND_COLOR[k] }} />
                        {COMPOSITION_LABELS[k]}
                      </span>
                      {format.exact(row.sums[k])}
                    </span>
                  ))}
                </div>
              );
            }}
          />
          {kinds.map((k) => (
            <Area
              key={k}
              dataKey={k}
              stackId="kinds"
              type="linear"
              stroke={`var(--color-${k})`}
              fill={`var(--color-${k})`}
              fillOpacity={0.5}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ChartContainer>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
        {kinds.map((k) => (
          <LegendItem key={k} color={KIND_COLOR[k]} label={COMPOSITION_LABELS[k]} />
        ))}
      </ul>
    </div>
  );
}
