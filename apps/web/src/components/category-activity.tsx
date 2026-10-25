import { money } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { cn } from "@strictbudget/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { $api } from "@/lib/api";
import { useOptionalBudget } from "@/lib/budget-context";
import { todayIso } from "@/lib/dates";

/** A payment category's card figures for the month (minor units). */
export interface CardSummary {
  spendingAndOutflows: string;
  paymentsAndInflows: string;
  fundedSpending: string;
  paymentsMade: string;
}

export type ActivityTarget = { categoryId: string } | { groupId: string } | { uncategorized: true };

/**
 * An Activity amount that opens the Activity popover: the month's transactions behind it.
 * Clicking one opens its account's register on that transaction.
 */
export function ActivityButton({
  budgetId,
  month,
  target,
  name,
  amount,
  format,
  formatDate,
  className,
  card,
}: {
  budgetId: string;
  month: string;
  target: ActivityTarget;
  name: string;
  amount: string;
  format: (minorUnits: string) => string;
  formatDate: (isoDate: string) => string;
  className?: string;
  card?: CardSummary;
}) {
  const [open, setOpen] = useState(false);
  // No button when there's no activity.
  if (amount === "0") return <span className={className}>{format(amount)}</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Activity of ${name}: ${format(amount)}`}
          className={cn(
            "max-w-full truncate rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {format(amount)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[34rem] max-w-[calc(100vw-2rem)] p-0">
        {open && (
          <ActivityList
            budgetId={budgetId}
            month={month}
            target={target}
            name={name}
            format={format}
            formatDate={formatDate}
            onClose={() => setOpen(false)}
            card={card}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ActivityList({
  budgetId,
  month,
  target,
  name,
  format,
  formatDate,
  onClose,
  card,
}: {
  budgetId: string;
  month: string;
  target: ActivityTarget;
  name: string;
  format: (minorUnits: string) => string;
  formatDate: (isoDate: string) => string;
  onClose: () => void;
  card?: CardSummary;
}) {
  const navigate = useNavigate();
  const budget = useOptionalBudget();
  // A foreign account's line shows what it was in the account's currency under the budget's.
  const native = (t: { currency: string; nativeAmount: string }) =>
    budget && t.currency !== budget.budget.currency
      ? budget.formatAmount(
          money(BigInt(t.nativeAmount), t.currency as typeof budget.budget.currency),
        )
      : null;
  const query = {
    today: todayIso(),
    ...("categoryId" in target ? { categoryId: target.categoryId } : {}),
    ...("groupId" in target ? { groupId: target.groupId } : {}),
    ...("uncategorized" in target ? { uncategorized: "true" as const } : {}),
  };
  const openTransaction = (t: { accountId: string; transactionId: string }) => {
    onClose();
    void navigate({
      to: "/budgets/$budgetId/accounts/$accountId",
      params: { budgetId, accountId: t.accountId },
      search: { transaction: t.transactionId },
    });
  };
  const activity = $api.useQuery("get", "/v1/budgets/{budgetId}/months/{month}/activity", {
    params: { path: { budgetId, month }, query },
  });

  return (
    <div className="grid">
      <div className="border-b px-4 py-3">
        <p className="font-semibold text-sm">Activity</p>
        <p className="text-muted-foreground text-sm">{name}</p>
      </div>
      {card && <CardActivitySummary card={card} format={format} />}
      <div className="max-h-80 overflow-y-auto">
        {activity.isPending ? (
          <Skeleton className="m-4 h-16" />
        ) : activity.isError ? (
          <p className="p-4 text-muted-foreground text-sm">Couldn't load the transactions.</p>
        ) : (
          <table className={cn("w-full text-sm", card && "table-fixed")}>
            {card && (
              // Five columns in the popover's width: the long ones truncate.
              <colgroup>
                <col className="w-[7.5rem]" />
                <col className="w-[6.5rem]" />
                <col className="w-[9rem]" />
                <col />
                <col className="w-[6rem]" />
              </colgroup>
            )}
            <thead className="text-muted-foreground text-xs uppercase tracking-wide">
              <tr>
                {/* A card's window lists its own transactions, so it shows their categories
                    instead of the account. */}
                {!card && <th className="px-4 py-2 text-left font-medium">Account</th>}
                <th className={cn("py-2 text-left font-medium", card ? "px-4" : "px-2")}>Date</th>
                <th className="px-2 py-2 text-left font-medium">Payee</th>
                {card && <th className="px-2 py-2 text-left font-medium">Category</th>}
                <th className="px-2 py-2 text-left font-medium">Memo</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {activity.data.transactions.map((t) => {
                // The row is clickable; this button is the keyboard way in.
                const open = (label: string) => (
                  <button
                    type="button"
                    className="max-w-full truncate focus-visible:underline focus-visible:outline-none"
                    onClick={(e) => {
                      e.stopPropagation();
                      openTransaction(t);
                    }}
                  >
                    {label}
                  </button>
                );
                return (
                  <tr
                    key={t.id}
                    className="cursor-pointer border-t hover:bg-muted/60"
                    onClick={() => openTransaction(t)}
                  >
                    {!card && (
                      <td className="max-w-28 truncate px-4 py-1.5">{open(t.accountName)}</td>
                    )}
                    <td className={cn("whitespace-nowrap py-1.5", card ? "px-4" : "px-2")}>
                      {card ? open(formatDate(t.date)) : formatDate(t.date)}
                    </td>
                    <td className="max-w-32 truncate px-2 py-1.5">{t.payeeName}</td>
                    {card && (
                      <td className="truncate px-2 py-1.5" title={t.categoryName ?? ""}>
                        {t.categoryName}
                      </td>
                    )}
                    <td className="max-w-32 truncate px-2 py-1.5 text-muted-foreground">
                      {t.memo}
                    </td>
                    <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums">
                      {format(t.amount)}
                      {native(t) && (
                        <span className="block text-muted-foreground text-xs">{native(t)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex justify-end border-t px-4 py-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

/**
 * The numbers of a card's Activity window. Spending is the card's outflows; Returns its
 * inflows other than payments (returns and statement credits). Funded Spending is what moved into
 * the payment category; returns that moved money back out are listed with Payments & Returns, so
 * a month whose returns outweigh its funded spending shows them there instead.
 */
export function cardActivity(card: CardSummary) {
  const spending = BigInt(card.spendingAndOutflows);
  const payments = BigInt(card.paymentsMade);
  const returns = BigInt(card.paymentsAndInflows) + payments;
  const net = BigInt(card.fundedSpending);
  const funded = net > 0n ? net : 0n;
  return { spending, returns, funded, paymentsAndReturns: payments + (net < 0n ? net : 0n) };
}

/**
 * A card's Activity window header: Total Spending (the card's outflows and inflows other than
 * payments) beside Total Activity (Funded Spending and Payments & Returns, what moved in and out
 * of the payment category).
 */
function CardActivitySummary({
  card,
  format,
}: {
  card: CardSummary;
  format: (minorUnits: string) => string;
}) {
  const c = cardActivity(card);
  const row = (label: string, value: bigint, strong = false) => (
    <div className={cn("flex justify-between gap-4", strong && "border-t pt-1 font-medium")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{format(value.toString())}</dd>
    </div>
  );
  return (
    <dl className="grid grid-cols-2 gap-6 border-b px-4 py-3 text-sm">
      <div className="grid gap-1">
        {row("Spending", c.spending)}
        {row("Returns", c.returns)}
        {row("Total Spending", c.spending + c.returns, true)}
      </div>
      <div className="grid gap-1">
        {row("Funded Spending", c.funded)}
        {row("Payments & Returns", c.paymentsAndReturns)}
        {row("Total Activity", c.funded + c.paymentsAndReturns, true)}
      </div>
    </dl>
  );
}
