import { type BudgetMonth, money, NUMBER_FORMAT_SPECS } from "@strictbudget/engine";
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
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useBudget } from "@/lib/budget-context";
import {
  type CategoryHistory,
  type CategoryHistoryMonth,
  moveCounterpart,
  movedNet,
  overspentBy,
  overspentKind,
} from "@/lib/category-history";
import { chartNumber, chartTick, monthLabel } from "@/lib/reports";

const config = {
  assigned: { label: "Assigned", color: "var(--report-3)" },
  spent: { label: "Spent", color: "var(--report-2)" },
  available: { label: "Available", color: "var(--foreground)" },
  target: { label: "Target", color: "var(--report-6)" },
} satisfies ChartConfig;

/** The plan's overspending colours: red for cash, yellow for credit (as the plan's pills). */
const OVERSPENT_FILL = { cash: "var(--destructive)", credit: "var(--color-yellow-500)" } as const;
const OVERSPENT_TEXT = {
  cash: "text-destructive",
  credit: "text-yellow-800 dark:text-yellow-200",
} as const;
const MOVE_COLOR = "var(--report-1)";

function useFormat() {
  const { budget, formatAmount } = useBudget();
  const currency = budget.currency;
  const format = (amount: bigint | string) => formatAmount(money(BigInt(amount), currency));
  const spec = NUMBER_FORMAT_SPECS[budget.numberFormat];
  const tick = (units: number) =>
    chartTick(units, currency, (m) => formatAmount(money(m, currency)), spec.decimal);
  return { format, tick, currency };
}

/**
 * Per month: Assigned and Spent (−Activity) side by side, Available as a line, what the target
 * asked as a step line, overspent months shaded in the plan's cash or credit colour, and a dot
 * under months with money moved in or out (the tooltip lists the moves). Bar heights are
 * positions only; every amount shown is the exact one.
 */
export function CategoryHistoryChart({
  history,
  names,
  compact = false,
  onPick,
  className,
}: {
  history: CategoryHistory;
  /** Category names by id, for the moves' other sides. */
  names: Map<string, string>;
  /** The inspector's small version: no value axis or legend. */
  compact?: boolean;
  onPick?: (month: BudgetMonth) => void;
  className?: string;
}) {
  const { tick, currency } = useFormat();
  const byMonth = new Map(history.months.map((m) => [m.month, m]));
  const data = history.months.map((m) => ({
    month: m.month,
    assigned: chartNumber(m.assigned, currency),
    spent: chartNumber(-BigInt(m.activity), currency),
    available: chartNumber(m.available, currency),
    target: m.targetAmount === null ? null : chartNumber(m.targetAmount, currency),
    // A dot along the top for months with money moved in or out (on an axis of its own).
    moved: m.moves.length > 0 ? 1 : null,
  }));
  const hasTarget = history.months.some((m) => m.targetAmount !== null);
  const pick = onPick
    ? (d: { payload?: { month: string } }) => d.payload && onPick(d.payload.month as BudgetMonth)
    : undefined;
  return (
    <div className="grid gap-2">
      <ChartContainer
        config={config}
        className={cn("aspect-auto w-full", compact ? "h-28" : "h-72", className)}
      >
        <ComposedChart
          data={data}
          margin={compact ? { top: 6, right: 0, bottom: 0, left: 0 } : { top: 10, right: 8 }}
          barGap={1}
          barCategoryGap={compact ? "15%" : "20%"}
        >
          {!compact && <CartesianGrid vertical={false} strokeDasharray="3 3" />}
          {history.months.map((m) => {
            const kind = overspentKind(m);
            return kind ? (
              <ReferenceArea
                key={m.month}
                x1={m.month}
                x2={m.month}
                fill={OVERSPENT_FILL[kind]}
                fillOpacity={0.12}
                ifOverflow="extendDomain"
                className="pointer-events-none"
              />
            ) : null;
          })}
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => monthLabel(m as BudgetMonth, "axis")}
            tickLine={false}
            axisLine={false}
            fontSize={compact ? 10 : undefined}
            minTickGap={compact ? 12 : 4}
          />
          <YAxis hide={compact} tickFormatter={tick} tickLine={false} axisLine={false} width={80} />
          <YAxis yAxisId="moves" hide domain={[0, 1]} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={({ active, label }) => {
              const m = active && typeof label === "string" ? byMonth.get(label) : undefined;
              return m ? <MonthTooltip month={m} names={names} /> : null;
            }}
          />
          <Bar
            dataKey="assigned"
            fill="var(--color-assigned)"
            radius={[2, 2, 0, 0]}
            maxBarSize={28}
            isAnimationActive={false}
            className={onPick && "cursor-pointer"}
            onClick={pick}
          />
          <Bar
            dataKey="spent"
            fill="var(--color-spent)"
            radius={[2, 2, 0, 0]}
            maxBarSize={28}
            isAnimationActive={false}
            className={onPick && "cursor-pointer"}
            onClick={pick}
          />
          <Scatter
            yAxisId="moves"
            dataKey="moved"
            fill={MOVE_COLOR}
            isAnimationActive={false}
            shape={(p: { cx?: number; cy?: number; payload?: { moved: number | null } }) =>
              p.payload?.moved ? (
                <circle cx={p.cx} cy={p.cy} r={compact ? 2 : 3} fill={MOVE_COLOR} />
              ) : (
                <g />
              )
            }
          />
          {hasTarget && (
            <Line
              dataKey="target"
              type="step"
              stroke="var(--color-target)"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          <Line
            dataKey="available"
            type="linear"
            stroke="var(--color-available)"
            strokeWidth={compact ? 1.5 : 2}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const m = history.months[props.index ?? -1];
              // A group can hold an overspent category while its total stays above zero.
              const kind = m && BigInt(m.available) < 0n ? overspentKind(m) : null;
              return (
                <circle
                  key={props.index}
                  cx={props.cx}
                  cy={props.cy}
                  r={compact ? 2 : 3}
                  fill={kind ? OVERSPENT_FILL[kind] : "var(--color-available)"}
                />
              );
            }}
          />
        </ComposedChart>
      </ChartContainer>
      {!compact && <Legend target={hasTarget} />}
    </div>
  );
}

function Legend({ target }: { target: boolean }) {
  const item = "flex items-center gap-1.5";
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
      <li className={item}>
        <span
          aria-hidden
          className="size-2.5 rounded-xs"
          style={{ background: config.assigned.color }}
        />
        Assigned
      </li>
      <li className={item}>
        <span
          aria-hidden
          className="size-2.5 rounded-xs"
          style={{ background: config.spent.color }}
        />
        Spent
      </li>
      <li className={item}>
        <span aria-hidden className="h-0.5 w-4 bg-foreground" />
        Available
      </li>
      {target && (
        <li className={item}>
          <span
            aria-hidden
            className="w-4 border-t-2 border-dashed"
            style={{ borderColor: config.target.color }}
          />
          Target
        </li>
      )}
      <li className={item}>
        <span aria-hidden className="size-2 rounded-full" style={{ background: MOVE_COLOR }} />
        Money moved
      </li>
      <li className={item}>
        <span aria-hidden className="size-2.5 rounded-xs bg-destructive/25" />
        Overspent (cash)
      </li>
      <li className={item}>
        <span aria-hidden className="size-2.5 rounded-xs bg-yellow-500/25" />
        Overspent (credit)
      </li>
    </ul>
  );
}

function MonthTooltip({
  month: m,
  names,
}: {
  month: CategoryHistoryMonth;
  names: Map<string, string>;
}) {
  const { format } = useFormat();
  const kind = overspentKind(m);
  const row = (label: string, value: string, color?: string) => (
    <p className="flex items-center gap-2">
      {color && <span aria-hidden className="size-2 rounded-xs" style={{ background: color }} />}
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium tabular-nums">{value}</span>
    </p>
  );
  return (
    <div className="grid min-w-52 max-w-72 gap-1 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{monthLabel(m.month as BudgetMonth, "long")}</p>
      {row("Assigned", format(m.assigned), config.assigned.color)}
      {row("Spent", format(-BigInt(m.activity)), config.spent.color)}
      {row("Available", format(m.available))}
      {kind && (
        <p className={OVERSPENT_TEXT[kind]}>
          Overspent ({kind}) by {format(-overspentBy(m))}
        </p>
      )}
      {m.targetAmount !== null && (
        <>
          {row("Target", format(m.targetAmount), config.target.color)}
          {m.targetMet !== null && (
            <p className="text-muted-foreground">{m.targetMet ? "Target met" : "Target not met"}</p>
          )}
        </>
      )}
      {m.moves.length > 0 && (
        <div className="mt-1 grid gap-0.5 border-t pt-1">
          {m.moves.map((v) => {
            const amount = BigInt(v.amount);
            return (
              <p key={v.id} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {amount > 0n ? "From" : "To"} {moveCounterpart(v, names)}
                </span>
                <span className="tabular-nums">
                  {amount > 0n ? "+" : "−"}
                  {format(amount < 0n ? -amount : amount)}
                </span>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The chart's table view: one row per month, every amount exact. */
export function CategoryHistoryTable({
  history,
  names,
  onPick,
}: {
  history: CategoryHistory;
  names: Map<string, string>;
  onPick?: (month: BudgetMonth) => void;
}) {
  const { format } = useFormat();
  const hasTarget = history.months.some((m) => m.targetAmount !== null);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Assigned</TableHead>
          <TableHead className="text-right">Spent</TableHead>
          <TableHead className="text-right">Available</TableHead>
          {hasTarget && <TableHead className="text-right">Target</TableHead>}
          <TableHead>Money moved</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.months.map((m) => {
          const kind = overspentKind(m);
          const moved = movedNet(m);
          return (
            <TableRow key={m.month}>
              <TableCell>
                {onPick ? (
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => onPick(m.month as BudgetMonth)}
                  >
                    {monthLabel(m.month as BudgetMonth, "long")}
                  </button>
                ) : (
                  monthLabel(m.month as BudgetMonth, "long")
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(m.assigned)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {format(-BigInt(m.activity))}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  kind && BigInt(m.available) < 0n && OVERSPENT_TEXT[kind],
                )}
              >
                {format(m.available)}
                {kind && (
                  <span className={cn("block text-xs", OVERSPENT_TEXT[kind])}>
                    Overspent ({kind}) by {format(-overspentBy(m))}
                  </span>
                )}
              </TableCell>
              {hasTarget && (
                <TableCell className="text-right tabular-nums">
                  {m.targetAmount === null ? "—" : format(m.targetAmount)}
                  {m.targetMet !== null && (
                    <span className="block text-muted-foreground text-xs">
                      {m.targetMet ? "Met" : "Not met"}
                    </span>
                  )}
                </TableCell>
              )}
              <TableCell className="text-xs">
                {m.moves.length === 0
                  ? "—"
                  : m.moves.map((v) => {
                      const amount = BigInt(v.amount);
                      return (
                        <span key={v.id} className="block whitespace-nowrap tabular-nums">
                          {amount > 0n ? "+" : "−"}
                          {format(amount < 0n ? -amount : amount)} {amount > 0n ? "from" : "to"}{" "}
                          {moveCounterpart(v, names)}
                        </span>
                      );
                    })}
                {m.moves.length > 1 && (
                  <span className="block text-muted-foreground">Net {format(moved)}</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
