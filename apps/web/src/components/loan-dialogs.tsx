import { accountFamily, type BudgetMonth } from "@strictbudget/engine";
import { Alert, AlertDescription } from "@strictbudget/ui/components/alert";
import { Button } from "@strictbudget/ui/components/button";
import { Checkbox } from "@strictbudget/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@strictbudget/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Label } from "@strictbudget/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { RadioGroup, RadioGroupItem } from "@strictbudget/ui/components/radio-group";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import type { Account } from "@/lib/accounts";
import type { CategoryList } from "@/lib/categories";
import { todayIso } from "@/lib/dates";
import {
  formatRate,
  hasEscrow,
  type LoanMonthData,
  type LoanTermsCheck,
  loanTermsChangeLines,
  shortMonth,
} from "@/lib/loans";
import { type MoneySettings, parseMoneyInput, toMoneyInput } from "@/lib/money-input";
import { bankBalance } from "./reconcile";
import { DateField } from "./register-fields";

type Format = (minorUnits: bigint) => string;

interface Settings extends MoneySettings {
  dateFormat: Parameters<typeof DateField>[0]["format"];
}

function LoanDialog({
  open,
  onOpenChange,
  title,
  intro,
  info,
  error,
  pending,
  saveDisabled = false,
  onSubmit,
  onDelete,
  deleteLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  intro?: ReactNode;
  info?: ReactNode;
  error: string | null;
  pending: boolean;
  /** Greys Save out, with no message (a credit or charge dated after today). */
  saveDisabled?: boolean;
  onSubmit: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {intro ? <DialogDescription>{intro}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!saveDisabled) onSubmit();
          }}
        >
          {info && (
            <Alert>
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          )}
          {children}
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter className="items-center sm:justify-between">
            {onDelete ? (
              <Button
                type="button"
                variant="outline"
                className="text-destructive"
                disabled={pending}
                onClick={onDelete}
              >
                {deleteLabel}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || saveDisabled}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AmountInput({
  id,
  label,
  value,
  onChange,
  description,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        inputMode="decimal"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

function MemoInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>Memo</FieldLabel>
      <Input id={id} value={value} maxLength={500} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function DateInput({
  value,
  onChange,
  settings,
}: {
  value: string;
  onChange: (iso: string) => void;
  settings: Settings;
}) {
  return (
    <Field>
      <FieldLabel>Date</FieldLabel>
      <DateField value={value} onChange={onChange} format={settings.dateFormat} />
    </Field>
  );
}

/** Runs `work`, keeping the dialog open with the error if it fails. */
function useSubmit(onOpenChange: (open: boolean) => void) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run(work: () => Promise<string | null>) {
    setPending(true);
    setError(null);
    const message = await work();
    setPending(false);
    if (message) setError(message);
    else onOpenChange(false);
  }
  return { error, setError, pending, run };
}

export interface PaymentInput {
  fromAccountId: string;
  amount: bigint;
  date: string;
  memo: string;
}

/**
 * Where Record Payment's From Account starts: the account of the payment into this loan entered
 * last (Record Payment or a register transfer, even back-dated), else the first account in the
 * list (cash accounts, then credit accounts, in sidebar order). A closed account falls back the
 * same way.
 */
export function defaultPaymentSource(
  accounts: readonly Account[],
  lastFromAccountId: string | null | undefined,
): string {
  const open = (family: "cash" | "credit") =>
    accounts.filter((a) => !a.closed && accountFamily(a.type) === family);
  const list = [...open("cash"), ...open("credit")];
  return (list.find((a) => a.id === lastFromAccountId) ?? list[0])?.id ?? "";
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  accounts,
  settings,
  format,
  paired,
  initialAmount,
  fromInspector = false,
  lastFromAccountId,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All the budget's accounts; open cash and credit accounts can pay. */
  accounts: readonly Account[];
  settings: Settings;
  format: Format;
  paired: { name: string; available: bigint } | null;
  initialAmount?: bigint;
  fromInspector?: boolean;
  lastFromAccountId?: string | null;
  onSave: (input: PaymentInput) => Promise<string | null>;
}) {
  const cash = accounts.filter((a) => !a.closed && accountFamily(a.type) === "cash");
  const credit = accounts.filter((a) => !a.closed && accountFamily(a.type) === "credit");
  const [fromAccountId, setFrom] = useState(() =>
    defaultPaymentSource(accounts, lastFromAccountId),
  );
  const [amount, setAmount] = useState(
    initialAmount && initialAmount > 0n ? toMoneyInput(initialAmount, settings) : "",
  );
  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState("");
  const { error, setError, pending, run } = useSubmit(onOpenChange);
  const fromId = useId();

  return (
    <LoanDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record Payment"
      intro={
        fromInspector
          ? "This payment will appear in the paired account, and as a transaction in the account your payment is coming from."
          : "This payment will appear here, and as a transaction in the account your payment is coming from."
      }
      info={
        paired && (
          <>
            You have <strong>{format(paired.available)}</strong> available for payment in{" "}
            <strong>{paired.name}</strong>.
          </>
        )
      }
      error={error}
      pending={pending}
      onSubmit={() => {
        const parsed = parseMoneyInput(amount || "0", settings);
        if (typeof parsed === "string") return setError(parsed);
        if (parsed <= 0n) return setError("Enter the amount you're paying");
        if (!fromAccountId) return setError("Choose the account the payment comes from");
        void run(() => onSave({ fromAccountId, amount: parsed, date, memo }));
      }}
    >
      <AmountInput
        id="loan-payment-amount"
        label="Payment Amount"
        value={amount}
        onChange={setAmount}
        description="Enter the total amount you are paying. strictbudget will estimate the portion of each payment that is principal and interest."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={fromId}>From Account</FieldLabel>
          <NativeSelect
            id={fromId}
            value={fromAccountId}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full"
          >
            {[
              { label: "Cash Accounts:", list: cash },
              { label: "Credit Accounts:", list: credit },
            ]
              .filter((g) => g.list.length > 0)
              .map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.list.map((a) => (
                    <NativeSelectOption key={a.id} value={a.id}>
                      {a.name}
                    </NativeSelectOption>
                  ))}
                </optgroup>
              ))}
          </NativeSelect>
        </Field>
        <DateInput value={date} onChange={setDate} settings={settings} />
      </div>
      <MemoInput value={memo} onChange={setMemo} />
    </LoanDialog>
  );
}

export type ActivityKind = "credit" | "charge" | "adjustment";

const ACTIVITY_COPY: Record<
  ActivityKind,
  { add: string; edit: string; intro: string; info?: string; remove: string; amount: string }
> = {
  credit: {
    add: "Record Credit or Refund",
    edit: "Edit Credit or Refund",
    intro: "This is for credits or refunds to your account, other than payments.",
    info: "This amount will be credited towards your account balance, but will not be included in Ready to Assign or in your plan category balance.",
    remove: "Delete Credit",
    amount: "Amount",
  },
  charge: {
    add: "Record New Charge",
    edit: "Edit Charge",
    intro:
      "This is for charges against your account other than interest or escrow: new withdrawals, late fees, annual fees, etc.",
    info: "Remember to set additional money aside in your plan for payment if you do not want these new charges to carry forward as increased debt.",
    remove: "Delete Charge",
    amount: "Amount",
  },
  adjustment: {
    add: "Balance Adjustment",
    edit: "Edit Balance Adjustment",
    intro:
      "strictbudget made this adjustment during a balance update. After editing, make sure you update your balance again to make sure your account balance in strictbudget still matches your financial institution.",
    remove: "Delete Adjustment",
    amount: "Balance Adjustment Amount",
  },
};

export interface ActivityInput {
  /** Signed like the account: credits positive, charges negative. */
  amount: bigint;
  date: string;
  memo: string;
}

/** Credits and charges take a positive amount; a balance adjustment's is signed. */
export function LoanActivityDialog({
  open,
  onOpenChange,
  kind,
  initial,
  settings,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ActivityKind;
  initial?: ActivityInput;
  settings: Settings;
  onSave: (input: ActivityInput) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
}) {
  const copy = ACTIVITY_COPY[kind];
  const shown = (amount: bigint) =>
    kind === "adjustment" ? amount : amount < 0n ? -amount : amount;
  const [amount, setAmount] = useState(
    initial ? toMoneyInput(shown(initial.amount), settings) : "",
  );
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const { error, setError, pending, run } = useSubmit(onOpenChange);
  const amountField = (
    <AmountInput
      id="loan-activity-amount"
      label={copy.amount}
      value={amount}
      onChange={setAmount}
    />
  );
  return (
    <LoanDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? copy.edit : copy.add}
      intro={copy.intro}
      info={copy.info}
      error={error}
      pending={pending}
      saveDisabled={date > todayIso()}
      onDelete={onDelete && (() => void run(onDelete))}
      deleteLabel={copy.remove}
      onSubmit={() => {
        const parsed = parseMoneyInput(amount || "0", settings);
        if (typeof parsed === "string") return setError(parsed);
        if (kind !== "adjustment" && parsed <= 0n) return setError("Enter an amount");
        const signed = kind === "credit" ? parsed : kind === "charge" ? -parsed : parsed;
        void run(() => onSave({ amount: signed, date, memo }));
      }}
    >
      {kind === "adjustment" ? (
        <>
          <DateInput value={date} onChange={setDate} settings={settings} />
          {amountField}
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {amountField}
          <DateInput value={date} onChange={setDate} settings={settings} />
        </div>
      )}
      <MemoInput value={memo} onChange={setMemo} />
    </LoanDialog>
  );
}

/** Sets the month's total, which replaces the estimate; Delete stores zero. */
export function EditChargeDialog({
  open,
  onOpenChange,
  kind,
  month,
  amount,
  settings,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "interest" | "escrow";
  month: BudgetMonth;
  amount: bigint;
  settings: Settings;
  onSave: (amount: bigint) => Promise<string | null>;
}) {
  const [text, setText] = useState(toMoneyInput(amount, settings));
  const { error, setError, pending, run } = useSubmit(onOpenChange);
  const Name = kind === "interest" ? "Interest" : "Escrow";
  return (
    <LoanDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${Name}`}
      intro={`This is for the total ${kind} charge for ${shortMonth(month)}. Any existing estimate or recorded ${kind} charge will override when you save the changes.`}
      error={error}
      pending={pending}
      onDelete={() => void run(() => onSave(0n))}
      deleteLabel={`Delete ${Name}`}
      onSubmit={() => {
        const parsed = parseMoneyInput(text || "0", settings);
        if (typeof parsed === "string") return setError(parsed);
        if (parsed < 0n) return setError("Enter an amount of zero or more");
        void run(() => onSave(parsed));
      }}
    >
      <AmountInput
        id="loan-charge-amount"
        label={`${Name} Amount`}
        value={text}
        onChange={setText}
      />
    </LoanDialog>
  );
}

/** Adds to the chosen month's interest, from the loan's first month through this one. */
export function RecordInterestDialog({
  open,
  onOpenChange,
  months,
  settings,
  format,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Oldest first. */
  months: readonly LoanMonthData[];
  settings: Settings;
  format: Format;
  onSave: (month: BudgetMonth, total: bigint) => Promise<string | null>;
}) {
  const newest = [...months].reverse();
  const [month, setMonth] = useState(newest[0]?.month ?? "");
  const [text, setText] = useState("");
  const { error, setError, pending, run } = useSubmit(onOpenChange);
  const monthId = useId();
  const chosen = months.find((m) => m.month === month);
  // What the month shows now: a set amount, or the part of the estimate its payments covered.
  const current = chosen
    ? BigInt(
        chosen.interest.status === "estimated" ? chosen.interest.applied : chosen.interest.total,
      )
    : 0n;
  const parsed = parseMoneyInput(text || "0", settings);
  return (
    <LoanDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record Interest"
      intro="Interest recorded will be in addition to any existing estimated or recorded interest in the chosen month."
      error={error}
      pending={pending}
      onSubmit={() => {
        if (typeof parsed === "string") return setError(parsed);
        if (parsed <= 0n) return setError("Enter the interest your lender charged");
        void run(() => onSave(month, current + parsed));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <AmountInput
          id="loan-interest-amount"
          label="Interest Amount"
          value={text}
          onChange={setText}
        />
        <Field>
          <FieldLabel htmlFor={monthId}>Month</FieldLabel>
          <NativeSelect
            id={monthId}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full"
          >
            {newest.map((m) => (
              <NativeSelectOption key={m.month} value={m.month}>
                {shortMonth(m.month)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {typeof parsed !== "string" && parsed > 0n && (
        <p className="rounded-md bg-muted p-3 text-center text-sm">
          After saving, the {shortMonth(month)} interest charge will be{" "}
          <strong className="text-primary-text">{format(current + parsed)}</strong>
        </p>
      )}
    </LoanDialog>
  );
}

type UpdateStep = "confirm" | "enter" | "check" | "difference" | "done";

const RATE = /^\d{1,3}(\.\d{1,3})?$/;

/**
 * Yes reconciles; No asks for the lender's balance. If it differs, a check step shows the
 * Difference and the loan's terms, then the Changes step lists the Balance Adjustment (worked out
 * by the API with this month re-estimated on any new terms). Nothing is saved before its Next.
 */
export function UpdateBalanceDialog({
  open,
  onOpenChange,
  account,
  settings,
  format,
  month,
  onPreview,
  onReconcile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account;
  settings: Settings;
  format: Format;
  /** The user's current month (the changes apply "for October"). */
  month: BudgetMonth;
  /** The adjustment a reconcile with these terms would add, or an error message. */
  onPreview: (balance: bigint, loanTerms: LoanTermsCheck) => Promise<bigint | string>;
  onReconcile: (balance: bigint, loanTerms?: LoanTermsCheck) => Promise<string | null>;
}) {
  const working = BigInt(account.balances.working);
  const [step, setStep] = useState<UpdateStep>("confirm");
  const [text, setText] = useState("");
  const [balance, setBalance] = useState(working);
  const [rate, setRate] = useState(account.interestRate ? formatRate(account.interestRate) : "");
  const [keepRate, setKeepRate] = useState(true);
  const [escrow, setEscrow] = useState(toMoneyInput(account.escrowAmount, settings));
  const [keepEscrow, setKeepEscrow] = useState(true);
  const [terms, setTerms] = useState<LoanTermsCheck | undefined>();
  const [adjustment, setAdjustment] = useState(0n);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputId = useId();
  const rateId = useId();
  const keepRateId = useId();
  const escrowId = useId();
  const keepEscrowId = useId();
  const changes = terms ? loanTermsChangeLines(terms, account, month, format) : [];

  async function reconcile(to: bigint, loanTerms?: LoanTermsCheck) {
    setPending(true);
    setError(null);
    const message = await onReconcile(to, loanTerms);
    setPending(false);
    if (message) setError(message);
    else setStep("done");
  }

  async function check(event: FormEvent) {
    event.preventDefault();
    const newRate = rate.trim().replace(/%$/, "").replace(",", ".");
    if (newRate && !RATE.test(newRate)) return setError("Enter the interest rate like 6.125");
    const loanTerms: LoanTermsCheck = {
      interestRate: { rate: newRate || null, keepGoingForward: keepRate },
    };
    if (hasEscrow(account.type)) {
      const amount = escrow.trim() ? parseMoneyInput(escrow, settings) : null;
      if (typeof amount === "string") return setError(amount);
      loanTerms.escrowAmount = { amount: amount?.toString() ?? null, keepGoingForward: keepEscrow };
    }
    setError(null);
    if (loanTermsChangeLines(loanTerms, account, month, format).length === 0) {
      setTerms(undefined);
      setAdjustment(balance - working);
      return setStep("difference");
    }
    setPending(true);
    const result = await onPreview(balance, loanTerms);
    setPending(false);
    if (typeof result === "string") return setError(result);
    setTerms(loanTerms);
    setAdjustment(result);
    setStep("difference");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">Update Balance</DialogTitle>
        </DialogHeader>
        {step === "confirm" && (
          <div className="grid justify-items-center gap-3 py-2 text-center">
            <p className="text-sm">Is your current balance at your lender</p>
            <p className="font-semibold text-2xl tabular-nums">{format(working)} ?</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("enter")}>
                No
              </Button>
              <Button disabled={pending} onClick={() => void reconcile(working)}>
                Yes
              </Button>
            </div>
          </div>
        )}
        {step === "enter" && (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = bankBalance(text, account, settings);
              if (typeof parsed === "string") return setError(parsed);
              setBalance(parsed);
              if (parsed === working) return void reconcile(parsed);
              setError(null);
              setStep("check");
            }}
          >
            <div className="flex items-baseline justify-between gap-2 border-b pb-3 text-sm">
              <div>
                <p className="font-medium">{account.name}</p>
                <p className="text-muted-foreground text-xs">Current balance in strictbudget</p>
              </div>
              <span className="tabular-nums">{format(working)}</span>
            </div>
            <Field>
              <FieldLabel htmlFor={inputId}>
                Current balance at your financial institution
              </FieldLabel>
              <Input
                id={inputId}
                inputMode="decimal"
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" className="justify-self-end">
              Next
            </Button>
          </form>
        )}
        {step === "check" && (
          <form className="grid gap-4" onSubmit={(event) => void check(event)}>
            <Difference amount={balance - working} format={format} />
            <p className="text-sm">
              The balance recorded in strictbudget doesn't match your account. First of all, let's
              make sure the information we have is correct.
            </p>
            <Field>
              <FieldLabel htmlFor={rateId}>Interest rate</FieldLabel>
              <Input
                id={rateId}
                inputMode="decimal"
                autoFocus
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
              <KeepGoingForward
                id={keepRateId}
                label="Keep this new interest rate going forward"
                checked={keepRate}
                onChange={setKeepRate}
              />
            </Field>
            {hasEscrow(account.type) && (
              <Field>
                <FieldLabel htmlFor={escrowId}>Monthly escrow amount</FieldLabel>
                <Input
                  id={escrowId}
                  inputMode="decimal"
                  value={escrow}
                  onChange={(e) => setEscrow(e.target.value)}
                />
                <KeepGoingForward
                  id={keepEscrowId}
                  label="Keep this new escrow amount going forward"
                  checked={keepEscrow}
                  onChange={setKeepEscrow}
                />
              </Field>
            )}
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" className="justify-self-end" disabled={pending}>
              Next
            </Button>
          </form>
        )}
        {step === "difference" && (
          <div className="grid gap-4">
            <Difference amount={adjustment} format={format} />
            <p className="text-sm">
              Since it looks like there is still a difference between your account balance in
              strictbudget and at your lender, we'll create a balance adjustment to get you back on
              track.
            </p>
            <div className="grid gap-1 text-sm">
              <p className="font-medium">Changes</p>
              <ul className="divide-y border-y">
                {adjustment !== 0n && (
                  <li className="flex justify-between py-2">
                    <span>Balance Adjustment</span>
                    <span className="tabular-nums">
                      {adjustment > 0n ? "+" : ""}
                      {format(adjustment)}
                    </span>
                  </li>
                )}
                {changes.map((line) => (
                  <li key={line} className="py-2">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            {error && <FieldError>{error}</FieldError>}
            <Button
              className="justify-self-end"
              disabled={pending}
              onClick={() => void reconcile(balance, terms)}
            >
              Next
            </Button>
          </div>
        )}
        {step === "done" && (
          <div className="grid gap-4 text-center">
            <p className="text-sm">
              <strong>Your balance has been updated!</strong> Time for the reconciliation dance.
            </p>
            <p className="text-muted-foreground text-sm">
              Remember to update your balance before making a payment to get the most accurate
              information.
            </p>
            <Button className="justify-self-end" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Difference({ amount, format }: { amount: bigint; format: Format }) {
  return (
    <div className="rounded-md bg-muted p-3 text-center">
      <p className="font-semibold tabular-nums">{format(amount)}</p>
      <p className="text-muted-foreground text-xs">Difference</p>
    </div>
  );
}

function KeepGoingForward({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

export type PairChoice = { categoryId: string } | { name: string; groupId: string } | null;

/** Every plan category but the credit card payment ones. */
export function pairableGroups(list: CategoryList) {
  return list.groups
    .filter((g) => !g.kind)
    .map((g) => ({ ...g, categories: g.categories.filter((c) => !c.linkedAccountId) }))
    .filter((g) => g.categories.length > 0);
}

export function PairCategoryFields({
  list,
  value,
  onChange,
  newName = "",
}: {
  list: CategoryList;
  value: PairChoice;
  onChange: (choice: PairChoice) => void;
  /** The new category's starting name (Update to a Loan Account prefills the account's). */
  newName?: string;
}) {
  const [mode, setMode] = useState<"existing" | "new">(
    value && "name" in value ? "new" : "existing",
  );
  const groups = pairableGroups(list);
  const newGroups = list.groups.filter((g) => !g.kind);
  const categoryId = useId();
  const nameId = useId();
  const groupId = useId();
  const current = value ?? null;
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        Pairing with a plan category helps better show how your payments will affect your debt.
        Pairing works best when there is a one-to-one relationship between your loan account and a
        plan category.
      </p>
      <RadioGroup
        value={mode}
        onValueChange={(v) => {
          setMode(v as "existing" | "new");
          onChange(v === "new" && newName ? { name: newName, groupId: "" } : null);
        }}
        aria-label="Which category do you want to pair your loan with?"
      >
        <div className="flex items-start gap-2 text-sm">
          <RadioGroupItem id={`${categoryId}-existing`} value="existing" className="mt-0.5" />
          <label htmlFor={`${categoryId}-existing`}>
            Select an existing category
            <span className="block text-muted-foreground text-xs">
              Pair with a category already in your plan
            </span>
          </label>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <RadioGroupItem id={`${categoryId}-new`} value="new" className="mt-0.5" />
          <label htmlFor={`${categoryId}-new`}>
            Create a new category
            <span className="block text-muted-foreground text-xs">
              Pair with a brand new category
            </span>
          </label>
        </div>
      </RadioGroup>
      {mode === "existing" ? (
        <Field>
          <FieldLabel htmlFor={categoryId}>Select a category</FieldLabel>
          <NativeSelect
            id={categoryId}
            className="w-full"
            value={current && "categoryId" in current ? current.categoryId : ""}
            onChange={(e) => onChange(e.target.value ? { categoryId: e.target.value } : null)}
          >
            <NativeSelectOption value="" />
            {groups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.categories.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
          {current &&
            "categoryId" in current &&
            (() => {
              const target = groups
                .flatMap((g) => g.categories)
                .find((c) => c.id === current.categoryId)?.target;
              // Pairing drops any other target (a debt target stays).
              return target && target.cadence !== "debt_monthly" ? (
                <FieldDescription>
                  Pairing this category will remove the current goal. Don't worry though, we'll take
                  you to your plan so you can create a new one!
                </FieldDescription>
              ) : null;
            })()}
        </Field>
      ) : (
        <>
          <Field>
            <FieldLabel htmlFor={nameId}>Give your category a name</FieldLabel>
            <Input
              id={nameId}
              maxLength={100}
              value={current && "name" in current ? current.name : ""}
              onChange={(e) =>
                onChange({
                  name: e.target.value,
                  groupId: current && "groupId" in current ? current.groupId : "",
                })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={groupId}>Add to category group</FieldLabel>
            <NativeSelect
              id={groupId}
              className="w-full"
              value={current && "groupId" in current ? current.groupId : ""}
              onChange={(e) =>
                onChange({
                  name: current && "name" in current ? current.name : "",
                  groupId: e.target.value,
                })
              }
            >
              <NativeSelectOption value="" />
              {newGroups.map((g) => (
                <NativeSelectOption key={g.id} value={g.id}>
                  {g.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </>
      )}
    </div>
  );
}

export const pairChoiceReady = (choice: PairChoice) =>
  choice !== null &&
  ("categoryId" in choice
    ? choice.categoryId !== ""
    : choice.name.trim() !== "" && choice.groupId !== "");

export function PairCategoryDialog({
  open,
  onOpenChange,
  list,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: CategoryList;
  onSave: (choice: Exclude<PairChoice, null>) => Promise<string | null>;
}) {
  const [choice, setChoice] = useState<PairChoice>(null);
  const { error, pending, run } = useSubmit(onOpenChange);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pair your loan with a plan category</DialogTitle>
        </DialogHeader>
        <PairCategoryFields list={list} value={choice} onChange={setChoice} />
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !pairChoiceReady(choice)}
            onClick={() => choice && void run(() => onSave(choice))}
          >
            Pair
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
