import { type CurrencyCode, money } from "@strictbudget/engine";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@strictbudget/ui/components/table";
import { cn } from "@strictbudget/ui/lib/utils";
import { useBudget } from "@/lib/budget-context";
import { chartNumber } from "@/lib/reports";
import { type Breakdown, type BreakdownRow, rowChange, shares } from "@/lib/spending-breakdown";

/** A change as "+$15.00 (+50%)", or "−$5.00 (−10%)"; "new" when nothing was spent before. */
function useChangeLabel() {
  const { budget, formatAmount } = useBudget();
  return (row: BreakdownRow, previous: Map<string, bigint>) => {
    const change = rowChange(row, previous);
    const amount = formatAmount(
      money(change.amount < 0n ? -change.amount : change.amount, budget.currency),
    );
    const sign = change.amount > 0n ? "+" : change.amount < 0n ? "−" : "";
    const percent =
      change.percent === null ? "" : ` (${sign}${Math.abs(Math.round(change.percent))}%)`;
    return { ...change, label: `${sign}${amount}${percent}` };
  };
}

/** Shares are of the gross outflows and of income; positive inflow categories follow with their total. */
export function SpendingBreakdownList({
  breakdown,
  income,
  previous,
  positiveTitle,
  onSelect,
}: {
  breakdown: Breakdown;
  income: bigint | undefined;
  previous: Map<string, bigint> | undefined;
  positiveTitle: string;
  onSelect: (row: BreakdownRow) => void;
}) {
  const { budget, formatAmount } = useBudget();
  const currency = budget.currency as CurrencyCode;
  const changeLabel = useChangeLabel();
  const format = (a: bigint) => formatAmount(money(a, currency));
  // Bar widths only: the largest of this period's and the comparison's spending fills the row.
  const max = Math.max(
    1e-9,
    ...breakdown.spending.map((r) => chartNumber(-r.net, currency)),
    ...[...(previous?.values() ?? [])].map((v) => chartNumber(v, currency)),
  );
  const width = (a: bigint) => `${Math.max(0, (chartNumber(a, currency) / max) * 100)}%`;
  return (
    <div className="grid gap-4">
      <ul className="grid gap-1">
        {breakdown.spending.map((row) => {
          const share = shares(row, breakdown, income);
          const change = previous ? changeLabel(row, previous) : undefined;
          return (
            <li key={row.key}>
              <button
                type="button"
                onClick={() => onSelect(row)}
                className="grid w-full gap-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                  <span className="font-medium tabular-nums">{format(-row.net)}</span>
                </span>
                <span className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                  {change && (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 rounded-full border border-foreground/30 border-dashed"
                      style={{ width: width(change.before) }}
                    />
                  )}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: width(-row.net), background: row.color }}
                  />
                </span>
                <span className="flex flex-wrap gap-x-3 text-muted-foreground text-xs tabular-nums">
                  {share.ofTotal && <span>{share.ofTotal} of spending</span>}
                  {share.ofIncome && <span>{share.ofIncome} of income</span>}
                  {change && (
                    <span
                      className={cn(
                        "ml-auto",
                        change.amount > 0n && "text-destructive",
                        change.amount < 0n && "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {change.label}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {breakdown.positive.length > 0 && (
        <section aria-label={positiveTitle} className="grid gap-1 border-t pt-3">
          <h3 className="flex items-baseline justify-between px-2 font-medium text-sm">
            {positiveTitle}
            <span className="tabular-nums">+{format(breakdown.positiveInflows)}</span>
          </h3>
          <ul className="grid">
            {breakdown.positive.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => onSelect(row)}
                  className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span className="tabular-nums">+{format(row.net)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function SpendingBreakdownTable({
  breakdown,
  income,
  previous,
  rowTitle,
  positiveTitle,
  onSelect,
}: {
  breakdown: Breakdown;
  income: bigint | undefined;
  previous: Map<string, bigint> | undefined;
  rowTitle: string;
  positiveTitle: string;
  onSelect: (row: BreakdownRow) => void;
}) {
  const { budget, formatAmount } = useBudget();
  const changeLabel = useChangeLabel();
  const format = (a: bigint) => formatAmount(money(a, budget.currency));
  const line = (row: BreakdownRow, positive: boolean) => {
    const share = shares(row, breakdown, income);
    const change = previous ? changeLabel(row, previous) : undefined;
    return (
      <TableRow key={row.key}>
        <TableCell>
          <button type="button" className="text-left hover:underline" onClick={() => onSelect(row)}>
            {row.name}
          </button>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {positive ? `+${format(row.net)}` : format(-row.net)}
        </TableCell>
        <TableCell className="text-right tabular-nums">{positive ? "" : share.ofTotal}</TableCell>
        {income !== undefined && (
          <TableCell className="text-right tabular-nums">
            {positive ? "" : share.ofIncome}
          </TableCell>
        )}
        {change && (
          <>
            <TableCell className="text-right tabular-nums">{format(change.before)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {positive ? "" : change.label}
            </TableCell>
          </>
        )}
      </TableRow>
    );
  };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{rowTitle}</TableHead>
          <TableHead className="text-right">Total Spending</TableHead>
          <TableHead className="text-right">% of spending</TableHead>
          {income !== undefined && <TableHead className="text-right">% of income</TableHead>}
          {previous && (
            <>
              <TableHead className="text-right">Compared with</TableHead>
              <TableHead className="text-right">Change</TableHead>
            </>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {breakdown.spending.map((r) => line(r, false))}
        <TableRow className="font-medium">
          <TableCell>Total Spending</TableCell>
          <TableCell className="text-right tabular-nums">{format(breakdown.total)}</TableCell>
          <TableCell colSpan={1 + (income !== undefined ? 1 : 0) + (previous ? 2 : 0)} />
        </TableRow>
        {breakdown.positive.length > 0 && (
          <>
            <TableRow>
              <TableCell className="font-medium">{positiveTitle}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                +{format(breakdown.positiveInflows)}
              </TableCell>
              <TableCell colSpan={1 + (income !== undefined ? 1 : 0) + (previous ? 2 : 0)} />
            </TableRow>
            {breakdown.positive.map((r) => line(r, true))}
          </>
        )}
      </TableBody>
    </Table>
  );
}
