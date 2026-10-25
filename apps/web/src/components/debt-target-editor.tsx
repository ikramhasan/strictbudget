import {
  accountFamily,
  addMonths,
  type BudgetMonth,
  effectivePayment,
  monthsBetween,
  paymentForMonths,
  payoffProjection,
} from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { FieldError } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { cn } from "@strictbudget/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { accountsQueryOptions } from "@/lib/accounts";
import { $api } from "@/lib/api";
import { useBudget } from "@/lib/budget-context";
import { apiErrorMessage } from "@/lib/budgets";
import { todayIso } from "@/lib/dates";
import { formatDuration, type LoanPlan } from "@/lib/loan-planner";
import { formatRate } from "@/lib/loans";
import { type CategoryTarget, ordinal, type TargetInput } from "@/lib/targets";
import { AddAccountDialog } from "./add-account-dialog";
import { useLoanRefresh } from "./loan-page";
import { PayoffMonthPicker } from "./payoff-simulator";

const EVERY_OPTIONS = [
  { value: "last", label: "Last Day of Month" },
  ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) })),
];

/**
 * Monthly Payment and Payoff Date each give the other (a date gives the payment rounded up);
 * Every is the due day.
 */
export function DebtTargetEditor({
  target,
  plan,
  format,
  parse,
  toInput,
  onSave,
  onCancel,
  onDelete,
  unpairedCategoryId,
}: {
  target: CategoryTarget | null;
  plan: LoanPlan | null;
  /** A category whose loan was unpaired or closed but kept its debt target: offers "Pair with a Loan". */
  unpairedCategoryId?: string;
  format: (minorUnits: string) => string;
  parse: (text: string) => bigint | string;
  toInput: (amount: string) => string;
  onSave: (input: TargetInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const start = target?.amount ?? plan?.minimumShown?.toString() ?? "";
  const [amountText, setAmountText] = useState(start ? toInput(start) : "");
  const [dueDay, setDueDay] = useState(target?.dueDay == null ? "last" : String(target.dueDay));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (m: bigint) => format(m.toString());

  const parsed = amountText.trim() === "" ? 0n : parse(amountText);
  const amount = typeof parsed === "bigint" ? parsed : null;
  const escrow = plan ? (plan.minimumShown ?? 0n) - (plan.minimum ?? 0n) : 0n;
  const owed = plan?.progress.owed ?? 0n;
  const project = (shown: bigint | null) => {
    const payment = effectivePayment(shown, escrow);
    return plan && payment !== null
      ? payoffProjection({ owed, rate: plan.rate, payment, exponent: plan.exponent })
      : null;
  };
  const byPayment = project(amount);
  const minimum = plan?.minimumShown ?? null;
  const byMinimum = project(minimum);
  const payoffMonth = plan && byPayment ? addMonths(plan.current, byPayment.months) : null;

  const pickMonth = (month: BudgetMonth) => {
    if (!plan) return;
    const payment = paymentForMonths({
      owed,
      rate: plan.rate,
      months: monthsBetween(plan.current, month),
    });
    if (payment !== null) setAmountText(toInput((payment + escrow).toString()));
  };

  let box: ReactNode = null;
  if (byPayment && byMinimum && amount !== null && minimum !== null) {
    const diff = amount - minimum;
    const [title, left, right, tone] =
      diff === 0n
        ? [
            "Paying the minimum every month",
            [money(byPayment.interest), "Interest Remaining"],
            [formatDuration(byPayment.months), "Time Remaining"],
            "neutral",
          ]
        : diff > 0n
          ? [
              `Paying +${money(diff)} extra every month`,
              [money(byMinimum.interest - byPayment.interest), "Interest Savings"],
              [formatDuration(Math.max(0, byMinimum.months - byPayment.months)), "Time Savings"],
              "extra",
            ]
          : [
              `Paying -${money(-diff)} less than minimum every month`,
              [money(byPayment.interest - byMinimum.interest), "Additional Interest"],
              [formatDuration(Math.max(0, byPayment.months - byMinimum.months)), "Additional Time"],
              "less",
            ];
    box = (
      <div
        className={cn(
          "overflow-hidden rounded-lg border text-center text-sm",
          tone === "neutral" && "bg-muted/60",
          tone === "extra" && "border-primary/50 bg-primary/10",
          tone === "less" && "border-amber-500/50 bg-amber-500/10",
        )}
      >
        <p className="border-b px-2 py-1.5 font-semibold">{title}</p>
        <div className="grid grid-cols-2 divide-x">
          {[left, right].map(([value, label]) => (
            <div key={label} className="px-2 py-2">
              <p className="font-semibold tabular-nums">{value}</p>
              <p className="text-xs">{label}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Add a New Loan's form is portaled but still a React child: its submit bubbles up to here.
    if (e.target !== e.currentTarget) return;
    if (typeof parsed === "string") return setError(parsed);
    if (parsed <= 0n) return setError("Enter how much you want to pay each month.");
    setError(null);
    setBusy(true);
    try {
      await onSave({
        cadence: "debt_monthly",
        amount: parsed.toString(),
        dueDay: dueDay === "last" ? null : Number(dueDay),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Debt Payment Target"
      className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t pt-3"
    >
      <h3 className="font-semibold text-sm">Debt Payment Target</h3>
      <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {box}
        <div className={cn("grid gap-2", !unpairedCategoryId && "grid-cols-2")}>
          <div className="grid gap-1 text-sm">
            <label htmlFor="debt-target-amount" className="font-medium">
              {unpairedCategoryId ? "Amount to Pay" : "Monthly Payment"}
            </label>
            <Input
              id="debt-target-amount"
              autoFocus
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </div>
          {plan && (
            <div className="grid gap-1 text-sm">
              <span className="font-medium">Payoff Date</span>
              <PayoffMonthPicker
                label="Payoff Date"
                value={payoffMonth}
                min={addMonths(plan.current, 1)}
                onChange={pickMonth}
              />
            </div>
          )}
        </div>
        <div className="grid gap-1 rounded-md bg-muted/60 p-3 text-sm">
          <label htmlFor="debt-target-every" className="font-medium">
            Every
          </label>
          <NativeSelect
            id="debt-target-every"
            className="w-full"
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
          >
            {EVERY_OPTIONS.map((o) => (
              <NativeSelectOption key={o.value} value={o.value}>
                {o.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {unpairedCategoryId && <PairWithLoan categoryId={unpairedCategoryId} onPaired={onCancel} />}
        {plan && byPayment && (
          <dl className="grid gap-1 text-sm">
            <p className="font-semibold">Summary</p>
            <SummaryRow label="Minimum Payment" value={minimum !== null ? money(minimum) : "--"} />
            {/* The Summary counts a month less than the box above: 57 payments read "4 yrs, 9 mos"
                there and "4 yrs, 8 mos" here. */}
            <SummaryRow
              label="Time Remaining"
              value={formatDuration(Math.max(0, byPayment.months - 1))}
            />
            <SummaryRow label="Remaining to Pay" value={money(owed + byPayment.interest)} />
            <SummaryRow label="Principal" value={money(owed)} indent />
            <SummaryRow
              label={`Interest (${plan.rate !== null ? formatRate(plan.rate) : "--"}%)`}
              value={money(byPayment.interest)}
              indent
            />
          </dl>
        )}
        {error && <FieldError>{error}</FieldError>}
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            onClick={() => void onDelete()}
          >
            Delete
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save Target
          </Button>
        </div>
      </form>
    </section>
  );
}

function SummaryRow({ label, value, indent }: { label: string; value: string; indent?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-2", indent && "pl-3")}>
      <dt>{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Pairing restarts the target from the loan's minimum. */
function PairWithLoan({ categoryId, onPaired }: { categoryId: string; onPaired: () => void }) {
  const { budget, formatAmount } = useBudget();
  const accounts = useQuery(accountsQueryOptions(budget.id));
  const refresh = useLoanRefresh(budget.id);
  const pair = $api.useMutation("patch", "/v1/budgets/{budgetId}/accounts/{accountId}");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const loans = (accounts.data?.accounts ?? []).filter(
    (a) => accountFamily(a.type) === "loan" && !a.closed && !a.pairedCategoryId,
  );
  async function choose(accountId: string) {
    try {
      await pair.mutateAsync({
        params: { path: { budgetId: budget.id, accountId }, query: { today: todayIso() } },
        body: { pairedCategoryId: categoryId },
      });
      await refresh();
      setOpen(false);
      // Pairing resets the target to the loan's minimum; the form's old amount is stale.
      onPaired();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't pair the loan."));
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 p-3 text-left text-sm"
      >
        <span className="grid flex-1 gap-0.5">
          <span className="font-medium text-primary-text">Pair with a Loan</span>
          <span>See your payoff progress, interest payments, and payoff date</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-primary-text" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pair with a Loan</DialogTitle>
            <DialogDescription>Select an existing loan or add a new one</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {loans.map((loan) => (
              <button
                key={loan.id}
                type="button"
                disabled={pair.isPending}
                onClick={() => void choose(loan.id)}
                className="flex justify-between gap-3 rounded-md bg-muted/60 px-3 py-2.5 text-sm hover:bg-muted"
              >
                <span className="truncate">{loan.name}</span>
                <span className="tabular-nums">
                  {formatAmount({
                    amount: -BigInt(loan.balances.working),
                    currency: budget.currency,
                  })}
                </span>
              </button>
            ))}
            <Button
              onClick={() => {
                setOpen(false);
                setAdding(true);
              }}
            >
              Add a New Loan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {adding && <AddAccountDialog budget={budget} open onOpenChange={setAdding} />}
    </>
  );
}
