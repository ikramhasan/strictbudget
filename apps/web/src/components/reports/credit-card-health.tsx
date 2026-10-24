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
import { Link } from "@tanstack/react-router";
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { useBudget } from "@/lib/budget-context";
import {
  COVERAGE_HELP,
  COVERAGE_LABELS,
  COVERAGE_TONES,
  type CreditCardHealth,
  type HealthCard,
} from "@/lib/credit-card-health";
import { chartNumber, chartTick, monthLabel } from "@/lib/reports";

const config = {
  spending: { label: "Spending", color: "var(--report-6)" },
  payments: { label: "Payments and returns", color: "var(--report-1)" },
  balance: { label: "Balance owed", color: "var(--foreground)" },
} satisfies ChartConfig;

/** The card's months as a chart: spending and payments as bars, the balance owed as a line. */
export function CardChart({ card }: { card: HealthCard }) {
  const { budget, formatAmount } = useBudget();
  const spec = NUMBER_FORMAT_SPECS[budget.numberFormat];
  const exact = (amount: string) => formatAmount(money(BigInt(amount), budget.currency));
  const data = card.series.map((s) => ({
    month: s.month,
    spending: chartNumber(s.spending, budget.currency),
    payments: chartNumber(s.payments, budget.currency),
    balance: chartNumber(s.balance, budget.currency),
    exact: s,
  }));
  return (
    <ChartContainer config={config} className="h-56 w-full" role="img">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          tickFormatter={(m: string) => monthLabel(m as BudgetMonth, "axis")}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(v: number) =>
            chartTick(
              v,
              budget.currency,
              (n) => formatAmount(money(n, budget.currency)),
              spec.decimal,
            )
          }
          tickLine={false}
          axisLine={false}
          width={80}
        />
        <Tooltip
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
            if (!active || !point) return null;
            return (
              <div className="grid gap-0.5 rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                <span className="text-muted-foreground">
                  {monthLabel(point.month as BudgetMonth, "long")}
                </span>
                <span className="tabular-nums">Spending: {exact(point.exact.spending)}</span>
                <span className="tabular-nums">
                  Payments and returns: {exact(point.exact.payments)}
                </span>
                <span className="font-medium tabular-nums">
                  Balance owed: {exact(point.exact.balance)}
                </span>
              </div>
            );
          }}
        />
        <Bar dataKey="spending" fill="var(--color-spending)" radius={2} isAnimationActive={false} />
        <Bar dataKey="payments" fill="var(--color-payments)" radius={2} isAnimationActive={false} />
        <Line
          dataKey="balance"
          type="linear"
          stroke="var(--color-balance)"
          strokeWidth={2}
          dot
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

/** The card's chart as a table, a row per month. */
export function CardTable({ card }: { card: HealthCard }) {
  const { budget, formatAmount } = useBudget();
  const exact = (amount: string) => formatAmount(money(BigInt(amount), budget.currency));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Spending</TableHead>
          <TableHead className="text-right">Payments and returns</TableHead>
          <TableHead className="text-right">Balance owed</TableHead>
          <TableHead className="text-right">Set aside</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {card.series.map((s) => (
          <TableRow key={s.month}>
            <TableCell>{monthLabel(s.month as BudgetMonth, "long")}</TableCell>
            <TableCell className="text-right tabular-nums">{exact(s.spending)}</TableCell>
            <TableCell className="text-right tabular-nums">{exact(s.payments)}</TableCell>
            <TableCell className="text-right tabular-nums">{exact(s.balance)}</TableCell>
            <TableCell className="text-right tabular-nums">{exact(s.available)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A card's balance next to what its payment category has set aside, and where the gap came from. */
export function CardSummary({
  card,
  month,
  budgetId,
  format,
  readOnly,
}: {
  card: HealthCard;
  month: BudgetMonth;
  budgetId: string;
  format: (amount: string) => string;
  readOnly: boolean;
}) {
  const gap = BigInt(card.gap);
  const cover = BigInt(card.cover);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">{card.name}</h3>
        <span className={cn("font-medium text-sm", COVERAGE_TONES[card.status])}>
          {COVERAGE_LABELS[card.status]}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Figure label="Owed" value={format(card.balance)} />
        <Figure label="Set aside" value={format(card.covered)} />
        <Figure label="Still to set aside" value={format(card.gap)} />
        {gap > 0n && (
          <Figure
            label="From this month's overspending"
            value={format(card.fromCreditOverspending)}
          />
        )}
      </dl>
      <p className="text-muted-foreground text-sm">{COVERAGE_HELP[card.status]}</p>
      {gap > 0n && cover > 0n && !readOnly && (
        <Link
          to="/budgets/$budgetId"
          params={{ budgetId }}
          search={{ month, category: card.categoryId, assign: true }}
          className="w-fit text-primary text-sm underline-offset-4 hover:underline"
        >
          Assign {format(card.cover)} to cover
        </Link>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** What the cards lacked at each month's end: debt carried on money still to come. */
export function FloatTable({ float }: { float: CreditCardHealth["float"] }) {
  const { budget, formatAmount } = useBudget();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month end</TableHead>
          <TableHead className="text-right">Carried on the float</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {float.map((f) => (
          <TableRow key={f.month}>
            <TableCell>{monthLabel(f.month as BudgetMonth, "long")}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatAmount(money(BigInt(f.carried), budget.currency))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
