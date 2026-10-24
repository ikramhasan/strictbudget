import { type BudgetMonth, money, NUMBER_FORMAT_SPECS } from "@strictbudget/engine";
import { type ChartConfig, ChartContainer } from "@strictbudget/ui/components/chart";
import {
  Bar,
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
import type { IncomeExpenseTable } from "@/lib/income-expense";
import { chartNumber, chartTick, monthLabel } from "@/lib/reports";

const config = {
  income: { label: "Income", color: "var(--report-3)" },
  expenses: { label: "Expenses", color: "var(--report-4)" },
  net: { label: "Net Income", color: "var(--foreground)" },
} satisfies ChartConfig;

export type ChartSeries = "income" | "expenses";

/** Bar heights are positions only; every label and tooltip amount is the exact one from the table. */
export function IncomeExpenseChart({
  table,
  onPick,
}: {
  table: IncomeExpenseTable;
  onPick: (series: ChartSeries, month: BudgetMonth) => void;
}) {
  const { budget, formatAmount } = useBudget();
  const currency = budget.currency;
  const exact = (amount: bigint) => formatAmount(money(amount, currency));
  const data = table.months.map((month, i) => {
    const income = table.totalIncome.months[i] ?? 0n;
    const expenses = table.totalExpenses.months[i] ?? 0n;
    const net = table.netIncome.months[i] ?? 0n;
    return {
      month,
      income: chartNumber(income, currency),
      expenses: chartNumber(expenses, currency),
      net: chartNumber(net, currency),
      exact: { income, expenses, net },
    };
  });
  const losing = data.filter((d) => d.exact.net < 0n).map((d) => d.month);
  const spec = NUMBER_FORMAT_SPECS[budget.numberFormat];
  const tick = (units: number) =>
    chartTick(units, currency, (m) => formatAmount(money(m, currency)), spec.decimal);
  return (
    <div className="grid gap-2">
      <ChartContainer config={config} className="aspect-auto h-72 w-full">
        <ComposedChart data={data} stackOffset="sign" margin={{ top: 8, right: 8, left: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          {losing.map((m) => (
            <ReferenceArea
              key={m}
              x1={m}
              x2={m}
              fill="var(--destructive)"
              fillOpacity={0.08}
              ifOverflow="extendDomain"
            />
          ))}
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => monthLabel(m as BudgetMonth, "axis")}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={80} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
            content={({ active, label }) => {
              const point = active ? data.find((d) => d.month === label) : undefined;
              if (!point) return null;
              return (
                <div className="grid min-w-44 gap-1 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                  <p className="font-medium">{monthLabel(point.month, "long")}</p>
                  {(["income", "expenses", "net"] as const).map((k) => (
                    <p key={k} className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2 rounded-xs"
                        style={{ background: config[k].color }}
                      />
                      <span className="text-muted-foreground">{config[k].label}</span>
                      <span className="ml-auto font-medium tabular-nums">
                        {exact(point.exact[k])}
                      </span>
                    </p>
                  ))}
                  {point.exact.net < 0n && (
                    <p className="text-destructive">Spent more than came in</p>
                  )}
                </div>
              );
            }}
          />
          <Bar
            dataKey="income"
            stackId="flow"
            maxBarSize={56}
            fill="var(--color-income)"
            radius={[3, 3, 0, 0]}
            className="cursor-pointer"
            onClick={(d: { payload?: { month: BudgetMonth } }) =>
              d.payload && onPick("income", d.payload.month)
            }
          />
          <Bar
            dataKey="expenses"
            stackId="flow"
            maxBarSize={56}
            fill="var(--color-expenses)"
            radius={[0, 0, 3, 3]}
            className="cursor-pointer"
            onClick={(d: { payload?: { month: BudgetMonth } }) =>
              d.payload && onPick("expenses", d.payload.month)
            }
          />
          <Line
            dataKey="net"
            type="linear"
            stroke="var(--color-net)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-net)" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
        {(["income", "expenses", "net"] as const).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={k === "net" ? "h-0.5 w-3" : "size-2.5 rounded-xs"}
              style={{ background: config[k].color }}
            />
            {config[k].label}
          </li>
        ))}
        {losing.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-xs bg-destructive/15" />
            Net loss month
          </li>
        )}
      </ul>
    </div>
  );
}
