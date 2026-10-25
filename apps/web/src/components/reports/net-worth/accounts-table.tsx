import { ACCOUNT_TYPE_LABELS, type CurrencyCode, money } from "@strictbudget/engine";
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
import { Line, LineChart, YAxis } from "recharts";
import { useBudget } from "@/lib/budget-context";
import { type NetWorthReport, percentLabel, shownAccounts } from "@/lib/net-worth";
import { chartNumber } from "@/lib/reports";
import { useAmountFormat } from "./format";

/** A balance line in a table cell (positions only; the cells beside it carry the amounts). */
function Sparkline({ values, negative }: { values: number[]; negative: boolean }) {
  return (
    <LineChart
      width={96}
      height={28}
      data={values.map((v, i) => ({ i, v }))}
      margin={{ top: 3, right: 2, bottom: 3, left: 2 }}
      aria-hidden
    >
      <YAxis hide domain={["dataMin", "dataMax"]} />
      <Line
        dataKey="v"
        type="linear"
        dot={false}
        stroke={negative ? "var(--report-4)" : "var(--report-1)"}
        strokeWidth={2}
        isAnimationActive={false}
      />
    </LineChart>
  );
}

/** Every account with a balance in the range; a foreign account also shows its own currency. */
export function NetWorthAccountsTable({
  report,
}: {
  report: Pick<NetWorthReport, "accounts" | "currency" | "months">;
}) {
  const { budget, formatAmount } = useBudget();
  const currency = report.currency as CurrencyCode;
  const format = useAmountFormat(currency);
  const accounts = shownAccounts(report);
  if (accounts.length === 0) return null;
  return (
    <section aria-label="Accounts" className="grid gap-3 rounded-lg border p-4">
      <h2 className="font-semibold">Accounts</h2>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead className="hidden sm:table-cell">Over the range</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => {
              const first = a.balances[0]?.base ?? null;
              const last = a.balances.at(-1);
              const lastBase = last?.base ?? null;
              const change =
                first !== null && lastBase !== null ? BigInt(lastBase) - BigInt(first) : null;
              const values = a.balances.map((b) =>
                chartNumber(b.native, a.currency as CurrencyCode),
              );
              return (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link
                      to="/budgets/$budgetId/accounts/$accountId"
                      params={{ budgetId: budget.id, accountId: a.id }}
                      className="font-medium hover:underline"
                    >
                      {a.name}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {ACCOUNT_TYPE_LABELS[a.type]}
                      {a.closed ? " · closed" : ""}
                    </p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Sparkline values={values} negative={BigInt(last?.native ?? "0") < 0n} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {lastBase === null ? "No rate" : format.exact(lastBase)}
                    {a.currency !== currency && last && (
                      <p className="text-muted-foreground text-xs">
                        {formatAmount(money(BigInt(last.native), a.currency as CurrencyCode))}
                      </p>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      change !== null && change < 0n && "text-destructive",
                    )}
                  >
                    {change === null ? "—" : format.exact(change)}
                    {change !== null && first !== null && (
                      <p className="text-muted-foreground text-xs">
                        {percentLabel(change, BigInt(first)) ?? ""}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
