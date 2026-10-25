import type { CurrencyCode } from "@strictbudget/engine";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@strictbudget/ui/components/table";
import { cn } from "@strictbudget/ui/lib/utils";
import { ArrowDown, ArrowUp, Info, Star } from "lucide-react";
import { headline, monthRows, type NetWorthReport } from "@/lib/net-worth";
import { monthLabel } from "@/lib/reports";
import { useAmountFormat } from "./format";

/** A change with its arrow and percent ("↓ −$15,966.74 (−5.2%)"). */
export function Change({
  amount,
  percent,
  format,
  showAmount = true,
  className,
}: {
  amount: bigint;
  percent: string | null;
  format: ReturnType<typeof useAmountFormat>;
  showAmount?: boolean;
  className?: string;
}) {
  const Arrow = amount < 0n ? ArrowDown : ArrowUp;
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-1 tabular-nums",
        amount < 0n
          ? "text-destructive"
          : amount > 0n
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-muted-foreground",
        className,
      )}
    >
      {/* The arrow stays with its amount; only the percentage may wrap. */}
      <span className="inline-flex items-center gap-x-1 whitespace-nowrap">
        {amount !== 0n && <Arrow aria-hidden className="size-3.5" />}
        {showAmount ? format.exact(amount) : format.masked}
      </span>
      {percent !== null && <span>({percent})</span>}
    </span>
  );
}

/** Change in Net Worth is the last month less the first in the range. */
export function NetWorthHeadline({
  report,
  showAmounts = true,
  compact = false,
  className,
}: {
  report: Pick<NetWorthReport, "opening" | "months" | "currency">;
  showAmounts?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const format = useAmountFormat(report.currency as CurrencyCode);
  const h = headline(report);
  if (!h) return null;
  const amount = (v: bigint) => (showAmounts ? format.exact(v) : format.masked);
  return (
    <div className={cn("grid content-start gap-3", className)}>
      <div>
        <p className="text-muted-foreground text-xs">Net Worth</p>
        <p
          className={cn(
            "font-semibold tabular-nums tracking-tight",
            compact ? "text-xl" : "text-3xl",
          )}
        >
          {amount(h.netWorth)}
        </p>
      </div>
      <dl
        className={cn(
          "gap-x-6 gap-y-2",
          // Compact (the share picture): the figures side by side, wrapping on a narrow card.
          compact ? "flex flex-wrap" : "grid grid-cols-2 sm:flex",
        )}
      >
        <div>
          <dt className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <span aria-hidden className="size-2 rounded-xs bg-(--report-1)" />
            Assets
          </dt>
          <dd className="tabular-nums">{amount(h.assets)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <span aria-hidden className="size-2 rounded-xs bg-(--report-4)" />
            Debts
          </dt>
          <dd className="tabular-nums">{amount(h.debts)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Change in Net Worth</dt>
          <dd>
            <Change
              amount={h.rangeChange}
              percent={h.rangePercent}
              format={format}
              showAmount={showAmounts}
            />
          </dd>
        </div>
        {!compact && (
          <div>
            <dt className="text-muted-foreground text-xs">This month</dt>
            <dd>
              <Change amount={h.monthChange} percent={h.monthPercent} format={format} />
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function NetWorthMonthTable({
  report,
}: {
  report: Pick<NetWorthReport, "opening" | "months" | "currency">;
}) {
  const format = useAmountFormat(report.currency as CurrencyCode);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Net Worth</TableHead>
          <TableHead className="text-right">
            <span
              className="inline-flex items-center gap-1"
              title="This column highlights how much your net worth has changed month over month."
            >
              Monthly Change
              <Info aria-hidden className="size-3.5" />
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {monthRows(report).map((r) => (
          <TableRow key={r.month}>
            <TableCell>
              <span className="inline-flex items-center gap-1.5">
                {monthLabel(r.month, "long")}
                {r.allTimeHigh && (
                  <Star
                    className="size-3.5 fill-(--report-7) text-foreground"
                    aria-label="New all-time high"
                  />
                )}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{format.exact(r.netWorth)}</TableCell>
            <TableCell className="text-right">
              <Change amount={r.change} percent={r.changePercent} format={format} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
