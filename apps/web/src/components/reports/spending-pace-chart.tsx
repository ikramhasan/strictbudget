import { type CurrencyCode, money, NUMBER_FORMAT_SPECS } from "@strictbudget/engine";
import { type ChartConfig, ChartContainer } from "@strictbudget/ui/components/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@strictbudget/ui/components/table";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useBudget } from "@/lib/budget-context";
import { chartNumber, chartTick } from "@/lib/reports";
import { dayLabel, type PaceLine } from "@/lib/spending-pace";

const config = {
  remaining: { label: "Left to spend", color: "var(--report-1)" },
  ideal: { label: "Even pace", color: "var(--muted-foreground)" },
  projection: { label: "At this pace", color: "var(--report-4)" },
} satisfies ChartConfig;

interface Point {
  /** Days since the month began: 0 is its start, n the end of day n. */
  day: number;
  date: string | null;
  remaining: number | null;
  ideal: number;
  projection: number | null;
  exact: { remaining: bigint | null; ideal: bigint; projection: bigint | null };
}

/** The line's points, from the month's start (day 0) to its last day's end. */
function chartPoints(line: PaceLine, elapsed: number, finished: boolean, currency: CurrencyCode) {
  const start = BigInt(line.start);
  const end = BigInt(line.projectedEnd);
  const days = line.points.length;
  const points: Point[] = [
    {
      day: 0,
      date: null,
      remaining: chartNumber(start, currency),
      ideal: chartNumber(start, currency),
      projection: null,
      exact: { remaining: start, ideal: start, projection: null },
    },
  ];
  line.points.forEach((p, i) => {
    const remaining = p.remaining === null ? null : BigInt(p.remaining);
    // The dashed projection runs from today's point to the projected end.
    const projected =
      finished || i + 1 < elapsed
        ? null
        : i + 1 === elapsed
          ? remaining
          : i + 1 === days
            ? end
            : null;
    points.push({
      day: i + 1,
      date: p.date,
      remaining: remaining === null ? null : chartNumber(remaining, currency),
      ideal: chartNumber(p.ideal, currency),
      projection: projected === null ? null : chartNumber(projected, currency),
      exact: { remaining, ideal: BigInt(p.ideal), projection: projected },
    });
  });
  return points;
}

/**
 * The burndown: money left to spend at the end of each day so far, the even pace to zero (dashed,
 * grey), the projection at the pace so far (dashed) and the days passed shaded up to today.
 */
export function SpendingPaceChart({
  line,
  elapsed,
  finished,
  className = "aspect-auto h-72 w-full",
  compact = false,
}: {
  line: PaceLine;
  elapsed: number;
  finished: boolean;
  className?: string;
  /** No axes, grid or tooltip (the plan screen's version). */
  compact?: boolean;
}) {
  const { budget, formatAmount } = useBudget();
  const currency = budget.currency;
  const exact = (amount: bigint) => formatAmount(money(amount, currency));
  const data = chartPoints(line, elapsed, finished, currency);
  const days = line.points.length;
  const spec = NUMBER_FORMAT_SPECS[budget.numberFormat];
  const tick = (units: number) => chartTick(units, currency, exact, spec.decimal);
  const dateOf = (day: number) => line.points[Math.max(0, day - 1)]?.date ?? "";
  const ticks = [1, 8, 15, 22, days];

  return (
    <ChartContainer config={config} className={className}>
      <ComposedChart
        data={data}
        margin={compact ? { top: 4, right: 4, bottom: 4, left: 4 } : { top: 8, right: 16, left: 8 }}
      >
        {!compact && <CartesianGrid vertical={false} strokeDasharray="3 3" />}
        <ReferenceArea
          x1={0}
          x2={elapsed}
          fill="var(--muted-foreground)"
          fillOpacity={0.08}
          ifOverflow="extendDomain"
        />
        {!finished && (
          <ReferenceLine
            x={elapsed}
            stroke="var(--foreground)"
            strokeOpacity={0.4}
            label={
              compact
                ? undefined
                : { value: "Today", position: "insideTopRight", fontSize: 11, fill: "currentColor" }
            }
          />
        )}
        <ReferenceLine y={0} stroke="var(--border)" />
        <XAxis
          dataKey="day"
          type="number"
          domain={[0, days]}
          ticks={ticks}
          // A phone's axis drops the ticks that would overlap.
          interval="preserveStartEnd"
          minTickGap={12}
          tickFormatter={(d: number) => dayLabel(dateOf(d))}
          tickLine={false}
          axisLine={false}
          hide={compact}
        />
        <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={80} hide={compact} />
        {!compact && (
          <Tooltip
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as Point | undefined;
              if (!active || !point) return null;
              return (
                <div className="grid gap-0.5 rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                  <span className="text-muted-foreground">
                    {point.date ? `End of ${dayLabel(point.date)}` : "Start of the month"}
                  </span>
                  {point.exact.remaining !== null && (
                    <span className="tabular-nums">
                      Left to spend:{" "}
                      <span className="font-medium">{exact(point.exact.remaining)}</span>
                    </span>
                  )}
                  <span className="text-muted-foreground tabular-nums">
                    Even pace: {exact(point.exact.ideal)}
                  </span>
                  {point.exact.projection !== null && point.day > elapsed && (
                    <span className="tabular-nums">
                      At this pace: {exact(point.exact.projection)}
                    </span>
                  )}
                </div>
              );
            }}
          />
        )}
        <Line
          dataKey="ideal"
          type="linear"
          stroke="var(--color-ideal)"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="projection"
          type="linear"
          stroke="var(--color-projection)"
          strokeDasharray="6 4"
          strokeWidth={2}
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          dataKey="remaining"
          type="linear"
          stroke="var(--color-remaining)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

/** The chart's table: each day passed, what was left and what an even pace would leave. */
export function SpendingPaceTable({ line }: { line: PaceLine }) {
  const { budget, formatAmount } = useBudget();
  const exact = (amount: string) => formatAmount(money(BigInt(amount), budget.currency));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Day</TableHead>
          <TableHead className="text-right">Left to spend</TableHead>
          <TableHead className="text-right">Even pace</TableHead>
          <TableHead className="text-right">Difference</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {line.points
          .filter((p) => p.remaining !== null)
          .map((p) => (
            <TableRow key={p.date}>
              <TableCell>{dayLabel(p.date)}</TableCell>
              <TableCell className="text-right tabular-nums">{exact(p.remaining ?? "0")}</TableCell>
              <TableCell className="text-right tabular-nums">{exact(p.ideal)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {exact((BigInt(p.remaining ?? "0") - BigInt(p.ideal)).toString())}
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}
