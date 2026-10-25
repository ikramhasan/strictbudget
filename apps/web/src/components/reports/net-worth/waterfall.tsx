import type { CurrencyCode } from "@strictbudget/engine";
import { type ChartConfig, ChartContainer } from "@strictbudget/ui/components/chart";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { cn } from "@strictbudget/ui/lib/utils";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  type NetWorthReport,
  PART_HINTS,
  previousNetWorth,
  type WaterfallStep,
  waterfall,
  waterfallScale,
} from "@/lib/net-worth";
import { chartNumber, monthLabel } from "@/lib/reports";
import { useAmountFormat } from "./format";

const config = { range: { label: "Change" } } satisfies ChartConfig;

/** The bars' axis labels (the list below names each part in full). */
const SHORT: Record<WaterfallStep["key"], string> = {
  start: "Start",
  netSaved: "Saved",
  debtPaidDown: "Debt",
  tracking: "Track",
  other: "Other",
  end: "End",
};

/**
 * A waterfall from the month before's net worth through net saved from income, debt paid down,
 * tracking accounts and other, to the month's.
 */
export function WhatChanged({
  report,
  month,
  onMonthChange,
}: {
  report: Pick<NetWorthReport, "opening" | "months" | "currency">;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const currency = report.currency as CurrencyCode;
  const format = useAmountFormat(currency);
  const index = Math.max(
    0,
    report.months.findIndex((m) => m.month === month),
  );
  const current = report.months[index];
  if (!current) return null;
  const steps = waterfall(previousNetWorth(report, index), current);
  const color = (key: string, amount: bigint) =>
    key === "start" || key === "end"
      ? "var(--muted-foreground)"
      : amount < 0n
        ? "var(--report-4)"
        : "var(--report-3)";
  const scale = waterfallScale(steps);
  const data = steps.map((s) => {
    const total = s.key === "start" || s.key === "end";
    const [low, high] = total
      ? s.amount < scale.baseline
        ? [s.amount, scale.baseline]
        : [scale.baseline, s.amount]
      : [s.low, s.high];
    return {
      label: SHORT[s.key],
      range: [chartNumber(low, currency), chartNumber(high, currency)],
    };
  });
  return (
    <section aria-label="What changed this month" className="grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">What changed this month</h2>
        <NativeSelect
          aria-label="Month"
          size="sm"
          className="ml-auto"
          value={current.month}
          onChange={(e) => onMonthChange(e.target.value)}
        >
          {[...report.months].reverse().map((m) => (
            <NativeSelectOption key={m.month} value={m.month}>
              {monthLabel(m.month, "long")}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickFormatter={format.tick}
            tickLine={false}
            axisLine={false}
            width={80}
            domain={[chartNumber(scale.low, currency), chartNumber(scale.high, currency)]}
            allowDataOverflow
          />
          {scale.baseline === 0n && <ReferenceLine y={0} stroke="var(--border)" />}
          <Bar dataKey="range" radius={4} isAnimationActive={false}>
            {steps.map((s) => (
              <Cell key={s.key} fill={color(s.key, s.amount)} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <dl className="grid gap-1 text-sm">
        {steps.map((s) => (
          <div
            key={s.key}
            className={cn(
              "flex items-baseline justify-between gap-4 tabular-nums",
              (s.key === "start" || s.key === "end") && "font-medium",
              s.key === "end" && "border-t pt-1",
            )}
          >
            <dt
              className="flex items-center gap-1.5"
              title={s.key in PART_HINTS ? PART_HINTS[s.key as keyof typeof PART_HINTS] : undefined}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-xs"
                style={{ background: color(s.key, s.amount) }}
              />
              {s.key === "start"
                ? `End of ${monthLabel(report.months[index - 1]?.month ?? report.opening.month, "long")}`
                : s.key === "end"
                  ? `End of ${monthLabel(current.month, "long")}`
                  : s.label}
            </dt>
            <dd>
              {s.key !== "start" && s.key !== "end" && s.amount > 0n ? "+" : ""}
              {format.exact(s.amount)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-xs">
        Net saved from income is what your budget accounts took in less what they spent (money sent
        to loans and tracking accounts counts as spent). Other covers new accounts' starting
        balances, loan interest and escrow, and exchange-rate changes.
      </p>
    </section>
  );
}
