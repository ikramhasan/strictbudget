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
import { cn } from "@strictbudget/ui/lib/utils";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { useBudget } from "@/lib/budget-context";
import { chartNumber, chartTick } from "@/lib/reports";
import { dayLabel, type PaceLine } from "@/lib/spending-pace";

const REMAINING_COLOR = "var(--report-1)";
const IDEAL_COLOR = "var(--muted-foreground)";
const TODAY_COLOR = "color-mix(in oklab, var(--foreground) 45%, transparent)";

/** The projection is red only when it runs out; otherwise it continues the line it projects. */
const projectionColor = (line: PaceLine) =>
  line.runOutDate !== null || line.status === "behind" ? "var(--destructive)" : REMAINING_COLOR;

const configOf = (line: PaceLine) =>
  ({
    remaining: { label: "Left to spend", color: REMAINING_COLOR },
    ideal: { label: "Even pace", color: IDEAL_COLOR },
    projection: { label: "At this pace", color: projectionColor(line) },
  }) satisfies ChartConfig;

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
 * grey), the projection at the pace so far (dashed, red when it runs out) and today's line.
 * SpendingPaceLegend names each mark.
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
  /** Small (the plan screen's version): no grid, only the first and last day and the start. */
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
  const ticks = compact ? [1, days] : [1, 8, 15, 22, days];
  const startUnits = chartNumber(BigInt(line.start), currency);

  return (
    <ChartContainer config={configOf(line)} className={className}>
      <ComposedChart
        data={data}
        margin={
          compact ? { top: 14, right: 8, bottom: 0, left: 0 } : { top: 20, right: 16, left: 8 }
        }
      >
        {!compact && <CartesianGrid vertical={false} strokeDasharray="3 3" />}
        {!finished && (
          <ReferenceLine
            x={elapsed}
            stroke={TODAY_COLOR}
            label={{
              value: "Today",
              position: "top",
              fontSize: compact ? 10 : 11,
              fill: "var(--muted-foreground)",
            }}
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
          fontSize={compact ? 10 : undefined}
        />
        <YAxis
          {...(compact ? { ticks: [0, startUnits], fontSize: 10, width: 64 } : { width: 80 })}
          niceTicks={compact ? undefined : "snap125"}
          // The small chart's one amount, the start, reads as whole units.
          tickFormatter={compact ? (units: number) => tick(Math.trunc(units)) : tick}
          tickLine={false}
          axisLine={false}
        />
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

/** Names every mark on SpendingPaceChart. */
export function SpendingPaceLegend({
  line,
  finished,
  className,
}: {
  line: PaceLine;
  finished: boolean;
  className?: string;
}) {
  const items: { label: string; border: string; vertical?: boolean }[] = [
    { label: "Left to spend", border: `2px solid ${REMAINING_COLOR}` },
    { label: "Even pace", border: `2px dashed ${IDEAL_COLOR}` },
    ...(finished
      ? []
      : [
          { label: "At this pace", border: `2px dashed ${projectionColor(line)}` },
          { label: "Today", border: `1px solid ${TODAY_COLOR}`, vertical: true },
        ]),
  ];
  return (
    <ul
      aria-label="Legend"
      className={cn("flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs", className)}
    >
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={i.vertical ? "h-3 w-px" : "h-0 w-4"}
            style={i.vertical ? { borderLeft: i.border } : { borderTop: i.border }}
          />
          {i.label}
        </li>
      ))}
    </ul>
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
