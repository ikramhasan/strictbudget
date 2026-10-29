import { type BudgetMonth, money, NUMBER_FORMAT_SPECS } from "@strictbudget/engine";
import { type ChartConfig, ChartContainer } from "@strictbudget/ui/components/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@strictbudget/ui/components/table";
import { Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { useBudget } from "@/lib/budget-context";
import { chartNumber, chartTick, monthLabel } from "@/lib/reports";
import type { MonthBar } from "@/lib/spending-by-flag";

function useFormat() {
  const { budget, formatAmount } = useBudget();
  const currency = budget.currency;
  const format = (amount: bigint) => formatAmount(money(amount, currency));
  const spec = NUMBER_FORMAT_SPECS[budget.numberFormat];
  const tick = (units: number) => chartTick(units, currency, format, spec.decimal);
  return { format, tick, currency };
}

/** One flag's spending month by month; a bar opens that month's transactions. */
export function FlagMonthChart({
  bars,
  color,
  onPick,
}: {
  bars: MonthBar[];
  color: string;
  onPick: (month: BudgetMonth) => void;
}) {
  const { format, tick, currency } = useFormat();
  const config = { spent: { label: "Spending", color } } satisfies ChartConfig;
  const data = bars.map((b) => ({ ...b, value: chartNumber(b.spent, currency) }));
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          tickFormatter={(m: string) => monthLabel(m as BudgetMonth, "axis")}
          tickLine={false}
          axisLine={false}
        />
        <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={80} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={({ active, label }) => {
            const bar = active ? bars.find((b) => b.month === label) : undefined;
            if (!bar) return null;
            return (
              <div className="grid min-w-40 gap-1 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                <p className="font-medium">{monthLabel(bar.month, "long")}</p>
                <p className="flex items-center gap-2">
                  <span aria-hidden className="size-2 rounded-xs" style={{ background: color }} />
                  <span className="text-muted-foreground">Spending</span>
                  <span className="ml-auto font-medium tabular-nums">{format(bar.spent)}</span>
                </p>
                <p className="text-muted-foreground">
                  {bar.count} {bar.count === 1 ? "transaction" : "transactions"}
                </p>
              </div>
            );
          }}
        />
        <Bar
          dataKey="value"
          fill="var(--color-spent)"
          maxBarSize={56}
          radius={[3, 3, 0, 0]}
          className="cursor-pointer"
          isAnimationActive={false}
          onClick={(d: { payload?: MonthBar }) => d.payload && onPick(d.payload.month)}
        />
      </BarChart>
    </ChartContainer>
  );
}

export function FlagMonthTable({
  bars,
  onPick,
}: {
  bars: MonthBar[];
  onPick: (month: BudgetMonth) => void;
}) {
  const { format } = useFormat();
  const total = bars.reduce((sum, b) => sum + b.spent, 0n);
  const count = bars.reduce((sum, b) => sum + b.count, 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Spending</TableHead>
          <TableHead className="text-right">Transactions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bars.map((b) => (
          <TableRow key={b.month}>
            <TableCell>
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onPick(b.month)}
              >
                {monthLabel(b.month, "long")}
              </button>
            </TableCell>
            <TableCell className="text-right tabular-nums">{format(b.spent)}</TableCell>
            <TableCell className="text-right tabular-nums">{b.count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell className="text-right tabular-nums">{format(total)}</TableCell>
          <TableCell className="text-right tabular-nums">{count}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
