import { isOnBudget } from "@strictbudget/engine";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@strictbudget/ui/components/alert-dialog";
import { Button } from "@strictbudget/ui/components/button";
import { cn } from "@strictbudget/ui/lib/utils";
import { useState } from "react";
import type { Account } from "@/lib/accounts";
import { rateLabel } from "@/lib/fx-rates";

/** "+$12.34" for a gain, "−$12.34" (the format's minus) for a loss. */
export function signedAmount(amount: bigint, format: (minorUnits: bigint) => string) {
  return amount > 0n ? `+${format(amount)}` : format(amount);
}

/**
 * At today's known rate; Revalue posts the difference to Ready to Assign. Nothing when the account
 * is in the budget's currency or no rate is known yet.
 */
export function UnrealizedGain({
  account,
  budgetCurrency,
  format,
  pending,
  onRevalue,
}: {
  account: Pick<Account, "currency" | "closed" | "type" | "unrealizedGain" | "rate">;
  budgetCurrency: string;
  format: (minorUnits: bigint) => string;
  pending: boolean;
  onRevalue: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (account.unrealizedGain === null || account.rate === null) return null;
  const gain = BigInt(account.unrealizedGain);
  const onBudget = isOnBudget(account.type);
  return (
    <div className="grid">
      <dt className="text-muted-foreground text-xs">Unrealized gain/loss</dt>
      <dd className="flex flex-wrap items-center gap-x-2 text-base">
        <span className={cn(gain < 0n && "text-destructive")}>{signedAmount(gain, format)}</span>
        <span className="text-muted-foreground text-xs">
          (at {rateLabel(account.currency, account.rate, budgetCurrency)})
        </span>
        {!account.closed && (
          <Button
            variant="outline"
            size="xs"
            disabled={pending}
            onClick={() => setConfirming(true)}
          >
            Revalue
          </Button>
        )}
      </dd>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revalue account</AlertDialogTitle>
            <AlertDialogDescription>
              {onBudget
                ? `This adds an FX Revaluation dated today for the difference between what this account is worth at today's rate and what its transactions were booked at (now ${signedAmount(gain, format)}). The difference goes to Ready to Assign.`
                : `This adds an FX Revaluation dated today for the difference between what this account is worth at today's rate and what its transactions were booked at (now ${signedAmount(gain, format)}). It's a tracking account, so your plan doesn't change.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirming(false);
                await onRevalue();
              }}
            >
              Revalue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
