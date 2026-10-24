import { addMonths, type CurrencyCode } from "@strictbudget/engine";
import { type ChartConfig, ChartContainer } from "@strictbudget/ui/components/chart";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@strictbudget/ui/components/collapsible";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { accountHistory, netWorthOptions } from "@/lib/net-worth";
import { chartNumber, currentMonth, monthLabel } from "@/lib/reports";
import { useAmountFormat } from "./reports/net-worth/format";

const STORAGE_KEY = "strictbudget:balance-history-open";
const MONTHS = 24;

const config = { balance: { label: "Balance", color: "var(--report-1)" } } satisfies ChartConfig;

function storedOpen() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The register's "Balance over time": the account's month-end working balance over the last two
 * years (from its first month), from the net worth report's balance history, in the account's own
 * currency. Collapsed until opened; the choice is kept.
 */
export function BalanceHistory({
  budgetId,
  accountId,
  currency,
}: {
  budgetId: string;
  accountId: string;
  currency: CurrencyCode;
}) {
  const [open, setOpen] = useState(storedOpen);
  const current = currentMonth();
  const query = useQuery({
    ...netWorthOptions({
      budgetId,
      range: { from: addMonths(current, -(MONTHS - 1)), to: current },
      accounts: accountId,
    }),
    enabled: open,
  });
  const format = useAmountFormat(currency);
  const history = query.data ? accountHistory(query.data, accountId) : [];
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Storage can be unavailable (private windows); the chart still opens.
    }
  };
  const byMonth = new Map(history.map((h) => [h.month, h.balance]));

  return (
    <Collapsible open={open} onOpenChange={toggle} className="overflow-hidden rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2 text-left font-medium text-sm transition-colors duration-150 hover:bg-muted/50">
        <ChevronRight
          aria-hidden
          className="size-4 transition-transform data-[open]:rotate-90"
          data-open={open || undefined}
        />
        Balance over time
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">
        {query.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : history.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-sm">No balance history yet.</p>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-48 w-full">
            <AreaChart
              data={history.map((h) => ({
                month: h.month,
                balance: chartNumber(h.balance, currency),
              }))}
              margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                tickFormatter={(m: string) => monthLabel(m, "axis")}
                tickLine={false}
                axisLine={false}
                minTickGap={8}
              />
              <YAxis tickFormatter={format.tick} tickLine={false} axisLine={false} width={72} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Tooltip
                content={({ active, label }) => {
                  const balance = typeof label === "string" ? byMonth.get(label) : undefined;
                  if (!active || balance === undefined || typeof label !== "string") return null;
                  return (
                    <div className="grid gap-0.5 rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                      <span className="font-medium">End of {monthLabel(label, "long")}</span>
                      <span className="tabular-nums">{format.exact(balance)}</span>
                    </div>
                  );
                }}
              />
              <Area
                dataKey="balance"
                type="linear"
                stroke="var(--color-balance)"
                fill="var(--color-balance)"
                fillOpacity={0.15}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
