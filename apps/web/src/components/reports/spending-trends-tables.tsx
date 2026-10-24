import { type CurrencyCode, comparedToAverage, money } from "@strictbudget/engine";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@strictbudget/ui/components/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@strictbudget/ui/components/tooltip";
import { cn } from "@strictbudget/ui/lib/utils";
import { Info } from "lucide-react";
import { useBudget } from "@/lib/budget-context";
import { monthLabel } from "@/lib/reports";
import { DifferenceText, type TrendChartData } from "./spending-trends-charts";

export const COMPARED_TO_AVERAGE_HINT =
  "This column highlights the difference between your spending in individual months and your average monthly spending for the selected time period.";

function useFormat() {
  const { budget, formatAmount } = useBudget();
  return (v: bigint) => formatAmount(money(v, budget.currency as CurrencyCode));
}

/** Every month of the range, newest first, compared with the average. */
export function TrendMonthsTable({ data }: { data: TrendChartData }) {
  const format = useFormat();
  const comparison = data.comparison;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Total Spending</TableHead>
          <TableHead className="text-right">
            <span className="inline-flex items-center gap-1">
              Compared to Average
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About Compared to Average"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Info className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{COMPARED_TO_AVERAGE_HINT}</TooltipContent>
              </Tooltip>
            </span>
          </TableHead>
          {comparison && <TableHead className="text-right">{comparison.label}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...data.months].reverse().map((m) => {
          const vsAverage = comparedToAverage(m.total, data.average);
          const other =
            comparison?.kind === "period" ? comparison.totals.get(m.month) : comparison?.average;
          return (
            <TableRow key={m.month}>
              <TableCell className="font-medium">
                {monthLabel(m.month, "long")}
                {m.total > data.average && <span className="sr-only"> (above average)</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{format(m.total)}</TableCell>
              <TableCell
                className={cn(
                  "text-right",
                  vsAverage.difference > 0n && "text-foreground",
                  vsAverage.difference <= 0n && "text-muted-foreground",
                )}
              >
                <DifferenceText {...vsAverage} format={format} />
              </TableCell>
              {comparison && (
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {other === undefined ? "–" : format(other)}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function TrendSeriesTable({
  data,
  onPick,
}: {
  data: TrendChartData;
  onPick?: (key: string) => void;
}) {
  const format = useFormat();
  const spent = (key: string, m: (typeof data.months)[number]) => -(m.nets.get(key) ?? 0n);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 bg-background">Name</TableHead>
          {data.months.map((m) => (
            <TableHead key={m.month} className="text-right">
              {monthLabel(m.month)}
            </TableHead>
          ))}
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.keys.map((key) => {
          const info = data.info(key);
          const total = data.months.reduce((s, m) => s + spent(key, m), 0n);
          return (
            <TableRow key={key}>
              <TableCell className="sticky left-0 bg-background font-medium">
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ background: info.color }}
                  />
                  {onPick ? (
                    <button type="button" className="hover:underline" onClick={() => onPick(key)}>
                      {info.label}
                    </button>
                  ) : (
                    info.label
                  )}
                </span>
              </TableCell>
              {data.months.map((m) => (
                <TableCell key={m.month} className="text-right tabular-nums">
                  {format(spent(key, m))}
                </TableCell>
              ))}
              <TableCell className="text-right font-medium tabular-nums">{format(total)}</TableCell>
            </TableRow>
          );
        })}
        <TableRow>
          <TableCell className="sticky left-0 bg-background font-semibold">
            Total Spending
          </TableCell>
          {data.months.map((m) => (
            <TableCell key={m.month} className="text-right font-semibold tabular-nums">
              {format(m.total)}
            </TableCell>
          ))}
          <TableCell className="text-right font-semibold tabular-nums">
            {format(data.months.reduce((s, m) => s + m.total, 0n))}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
