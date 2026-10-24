import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  type AccountType,
  accountFamily,
  type CurrencyCode,
  isDebtAccount,
  isOnBudget,
} from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { RadioGroup, RadioGroupItem } from "@strictbudget/ui/components/radio-group";
import { Textarea } from "@strictbudget/ui/components/textarea";
import { Landmark } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { editBalanceLabel } from "@/lib/accounts";
import type { CategoryList } from "@/lib/categories";
import { hasEscrow } from "@/lib/loans";
import { inCurrency, type MoneySettings, parseMoneyInput, toMoneyInput } from "@/lib/money-input";
import { ACCOUNT_LOGO_PX } from "@/lib/pictures";
import { CurrencyPicker } from "./currency-picker";
import { PairCategoryFields, type PairChoice, pairChoiceReady } from "./loan-dialogs";
import { PictureField } from "./picture-field";

const TYPE_GROUPS: Array<{ label: string; types: AccountType[] }> = [
  {
    label: "Budget accounts",
    types: ACCOUNT_TYPES.filter((t) => ["cash", "credit"].includes(accountFamily(t))),
  },
  { label: "Loans", types: ACCOUNT_TYPES.filter((t) => accountFamily(t) === "loan") },
  {
    label: "Tracking (off budget)",
    types: ACCOUNT_TYPES.filter((t) => accountFamily(t) === "tracking"),
  },
];

const RATE = /^\d{1,3}(\.\d{1,3})?$/;

export interface LoanValues {
  interestRate: string;
  minimumPayment: string;
  escrowAmount: string;
}

type LoanResult =
  | {
      ok: true;
      interestRate: string | null;
      minimumPayment: string | null;
      escrowAmount: string | null;
    }
  | { ok: false; error: string };

export function parseLoan(
  values: LoanValues,
  settings: MoneySettings,
  type: AccountType,
): LoanResult {
  const rate = values.interestRate.trim().replace(/%$/, "").replace(",", ".");
  if (rate && !RATE.test(rate)) return { ok: false, error: "Enter the interest rate like 6.125" };
  const amounts: Record<"minimumPayment" | "escrowAmount", string | null> = {
    minimumPayment: null,
    escrowAmount: null,
  };
  for (const key of ["minimumPayment", "escrowAmount"] as const) {
    // A hidden escrow field (not a mortgage) sends nothing, even if typed in before.
    if (key === "escrowAmount" && !hasEscrow(type)) continue;
    if (!values[key].trim()) continue;
    const parsed = parseMoneyInput(values[key], settings);
    if (typeof parsed === "string") return { ok: false, error: parsed };
    amounts[key] = parsed.toString();
  }
  return { ok: true, interestRate: rate || null, ...amounts };
}

const ESCROW_HINT =
  "This would only apply if your bank collects your property taxes on behalf of your city or if it collects other fees as part of your payment.";

/**
 * A loan's terms. Add Account asks for the "Monthly payment required by your lender" and, for a
 * mortgage, whether it includes escrow; Edit Account has Minimum Monthly Payment, Interest Rate (%)
 * and, for a mortgage, Monthly Escrow or Fee Amount.
 */
export function LoanFields({
  values,
  onChange,
  type,
  adding = false,
}: {
  values: LoanValues;
  onChange: (values: LoanValues) => void;
  type: AccountType;
  adding?: boolean;
}) {
  const [escrowAsked, setEscrowAsked] = useState(values.escrowAmount.trim() !== "");
  const field = (key: keyof LoanValues, label: string, description?: string, hint?: string) => (
    <Field>
      <FieldLabel htmlFor={`loan-${key}`}>{label}</FieldLabel>
      <Input
        id={`loan-${key}`}
        inputMode="decimal"
        value={values[key]}
        onChange={(e) => onChange({ ...values, [key]: e.target.value })}
        placeholder={hint}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
  if (adding) {
    return (
      <>
        {field("interestRate", "Interest rate (%)", undefined, "6.125")}
        {field(
          "minimumPayment",
          "Monthly payment required by your lender",
          "Enter the total amount you are required to pay your lender each month, including principal, interest, escrow, fees, etc.",
        )}
        {hasEscrow(type) && (
          <Field>
            <FieldLabel>
              Are there escrow installments or other fees included in your mortgage payments?
            </FieldLabel>
            <FieldDescription>{ESCROW_HINT}</FieldDescription>
            <RadioGroup
              value={escrowAsked ? "yes" : "no"}
              onValueChange={(v) => {
                setEscrowAsked(v === "yes");
                if (v === "no") onChange({ ...values, escrowAmount: "" });
              }}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2 text-sm">
                <RadioGroupItem id="loan-escrow-no" value="no" />
                <label htmlFor="loan-escrow-no">No</label>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <RadioGroupItem id="loan-escrow-yes" value="yes" />
                <label htmlFor="loan-escrow-yes">Yes</label>
              </div>
            </RadioGroup>
          </Field>
        )}
        {hasEscrow(type) &&
          escrowAsked &&
          field("escrowAmount", "How much is the monthly escrow or fee?")}
      </>
    );
  }
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("minimumPayment", "Minimum Monthly Payment")}
        {field("interestRate", "Interest Rate (%)", undefined, "6.125")}
      </div>
      {hasEscrow(type) && field("escrowAmount", "Monthly Escrow or Fee Amount", ESCROW_HINT)}
    </>
  );
}

function FormShell({
  onSubmit,
  error,
  pending,
  submitLabel,
  children,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  error: string | null;
  pending: boolean;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {children}
      {error && <FieldError>{error}</FieldError>}
      <Button type="submit" disabled={pending} className="justify-self-end">
        {submitLabel}
      </Button>
    </form>
  );
}

export interface NewAccountValues {
  name: string;
  type: AccountType;
  /** Minor units of `currency`; negative when money is owed. */
  balance: string;
  /** Left out for the budget's currency. */
  currency?: CurrencyCode;
  interestRate?: string;
  minimumPayment?: string;
  escrowAmount?: string;
  /** Loans: the optional "Pair a Category" step. */
  pairing?: PairChoice;
  /** An optional logo, already cropped; uploaded once the account exists. */
  logo?: Blob | null;
}

/** An account's optional logo: a square crop, shown before its name in the sidebar. */
export function AccountLogoField({
  name,
  src,
  onPick,
  onRemove,
}: {
  name: string;
  src: string | undefined;
  onPick: (blob: Blob) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
}) {
  return (
    <Field>
      <FieldLabel>
        Logo <span className="font-normal text-muted-foreground">(optional)</span>
      </FieldLabel>
      <PictureField
        shape="square"
        size={ACCOUNT_LOGO_PX}
        src={src}
        fallback={[...name.trim()][0]?.toUpperCase() ?? <Landmark className="size-6" />}
        label="Logo"
        cropTitle="Crop the account's logo"
        onPick={onPick}
        onRemove={onRemove}
      />
    </Field>
  );
}

/**
 * Which account types can be in another currency than the budget's: all but loans, whose
 * interest, escrow and paired category are budget amounts.
 */
export function allowsOtherCurrency(type: AccountType) {
  return accountFamily(type) !== "loan";
}

export function AddAccountForm({
  settings,
  categories,
  onSubmit,
}: {
  settings: MoneySettings;
  /** The plan's categories, for a loan's pairing step (skipped while they load). */
  categories?: CategoryList;
  onSubmit: (values: NewAccountValues) => Promise<string | null>;
}) {
  const [type, setType] = useState<AccountType>("checking");
  const [picked, setPicked] = useState<CurrencyCode>(settings.currency);
  // Other types use the budget's currency (and the picker hides).
  const currency = allowsOtherCurrency(type) ? picked : settings.currency;
  const money = inCurrency(settings, currency);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<Blob | null>(null);
  const logoPreview = useMemo(() => (logo ? URL.createObjectURL(logo) : undefined), [logo]);
  useEffect(
    () => () => (logoPreview ? URL.revokeObjectURL(logoPreview) : undefined),
    [logoPreview],
  );
  const [balance, setBalance] = useState("");
  const [loan, setLoan] = useState<LoanValues>({
    interestRate: "",
    minimumPayment: "",
    escrowAmount: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pairStep, setPairStep] = useState(false);
  const [pairing, setPairing] = useState<PairChoice>(null);
  const debt = isDebtAccount(type);
  const isLoan = accountFamily(type) === "loan";

  async function handleSubmit(event: FormEvent<HTMLFormElement>, skipPairing = false) {
    event.preventDefault();
    const parsed = parseMoneyInput(balance || "0", money);
    if (typeof parsed === "string") return setError(parsed);
    const loanValues = isLoan ? parseLoan(loan, settings, type) : null;
    if (loanValues && !loanValues.ok) return setError(loanValues.error);
    if (isLoan && categories && !pairStep) {
      setError(null);
      return setPairStep(true);
    }
    if (pairStep && !skipPairing && !pairChoiceReady(pairing)) {
      return setError("Choose a category, or skip this step");
    }
    setPending(true);
    setError(null);
    const message = await onSubmit({
      name: name.trim(),
      type,
      // Debt forms ask for the amount owed; the balance is its negative.
      balance: (debt ? -parsed : parsed).toString(),
      ...(currency !== settings.currency ? { currency } : {}),
      ...(loanValues?.ok
        ? {
            interestRate: loanValues.interestRate ?? undefined,
            minimumPayment: loanValues.minimumPayment ?? undefined,
            escrowAmount: loanValues.escrowAmount ?? undefined,
          }
        : {}),
      ...(pairStep && !skipPairing && pairing ? { pairing } : {}),
      ...(logo ? { logo } : {}),
    });
    setPending(false);
    setError(message);
  }

  if (pairStep && categories) {
    return (
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-1">
          <p className="font-semibold text-sm">Optional: Pair a Category</p>
          <p className="font-medium text-sm">Pair your loan with a plan category</p>
        </div>
        <PairCategoryFields list={categories} value={pairing} onChange={setPairing} />
        {error && <FieldError>{error}</FieldError>}
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => setPairStep(false)}>
            Back
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={(e) => void handleSubmit(e as unknown as FormEvent<HTMLFormElement>, true)}
            >
              Skip
            </Button>
            <Button type="submit" disabled={pending}>
              Next
            </Button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      pending={pending}
      submitLabel={isLoan && categories ? "Next" : "Add account"}
    >
      <Field>
        <FieldLabel htmlFor="account-type">Account type</FieldLabel>
        <NativeSelect
          id="account-type"
          value={type}
          onChange={(e) => setType(e.target.value as AccountType)}
        >
          {TYPE_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.types.map((t) => (
                <NativeSelectOption key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </NativeSelectOption>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="account-name">Nickname</FieldLabel>
        <Input
          id="account-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
        />
      </Field>
      <AccountLogoField
        name={name}
        src={logoPreview}
        onPick={setLogo}
        onRemove={() => setLogo(null)}
      />
      {allowsOtherCurrency(type) && (
        <Field>
          <FieldLabel htmlFor="account-currency">Currency</FieldLabel>
          <CurrencyPicker id="account-currency" value={picked} onChange={setPicked} />
          <FieldDescription>
            {isOnBudget(type)
              ? `Amounts are in this currency; the plan counts them in ${settings.currency} at each transaction's rate.`
              : "Amounts in this account are in its own currency."}
          </FieldDescription>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="account-balance">
          {debt ? "How much do you owe today?" : "What's the balance today?"}
        </FieldLabel>
        <Input
          id="account-balance"
          inputMode="decimal"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          placeholder={toMoneyInput("0", money)}
        />
      </Field>
      {isLoan && <LoanFields values={loan} onChange={setLoan} type={type} adding />}
    </FormShell>
  );
}

export interface AccountEdit {
  name: string;
  note: string;
  type: AccountType;
  interestRate: string | null;
  minimumPayment: string | null;
  escrowAmount: string | null;
  /** Minor units; set only when changed (an adjustment makes up the difference). */
  workingBalance?: string;
}

export function EditAccountForm({
  settings,
  initial,
  workingBalance,
  onSubmit,
  logo,
}: {
  settings: MoneySettings;
  initial: AccountEdit;
  /** The logo field, which saves on its own. */
  logo?: ReactNode;
  /** The account's working balance; null hides the field (closed accounts). */
  workingBalance: bigint | null;
  onSubmit: (values: AccountEdit) => Promise<string | null>;
}) {
  const [name, setName] = useState(initial.name);
  const [balance, setBalance] = useState(toMoneyInput(workingBalance, settings));
  const [note, setNote] = useState(initial.note);
  const [type, setType] = useState(initial.type);
  const [loan, setLoan] = useState<LoanValues>({
    interestRate: initial.interestRate ?? "",
    minimumPayment: toMoneyInput(initial.minimumPayment, settings),
    escrowAmount: toMoneyInput(initial.escrowAmount, settings),
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const family = accountFamily(initial.type);
  const isLoan = family === "loan";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const loanValues = isLoan
      ? parseLoan(loan, settings, type)
      : ({ ok: true, interestRate: null, minimumPayment: null, escrowAmount: null } as const);
    if (!loanValues.ok) return setError(loanValues.error);
    // Taken as typed (signed): a card's "70" is $70 in credit.
    const newBalance = workingBalance === null ? null : parseMoneyInput(balance || "0", settings);
    if (typeof newBalance === "string") return setError(newBalance);
    setPending(true);
    setError(null);
    const message = await onSubmit({
      name: name.trim(),
      note,
      type,
      interestRate: loanValues.interestRate,
      minimumPayment: loanValues.minimumPayment,
      escrowAmount: loanValues.escrowAmount,
      ...(newBalance !== null && newBalance !== workingBalance
        ? { workingBalance: newBalance.toString() }
        : {}),
    });
    setPending(false);
    setError(message);
  }

  return (
    <FormShell onSubmit={handleSubmit} error={error} pending={pending} submitLabel="Save">
      {logo}
      <Field>
        <FieldLabel htmlFor="edit-account-name">Nickname</FieldLabel>
        <Input
          id="edit-account-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="edit-account-type">{isLoan ? "Loan Type" : "Account type"}</FieldLabel>
        <NativeSelect
          id="edit-account-type"
          value={type}
          onChange={(e) => setType(e.target.value as AccountType)}
        >
          {ACCOUNT_TYPES.filter((t) => accountFamily(t) === family).map((t) => (
            <NativeSelectOption key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="edit-account-note">Notes</FieldLabel>
        <Textarea
          id="edit-account-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />
      </Field>
      {workingBalance !== null && (
        <Field>
          <FieldLabel htmlFor="edit-account-balance">{editBalanceLabel(type)}</FieldLabel>
          <Input
            id="edit-account-balance"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
          <FieldDescription>
            An adjustment transaction will be created automatically if you change this amount.
          </FieldDescription>
        </Field>
      )}
      {isLoan && <LoanFields values={loan} onChange={setLoan} type={type} />}
    </FormShell>
  );
}
