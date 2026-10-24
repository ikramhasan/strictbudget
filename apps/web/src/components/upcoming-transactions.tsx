import { Button } from "@strictbudget/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { cn } from "@strictbudget/ui/lib/utils";
import { useState } from "react";
import type { BudgetMonthData } from "@/lib/months";

type Upcoming = NonNullable<BudgetMonthData["categories"][number]["upcoming"]>;

export interface UpcomingItem {
  scheduleId: string;
  accountId: string;
  accountName: string;
  date: string;
  payeeName: string | null;
  memo: string;
  amount: string;
}

export const upcomingLabel = (count: number) =>
  `${count} Upcoming Transaction${count === 1 ? "" : "s"}`;

/** "Available After Upcoming" is yellow when it's negative. */
export function UpcomingTransactions({
  name,
  available,
  upcoming,
  format,
  formatDate,
  onOpen,
}: {
  name: string;
  available: bigint;
  upcoming: Upcoming;
  format: (minorUnits: string) => string;
  formatDate: (isoDate: string) => string;
  onOpen: (accountId: string, scheduleId: string) => void;
}) {
  const after = available + BigInt(upcoming.amount);
  return (
    <dl
      className={cn(
        "grid gap-1 rounded-md p-2 text-sm",
        after < 0n && "bg-yellow-100 text-yellow-950 dark:bg-yellow-900/40 dark:text-yellow-50",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <dt>
          <UpcomingActivity
            label={upcomingLabel(upcoming.transactions.length)}
            name={name}
            transactions={upcoming.transactions}
            format={format}
            formatDate={formatDate}
            onOpen={(t) => onOpen(t.accountId, t.scheduleId)}
          />
        </dt>
        <dd className="tabular-nums">{format(upcoming.amount)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <dt>Available After Upcoming</dt>
        <dd className="tabular-nums">{format(after.toString())}</dd>
      </div>
    </dl>
  );
}

/** Used under a category's Available and on a loan's Payments row. */
export function UpcomingActivity<T extends UpcomingItem>({
  label,
  name,
  transactions,
  format,
  formatDate,
  onOpen,
  align = "end",
  className,
}: {
  label: string;
  /** Shown under "Activity" (a category's name). */
  name?: string;
  transactions: readonly T[];
  format: (minorUnits: string) => string;
  formatDate: (isoDate: string) => string;
  onOpen: (item: T) => void;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[34rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b px-4 py-3">
          <p className="font-semibold text-sm">Activity</p>
          {name && <p className="text-muted-foreground text-sm">{name}</p>}
        </div>
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Account</th>
                <th className="px-2 py-2 text-left font-medium">Date</th>
                <th className="px-2 py-2 text-left font-medium">Payee</th>
                <th className="px-2 py-2 text-left font-medium">Memo</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const openSchedule = () => {
                  setOpen(false);
                  onOpen(t);
                };
                return (
                  <tr
                    key={`${t.scheduleId}:${t.date}`}
                    className="cursor-pointer border-t hover:bg-muted/60"
                    onClick={openSchedule}
                  >
                    <td className="max-w-28 truncate px-4 py-1.5">
                      <button
                        type="button"
                        className="max-w-full truncate focus-visible:underline focus-visible:outline-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSchedule();
                        }}
                      >
                        {t.accountName}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{formatDate(t.date)}</td>
                    <td className="max-w-32 truncate px-2 py-1.5">{t.payeeName}</td>
                    <td className="max-w-32 truncate px-2 py-1.5 text-muted-foreground">
                      {t.memo}
                    </td>
                    <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums">
                      {format(t.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end border-t px-4 py-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
