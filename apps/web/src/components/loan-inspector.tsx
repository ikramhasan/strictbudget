import { paidOffSavings } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { type Account, accountsQueryOptions } from "@/lib/accounts";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { apiErrorMessage } from "@/lib/budgets";
import { todayIso } from "@/lib/dates";
import { progressMessage } from "@/lib/loan-planner";
import { dayLabel } from "@/lib/loans";
import { RecordPaymentDialog } from "./loan-dialogs";
import { useLoanPlan, useLoanRefresh } from "./loan-page";
import { MessageLine } from "./loan-progress";
import { AvailableButton, type MoveActions } from "./move-money";
import { PayoffSimulator } from "./payoff-simulator";

export function usePairedLoan(categoryId: string | undefined): Account | undefined {
  const { budget } = useBudget();
  const accounts = useQuery(accountsQueryOptions(budget.id));
  return categoryId
    ? accounts.data?.accounts.find((a) => a.pairedCategoryId === categoryId)
    : undefined;
}

export function PairedLoanSection({
  loan,
  categoryId,
  categoryName,
  available,
  move,
}: {
  loan: Account;
  categoryId: string;
  categoryName: string;
  /** The category's Available this month, minor units. */
  available: string;
  move?: MoveActions;
}) {
  const { budget, formatAmount } = useBudget();
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const refresh = useLoanRefresh(budget.id);
  const record = $api.useMutation(
    "post",
    "/v1/budgets/{budgetId}/accounts/{accountId}/loan/payments",
  );
  const [paying, setPaying] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const plan = useLoanPlan(loan);
  const format = (minorUnits: bigint) =>
    formatAmount({ amount: minorUnits, currency: budget.currency });
  const amount = BigInt(available);
  const paidOff = plan?.progress.paidOff ?? false;
  const cheer =
    plan && paidOff
      ? progressMessage(plan, format, paidOffSavings(plan.progress, plan.current))
      : null;
  const thisMonth = plan?.progress.paidThisMonth ? plan.progress.paymentsThisMonth : null;
  const overspent = amount < 0n;
  const cover = (
    <Button variant="destructive" size="sm" className="w-full">
      Cover Payment
    </Button>
  );
  return (
    <div className="grid gap-2 rounded-md bg-muted/50 p-3 text-center">
      {cheer && (
        <div className="rounded-md bg-emerald-500/15 p-2 text-sm">
          {/* Both lines run together here: "… in 3 months . You saved $2.10 …". */}
          <MessageLine
            parts={cheer.lines.flatMap((line, i) => (i === 0 ? line : [" ", ...line]))}
          />
        </div>
      )}
      <div>
        <p className="font-semibold text-lg tabular-nums">{format(amount)}</p>
        <p className="text-muted-foreground text-xs">Available for Payment</p>
      </div>
      {overspent && move ? (
        <AvailableButton
          categoryId={categoryId}
          categoryName={categoryName}
          amount={available}
          format={(m) => format(BigInt(m))}
          actions={move}
          trigger={cover}
        />
      ) : (
        <Button size="sm" className="w-full" disabled={loan.closed} onClick={() => setPaying(true)}>
          Record Payment
        </Button>
      )}
      {plan && !paidOff && !loan.closed && (
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={() => setSimulating(true)}
        >
          Open Payoff Simulator
        </Button>
      )}
      <p className="text-muted-foreground text-xs">
        {thisMonth !== null
          ? `${format(thisMonth)} paid this month`
          : loan.lastPaymentDate
            ? `Last Paid on ${dayLabel(loan.lastPaymentDate)}`
            : "No payments recorded yet"}
      </p>
      {simulating && plan && (
        <PayoffSimulator
          open
          onOpenChange={setSimulating}
          plan={plan}
          pairedCategoryId={categoryId}
        />
      )}
      {overspent && (
        <p className="rounded-md bg-destructive/10 p-2 text-destructive text-sm">
          Your payment was more than what you assigned. Cover the payment or you can't trust your
          plan balances!
        </p>
      )}
      {paying && (
        <RecordPaymentDialog
          open
          onOpenChange={setPaying}
          accounts={accounts.data?.accounts ?? []}
          settings={budget}
          format={format}
          paired={{ name: categoryName, available: amount }}
          initialAmount={amount}
          fromInspector
          lastFromAccountId={loan.lastPaymentFromAccountId}
          onSave={async (input) => {
            try {
              await record.mutateAsync({
                params: {
                  path: { budgetId: budget.id, accountId: loan.id },
                  query: { today: todayIso() },
                },
                body: { ...input, amount: input.amount.toString() },
              });
              await refresh();
              return null;
            } catch (error) {
              return apiErrorMessage(error, "Couldn't record the payment.");
            }
          }}
        />
      )}
    </div>
  );
}

export function PairedWith({ loan }: { loan: Account }) {
  const { budget } = useBudget();
  return (
    <p className="text-sm">
      Paired with{" "}
      <Link
        to="/budgets/$budgetId/accounts/$accountId"
        params={{ budgetId: budget.id, accountId: loan.id }}
        className="text-primary-text hover:underline"
      >
        {loan.name}
      </Link>{" "}
      Account
    </p>
  );
}
