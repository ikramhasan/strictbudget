import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  type AccountType,
  accountFamily,
} from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { ChevronDown, ChevronRight, CircleCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { CategoryList } from "@/lib/categories";
import { formatRate, hasEscrow, longMonth } from "@/lib/loans";
import { type MoneySettings, parseMoneyInput, toMoneyInput } from "@/lib/money-input";
import { LoanFields, type LoanValues, parseLoan } from "./account-forms";
import { PairCategoryFields, type PairChoice, pairChoiceReady } from "./loan-dialogs";

const LOAN_TYPES = ACCOUNT_TYPES.filter((t) => accountFamily(t) === "loan");

/** Only on a tracking liability; tracking assets and budget accounts don't have it. */
export function UpdateToLoanSection({ onLearnMore }: { onLearnMore: () => void }) {
  return (
    <section className="grid gap-2 border-t pt-4" aria-label="Update to a Loan Account">
      <h3 className="font-medium text-sm">Update to a Loan Account</h3>
      <p className="text-muted-foreground text-sm">
        Plan your payments and track your progress when you migrate to a loan account.
      </p>
      <Button size="sm" className="justify-self-start" onClick={onLearnMore}>
        Learn More
      </Button>
    </section>
  );
}

export interface UpdateToLoanValues {
  name: string;
  type: AccountType;
  /** Minor units, negative for money owed. */
  balance: string;
  interestRate?: string;
  minimumPayment?: string;
  escrowAmount?: string;
  pairing: Exclude<PairChoice, null>;
}

type Step = "learn" | "type" | "details" | "pair" | "confirm" | "done";

/**
 * Learn More → Select Account Type → the loan form prefilled with the account's name and what's
 * owed → Pair Account with Category (required: no Skip) → Update Account → Success.
 */
export function UpdateToLoanDialog({
  open,
  onOpenChange,
  account,
  settings,
  categories,
  format,
  onSubmit,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: { name: string; balances: { working: string } };
  settings: MoneySettings;
  categories: CategoryList | undefined;
  format: (minorUnits: bigint) => string;
  /** Resolves to the new loan's id, or an error message. */
  onSubmit: (values: UpdateToLoanValues) => Promise<{ loanId: string } | { error: string }>;
  onDone: (loanId: string) => void;
}) {
  const [step, setStep] = useState<Step>("learn");
  const [type, setType] = useState<AccountType>("mortgage");
  const [name, setName] = useState(account.name);
  const [owed, setOwed] = useState(toMoneyInput(-BigInt(account.balances.working), settings));
  const [loan, setLoan] = useState<LoanValues>({
    interestRate: "",
    minimumPayment: "",
    escrowAmount: "",
  });
  const [pairing, setPairing] = useState<PairChoice>(null);
  const [values, setValues] = useState<UpdateToLoanValues | null>(null);
  const [loanId, setLoanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function details(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const balance = parseMoneyInput(owed || "0", settings);
    if (typeof balance === "string") return setError(balance);
    const terms = parseLoan(loan, settings, type);
    if (!terms.ok) return setError(terms.error);
    if (!name.trim()) return setError("Give it a nickname");
    setError(null);
    setValues({
      name: name.trim(),
      type,
      // The form asks for what's owed; the balance is its negative.
      balance: (-balance).toString(),
      interestRate: terms.interestRate ?? undefined,
      minimumPayment: terms.minimumPayment ?? undefined,
      escrowAmount: terms.escrowAmount ?? undefined,
      pairing: { categoryId: "" },
    });
    setStep("pair");
  }

  async function update() {
    if (!values) return;
    setPending(true);
    setError(null);
    const result = await onSubmit(values);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setLoanId(result.loanId);
    setStep("done");
  }

  const back = (to: Step) => (
    <Button
      type="button"
      variant="ghost"
      onClick={() => {
        setError(null);
        setStep(to);
      }}
    >
      Back
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // After the update, closing goes to the loan like Done.
        if (!next && loanId) return onDone(loanId);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        {step === "learn" && (
          <>
            <DialogHeader>
              <DialogTitle>Update to a Loan Account</DialogTitle>
              <DialogDescription className="font-semibold text-foreground">
                The new loan account makes it easier for you to plan, track, and pay down your
                debts.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 text-sm">
              <p>By updating to a loan account, you'll be able to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  Create a monthly payment target in a category that is paired with the account.
                </li>
                <li>Calculate your interest and time savings for monthly and one-time payments.</li>
                <li>See your paydown progress, including the history in this tracking account</li>
              </ul>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Maybe Later
              </Button>
              <Button onClick={() => setStep("type")}>Get Started</Button>
            </DialogFooter>
          </>
        )}

        {step === "type" && (
          <>
            <DialogHeader>
              <DialogTitle>Select Account Type</DialogTitle>
              <DialogDescription>
                <span className="block font-semibold text-foreground">Mortgages and Loans</span>
                Accounts that have an outstanding balance you're currently paying off, and aren't
                spending from.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {LOAN_TYPES.map((t) => (
                <Button
                  key={t}
                  variant="outline"
                  className="h-11 justify-start"
                  onClick={() => {
                    setType(t);
                    setStep("details");
                  }}
                >
                  {ACCOUNT_TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
            <DialogFooter>{back("learn")}</DialogFooter>
          </>
        )}

        {step === "details" && (
          <form onSubmit={details} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Add Unlinked Account</DialogTitle>
              <DialogDescription>
                Let's go! And don't worry, you can edit this account at any time.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="update-loan-name">Give it a nickname</FieldLabel>
              <Input
                id="update-loan-name"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="update-loan-type">What type of loan are you adding?</FieldLabel>
              <NativeSelect
                id="update-loan-type"
                className="w-full"
                value={type}
                onChange={(e) => setType(e.target.value as AccountType)}
              >
                {LOAN_TYPES.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="update-loan-balance">Current account balance</FieldLabel>
              <Input
                id="update-loan-balance"
                inputMode="decimal"
                value={owed}
                onChange={(e) => setOwed(e.target.value)}
              />
            </Field>
            <LoanFields values={loan} onChange={setLoan} type={type} adding />
            <p className="text-muted-foreground text-xs">
              You can add extra payments as a target in your plan later.
            </p>
            {error && <FieldError>{error}</FieldError>}
            <DialogFooter>
              {back("type")}
              <Button type="submit">Next</Button>
            </DialogFooter>
          </form>
        )}

        {step === "pair" && (
          <>
            <DialogHeader>
              <DialogTitle>Pair Account with Category</DialogTitle>
              <DialogDescription className="font-semibold text-foreground">
                Pair your loan with a plan category
              </DialogDescription>
            </DialogHeader>
            {categories ? (
              <PairCategoryFields
                list={categories}
                value={pairing}
                onChange={setPairing}
                newName={values?.name}
              />
            ) : (
              <p className="text-muted-foreground text-sm">Loading categories…</p>
            )}
            <DialogFooter>
              {back("details")}
              <Button
                disabled={!pairChoiceReady(pairing)}
                onClick={() => {
                  if (!values || !pairing) return;
                  setValues({ ...values, pairing });
                  setStep("confirm");
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm" && values && (
          <>
            <DialogHeader>
              <DialogTitle>Update Account</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-[1fr_auto] gap-x-4 rounded-lg bg-muted px-4 py-3 text-sm tabular-nums">
              <span className="font-semibold">
                {values.name}
                {values.interestRate ? ` (${formatRate(values.interestRate)}%)` : ""}
              </span>
              <span className="text-right">{format(BigInt(values.balance))}</span>
              <span>
                {values.minimumPayment
                  ? `${format(BigInt(values.minimumPayment))} monthly`
                  : "No monthly payment"}
              </span>
              <span className="text-right">
                {hasEscrow(values.type) && values.escrowAmount
                  ? `${format(BigInt(values.escrowAmount))} escrow`
                  : ""}
              </span>
            </div>
            <div className="grid gap-2 text-sm">
              <p>
                After clicking next, we'll move your account history to your new account, and close
                the existing account.
              </p>
              <p>If applicable,</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>We'll cancel any scheduled transactions in the closed account.</li>
              </ul>
            </div>
            {error && <FieldError>{error}</FieldError>}
            <DialogFooter>
              {back("pair")}
              <Button disabled={pending} onClick={() => void update()}>
                Next
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "done" && loanId && (
          <>
            <DialogHeader className="items-center text-center">
              <CircleCheck className="size-12 text-primary-text" aria-hidden />
              <DialogTitle>Success!</DialogTitle>
              <DialogDescription>
                We've updated your account. You'll see your new account in the sidebar under Loans,
                and your old account under Closed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => onDone(loanId)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The tracking account the loan was made from, with each month's ending balance. */
export function OriginalHistory({
  months,
  format,
  onGoToAccount,
}: {
  months: ReadonlyArray<{ month: string; endBalance: string }>;
  format: (minorUnits: bigint) => string;
  onGoToAccount: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Toggle = open ? ChevronDown : ChevronRight;
  return (
    <section className="grid gap-3" aria-label="Original Tracking Account History">
      <h2 className="font-semibold text-xl">Original Tracking Account History</h2>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <button
            type="button"
            className="flex items-center gap-1 font-semibold text-sm"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            Closed Account
            <Toggle className="size-4" aria-hidden />
          </button>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onGoToAccount}>
            Go To Tracking Account
          </Button>
        </div>
        {open &&
          months.map((m) => (
            <div
              key={m.month}
              className="flex items-center justify-between gap-3 border-t px-4 py-3 pl-8 text-sm"
            >
              <span className="grid">
                <span className="font-medium">{longMonth(m.month)}</span>
                <span className="text-muted-foreground">
                  Ending balance migrated from the original account
                </span>
              </span>
              <span className="tabular-nums">{format(BigInt(m.endBalance))}</span>
            </div>
          ))}
      </div>
    </section>
  );
}
