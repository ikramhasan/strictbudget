import { type CurrencyCode, type DateFormat, targetPercent } from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { Field, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { Label } from "@strictbudget/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@strictbudget/ui/components/popover";
import { Switch } from "@strictbudget/ui/components/switch";
import { cn } from "@strictbudget/ui/lib/utils";
import { Check, CircleHelp, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { todayIso } from "@/lib/dates";
import type { LoanPlan } from "@/lib/loan-planner";
import {
  type CategoryTarget,
  DUE_DAY_OPTIONS,
  isPaymentTarget,
  MONTH_OPTIONS,
  PAYMENT_TARGET_OPTIONS,
  paymentTargetKind,
  payoffAmount,
  type TargetInput,
  type TargetNeed,
  targetDueLine,
  targetHeading,
  targetLines,
  targetMessage,
  WEEKDAY_OPTIONS,
} from "@/lib/targets";
import { CurrencyPicker } from "./currency-picker";
import { DebtTargetEditor } from "./debt-target-editor";
import { DateField } from "./register-fields";

type Format = (minorUnits: string) => string;
export interface MoneyIO {
  format: Format;
  parse: (text: string) => bigint | string;
  toInput: (amount: string) => string;
}
/**
 * A target in its own currency: the budget's currency, `moneyIn` for amounts in any
 * currency, and this month's conversion of the target (null when it's in the budget's currency).
 * `rateMissing`: no rate is known, so the target's need is unknown.
 */
export interface TargetCurrency {
  budgetCurrency: CurrencyCode;
  moneyIn: (currency: CurrencyCode) => MoneyIO;
  conversion: { amountInBase: string; rate: string } | null;
  rateMissing: boolean;
}
type Cadence = Exclude<
  CategoryTarget["cadence"],
  "payment_monthly" | "payoff_by_date" | "debt_monthly"
>;
type Behavior = CategoryTarget["behavior"];

const CADENCES: { value: Cadence; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom" },
];

const CHOICES = {
  set_aside: { use: "Use for: bills, subscriptions, saving over time" },
  refill: { use: "Use for: gasoline, fun money, dining out" },
  balance: { use: "Use for: long-term savings" },
} as const;

function choiceLabel(cadence: Cadence, behavior: Behavior, amount: string) {
  const perWeek = cadence === "weekly" ? "/week" : "";
  if (behavior === "balance") return `Have a balance of ${amount}`;
  if (cadence === "custom")
    return behavior === "set_aside" ? `Set aside ${amount}` : `Fill up to ${amount}`;
  return behavior === "set_aside"
    ? `Set aside another ${amount}${perWeek}`
    : `Refill up to ${amount}${perWeek}`;
}

/**
 * `need` is null before the target's start month (and after a one-time target's due month), which
 * shows the invitation to create one.
 *
 * A credit card's payment category (`payment`) takes the two payment targets instead. While none
 * applies, or while the category is red, the payment alert shows in its place.
 */
export function TargetSection({
  name,
  target,
  need,
  format,
  parse,
  toInput,
  dateFormat,
  onSave,
  onDelete,
  onAssign,
  onSnooze,
  snoozeLocked = false,
  payment,
  debt,
  currency,
}: {
  name: string;
  target: CategoryTarget | null;
  need: TargetNeed | null;
  format: Format;
  parse: (text: string) => bigint | string;
  toInput: (amount: string) => string;
  dateFormat: DateFormat;
  onSave: (input: TargetInput) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  /** Assigns what's still to go this month; undefined when the month can't take money. */
  onAssign?: (amount: bigint) => Promise<void>;
  /** Undefined outside the current month: only the current month can be snoozed. */
  onSnooze?: (snoozed: boolean) => Promise<void>;
  /** Outside the current month the snooze switch still shows, disabled. */
  snoozeLocked?: boolean;
  /**
   * For a payment category: the month on screen (the target is saved from it), its Funded
   * Spending and Payments Made, whether it's red, and its alert.
   */
  payment?: {
    month: string;
    fundedSpending: string;
    paymentsMade: string;
    overpaid: boolean;
    /** A month before the current one: no Payment alert there, only "Create Target". */
    past: boolean;
    alert: (createTarget: () => void) => ReactNode;
  };
  /** For a category paired with a loan: the loan's plan (null while it loads) replaces the form. */
  debt?: { plan: LoanPlan | null; unpairedCategoryId?: string };
  /** Spending targets can be in their own currency; without this, the budget's only. */
  currency?: TargetCurrency;
}) {
  const [editing, setEditing] = useState(false);
  // The target's own amounts read in its currency; what it needs (converted) in the budget's.
  const targetFormat =
    target && currency && target.currency !== currency.budgetCurrency
      ? currency.moneyIn(target.currency).format
      : format;
  const title = debt ? "Debt Payment Target" : "Target";
  if (editing && debt) {
    return (
      <DebtTargetEditor
        target={target}
        plan={debt.plan}
        unpairedCategoryId={debt.unpairedCategoryId}
        format={format}
        parse={parse}
        toInput={toInput}
        onCancel={() => setEditing(false)}
        onSave={async (input) => {
          if (await onSave(input)) setEditing(false);
        }}
        onDelete={
          target
            ? async () => {
                if (await onDelete()) setEditing(false);
              }
            : undefined
        }
      />
    );
  }
  if (editing && payment) {
    return (
      <PaymentTargetEditor
        target={target}
        parse={parse}
        toInput={toInput}
        onCancel={() => setEditing(false)}
        onSave={async (input) => {
          if (await onSave(input)) setEditing(false);
        }}
        onDelete={
          target
            ? async () => {
                if (await onDelete()) setEditing(false);
              }
            : undefined
        }
      />
    );
  }
  if (payment && !payment.past && (!target || !need || payment.overpaid)) {
    return payment.alert(() => setEditing(true));
  }
  if (editing) {
    return (
      <TargetEditor
        target={target}
        format={format}
        parse={parse}
        toInput={toInput}
        currency={currency}
        dateFormat={dateFormat}
        onCancel={() => setEditing(false)}
        onSave={async (input) => {
          if (await onSave(input)) setEditing(false);
        }}
        onDelete={
          target
            ? async () => {
                if (await onDelete()) setEditing(false);
              }
            : undefined
        }
      />
    );
  }
  if (target && currency?.rateMissing) {
    // Without a rate to the budget's currency, what the target needs is unknown.
    return (
      <Section title={title}>
        <p className="font-medium text-sm">{targetHeading(target, targetFormat(target.amount))}</p>
        <p className="text-muted-foreground text-sm">
          No {target.currency} to {currency.budgetCurrency} exchange rate is available yet, so this
          target can't say what it needs. It's left out of Underfunded until there is one.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          Edit Target
        </Button>
      </Section>
    );
  }
  if (!target || !need) {
    return (
      <Section title={title}>
        <p className="font-medium text-sm">How much do you need for {name}?</p>
        <p className="text-muted-foreground text-sm">
          When you create a target, we'll let you know how much money to set aside to stay on track
          over time.
        </p>
        <Button size="sm" variant="secondary" className="w-fit" onClick={() => setEditing(true)}>
          Create Target
        </Button>
      </Section>
    );
  }

  const percent = targetPercent({ needed: BigInt(need.needed), funded: BigInt(need.funded) });
  const message = targetMessage(target, need, format, payment?.month);
  const met = BigInt(need.funded) >= BigInt(need.needed);
  const kind = paymentTargetKind(target);
  const headingAmount = (target.cadence === "payoff_by_date" ? format : targetFormat)(
    target.cadence === "payoff_by_date"
      ? payoffAmount(need, payment?.paymentsMade ?? "0")
      : target.amount,
  );
  const converted = currency?.conversion;
  return (
    <Section title={title}>
      {kind && <p className="font-medium text-sm">{kind}</p>}
      <div className="grid gap-0.5">
        <p className="font-medium text-sm">{targetHeading(target, headingAmount)}</p>
        <p className="text-muted-foreground text-xs">{targetDueLine(target, need)}</p>
        {converted && (
          <p
            className="text-muted-foreground text-xs"
            title={`1 ${target.currency} = ${converted.rate} ${currency?.budgetCurrency}`}
          >
            ≈ {format(converted.amountInBase)} at today's rate
          </p>
        )}
      </div>
      {met ? (
        <MetRing />
      ) : (
        // Green once this month asks for nothing more (also past the due date), yellow while it does.
        <ProgressRing percent={percent} green={need.underfunded === "0"} />
      )}
      {message && "text" in message && (
        // Met and on track both sit in green.
        <p className="rounded-md bg-green-100 p-3 text-center font-medium text-green-950 text-sm dark:bg-green-900/40 dark:text-green-50">
          {message.text}
        </p>
      )}
      {message && "prompt" in message && (
        <div className="grid gap-2 rounded-md bg-yellow-100 p-3 text-center text-sm text-yellow-950 dark:bg-yellow-900/40 dark:text-yellow-50">
          <p>
            Assign{" "}
            <span className="rounded bg-yellow-300/70 px-1 font-semibold dark:bg-yellow-700/70">
              {message.prompt}
            </span>
            {message.suffix}
          </p>
          {onAssign && (
            <Button
              size="sm"
              className="bg-yellow-400 text-yellow-950 hover:bg-yellow-500"
              onClick={() => onAssign(BigInt(need.underfunded))}
            >
              Assign
            </Button>
          )}
        </div>
      )}
      <dl className="grid gap-1 text-sm">
        {targetLines(target, need, format, payment?.fundedSpending).map((line) => (
          <Row
            key={line.label}
            label={line.label}
            value={line.value}
            className={line.label === "To Go" ? "border-t pt-2" : undefined}
          />
        ))}
      </dl>
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
        Edit Target
      </Button>
      {(onSnooze || (snoozeLocked && !payment)) && (
        // The target's details stay on show while it's snoozed.
        <div className="flex items-center gap-1">
          <Label
            className={cn(
              "flex items-center gap-2 font-normal text-sm",
              !onSnooze && "text-muted-foreground",
            )}
            title={onSnooze ? undefined : "You can only snooze targets in the current month."}
          >
            <Switch
              checked={need.snoozed}
              disabled={!onSnooze}
              onCheckedChange={(checked) => void onSnooze?.(checked)}
            />
            Snooze target for this month
          </Label>
          <SnoozeHelp />
        </div>
      )}
    </Section>
  );
}

/** Opens on click. */
function SnoozeHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label="About snoozing"
        >
          <CircleHelp />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 text-sm">
        <p className="font-medium">Snooze Target</p>
        <p className="text-muted-foreground">
          When you snooze a Target, strictbudget will treat the category as if it didn't have a
          Target (which means the category won't show as underfunded). At the start of next month,
          your Target will reactivate, well-rested and in a very good mood!
        </p>
      </PopoverContent>
    </Popover>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t pt-3">
      <h3 className="font-semibold text-sm">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-2", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function MetRing() {
  return (
    <div
      role="img"
      aria-label="Target met"
      className="mx-auto grid size-16 place-items-center rounded-full border-4 border-muted bg-green-600 text-white"
    >
      <Check className="size-8" strokeWidth={3} aria-hidden />
    </div>
  );
}

function ProgressRing({ percent, green }: { percent: number; green: boolean }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto size-16">
      <svg
        viewBox="0 0 64 64"
        className="size-16 -rotate-90"
        role="img"
        aria-label={`${percent}% of the target funded`}
      >
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-muted" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
          className={green ? "stroke-green-500" : "stroke-yellow-400"}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-semibold text-sm">
        {percent}%
      </span>
    </div>
  );
}

/** The default due date for a new dated target. */
function firstOfNextMonth() {
  const [y, m] = todayIso().split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function TargetEditor({
  target,
  format: budgetFormat,
  parse: budgetParse,
  toInput: budgetToInput,
  currency: currencies,
  dateFormat,
  onSave,
  onCancel,
  onDelete,
}: {
  target: CategoryTarget | null;
  format: Format;
  parse: (text: string) => bigint | string;
  toInput: (amount: string) => string;
  currency?: TargetCurrency;
  dateFormat: DateFormat;
  onSave: (input: TargetInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const nextMonth = firstOfNextMonth();
  // The target's currency (the budget's by default); its amount is typed in it.
  const [currency, setCurrency] = useState<CurrencyCode | null>(
    currencies ? (target?.currency ?? currencies.budgetCurrency) : null,
  );
  const { format, parse, toInput } =
    currencies && currency
      ? currencies.moneyIn(currency)
      : { format: budgetFormat, parse: budgetParse, toInput: budgetToInput };
  const [cadence, setCadence] = useState<Cadence>(
    target && !isPaymentTarget(target) ? (target.cadence as Cadence) : "monthly",
  );
  const [amountText, setAmountText] = useState(target ? toInput(target.amount) : "");
  const [behavior, setBehavior] = useState<Behavior>(target?.behavior ?? "set_aside");
  // Monthly: "last" or a day; weekly: a weekday (today's by default).
  const [dueDay, setDueDay] = useState(
    target?.cadence === "monthly" && target.dueDay !== null ? String(target.dueDay) : "last",
  );
  const [weekday, setWeekday] = useState(
    target?.cadence === "weekly" ? (target.dueDay ?? 0) : new Date().getDay(),
  );
  const [dueDate, setDueDate] = useState(target?.dueDate ?? nextMonth);
  const [repeat, setRepeat] = useState(target ? target.repeatEvery !== null : true);
  const [repeatEvery, setRepeatEvery] = useState(target?.repeatEvery ?? 1);
  const [repeatUnit, setRepeatUnit] = useState<"month" | "year">(target?.repeatUnit ?? "month");
  const [byDate, setByDate] = useState(target?.behavior === "balance" && target.dueDate !== null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = amountText.trim() === "" ? 0n : parse(amountText);
  const shown = format((typeof parsed === "bigint" ? parsed : 0n).toString());
  // Balance is a custom-only choice; leaving Custom falls back to Set aside.
  const choice: Behavior = cadence !== "custom" && behavior === "balance" ? "set_aside" : behavior;
  const choices: Behavior[] =
    cadence === "custom" ? ["set_aside", "refill", "balance"] : ["set_aside", "refill"];

  function input(amount: string): TargetInput {
    switch (cadence) {
      case "weekly":
        return { cadence, behavior: choice as "set_aside", amount, dueDay: weekday };
      case "monthly":
        return {
          cadence,
          behavior: choice as "set_aside",
          amount,
          dueDay: dueDay === "last" ? null : Number(dueDay),
        };
      case "yearly":
        return { cadence, behavior: choice as "set_aside", amount, dueDate };
      default:
        return choice === "balance"
          ? { cadence, behavior: choice, amount, dueDate: byDate ? dueDate : null, repeat: null }
          : {
              cadence,
              behavior: choice,
              amount,
              dueDate,
              repeat: repeat ? { every: repeatEvery, unit: repeatUnit } : null,
            };
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (typeof parsed === "string") return setError(parsed);
    if (parsed <= 0n) return setError("Enter how much you need.");
    setError(null);
    setBusy(true);
    try {
      await onSave({ ...input(parsed.toString()), ...(currency && { currency }) });
    } finally {
      setBusy(false);
    }
  }

  const behaviorLabel =
    cadence === "weekly" || cadence === "monthly"
      ? "Next month I want to"
      : cadence === "yearly"
        ? "Next year I want to"
        : "I want to";
  const dateValue = choice === "balance" ? dueDate.slice(0, 7) : dueDate;
  const [dueYear, dueMonth] = dateValue.split("-").map(Number) as [number, number];
  const thisYear = Number(todayIso().slice(0, 4));

  return (
    <section aria-label="Target" className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t pt-3">
      <h3 className="font-semibold text-sm">Target</h3>
      <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <fieldset className="grid min-w-0 grid-cols-4 rounded-lg bg-muted p-0.5 text-xs">
          <legend className="sr-only">How often</legend>
          {CADENCES.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={c.value === cadence}
              onClick={() => setCadence(c.value)}
              className={cn(
                "rounded-md px-1 py-1",
                c.value === cadence
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </fieldset>
        <Field>
          <FieldLabel htmlFor="target-amount">
            {cadence === "custom" ? "Amount" : "I need"}
          </FieldLabel>
          <Input
            id="target-amount"
            autoFocus
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        {currencies && currency && (
          <Field>
            <FieldLabel htmlFor="target-currency">Currency</FieldLabel>
            <CurrencyPicker id="target-currency" value={currency} onChange={setCurrency} />
            {currency !== currencies.budgetCurrency && (
              <p className="text-muted-foreground text-xs">
                Needs are converted into {currencies.budgetCurrency} at today's rate.
              </p>
            )}
          </Field>
        )}
        {cadence === "weekly" && (
          <Field>
            <FieldLabel htmlFor="target-weekday">Every</FieldLabel>
            <NativeSelect
              id="target-weekday"
              className="w-full"
              value={String(weekday)}
              onChange={(e) => setWeekday(Number(e.target.value))}
            >
              {WEEKDAY_OPTIONS.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
        {cadence === "monthly" && (
          <Field>
            <FieldLabel htmlFor="target-due">By</FieldLabel>
            <NativeSelect
              id="target-due"
              className="w-full"
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
            >
              {DUE_DAY_OPTIONS.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
        {cadence === "yearly" && (
          <Field>
            <FieldLabel>By</FieldLabel>
            <div className="min-w-0 [&_input]:min-w-0">
              <DateField value={dueDate} onChange={setDueDate} format={dateFormat} />
            </div>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="target-behavior">{behaviorLabel}</FieldLabel>
          <NativeSelect
            id="target-behavior"
            className="w-full"
            value={choice}
            onChange={(e) => setBehavior(e.target.value as Behavior)}
          >
            {choices.map((b) => (
              <NativeSelectOption key={b} value={b}>
                {choiceLabel(cadence, b, shown)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="text-muted-foreground text-xs">{CHOICES[choice].use}</p>
        </Field>
        {cadence === "custom" && choice !== "balance" && (
          <>
            <Field>
              <FieldLabel>Due on</FieldLabel>
              <div className="min-w-0 [&_input]:min-w-0">
                <DateField value={dueDate} onChange={setDueDate} format={dateFormat} />
              </div>
            </Field>
            <div className="flex items-center gap-2 text-sm">
              <Switch id="target-repeat-on" checked={repeat} onCheckedChange={setRepeat} />
              <Label htmlFor="target-repeat-on">Repeat</Label>
            </div>
            {repeat && (
              <Field>
                <FieldLabel htmlFor="target-repeat">Every</FieldLabel>
                <div className="grid grid-cols-2 gap-2">
                  <NativeSelect
                    id="target-repeat"
                    className="w-full"
                    value={String(repeatEvery)}
                    onChange={(e) => setRepeatEvery(Number(e.target.value))}
                  >
                    {Array.from({ length: repeatUnit === "year" ? 2 : 11 }, (_, i) => i + 1).map(
                      (n) => (
                        <NativeSelectOption key={n} value={n}>
                          {n}
                        </NativeSelectOption>
                      ),
                    )}
                  </NativeSelect>
                  <NativeSelect
                    aria-label="Month or year"
                    className="w-full"
                    value={repeatUnit}
                    onChange={(e) => {
                      const unit = e.target.value as "month" | "year";
                      setRepeatUnit(unit);
                      if (unit === "year" && repeatEvery > 2) setRepeatEvery(1);
                    }}
                  >
                    <NativeSelectOption value="month">Month</NativeSelectOption>
                    <NativeSelectOption value="year">Year</NativeSelectOption>
                  </NativeSelect>
                </div>
              </Field>
            )}
          </>
        )}
        {cadence === "custom" && choice === "balance" && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Switch id="target-by-date" checked={byDate} onCheckedChange={setByDate} />
              <Label htmlFor="target-by-date">Due by date</Label>
            </div>
            {byDate && (
              <Field>
                <FieldLabel htmlFor="target-balance-month">Due on</FieldLabel>
                <div className="grid grid-cols-2 gap-2">
                  <NativeSelect
                    id="target-balance-month"
                    className="w-full"
                    value={String(dueMonth)}
                    onChange={(e) => setDueDate(`${dueYear}-${e.target.value.padStart(2, "0")}-01`)}
                  >
                    {MONTH_OPTIONS.map((o) => (
                      <NativeSelectOption key={o.value} value={o.value}>
                        {o.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    aria-label="Year"
                    className="w-full"
                    value={String(dueYear)}
                    onChange={(e) =>
                      setDueDate(`${e.target.value}-${String(dueMonth).padStart(2, "0")}-01`)
                    }
                  >
                    {Array.from({ length: 50 }, (_, i) => thisYear + i).map((y) => (
                      <NativeSelectOption key={y} value={y}>
                        {y}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              </Field>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onDelete();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 /> Delete
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            Save Target
          </Button>
        </div>
      </form>
    </section>
  );
}

/** YYYY-MM, the default month for a new pay-off target. */
const nextMonthValue = () => firstOfNextMonth().slice(0, 7);

function PaymentTargetEditor({
  target,
  parse,
  toInput,
  onSave,
  onCancel,
  onDelete,
}: {
  target: CategoryTarget | null;
  parse: (text: string) => bigint | string;
  toInput: (amount: string) => string;
  onSave: (input: TargetInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [cadence, setCadence] = useState<"payoff_by_date" | "payment_monthly">(
    target?.cadence === "payment_monthly" ? "payment_monthly" : "payoff_by_date",
  );
  const [amountText, setAmountText] = useState(
    target?.cadence === "payment_monthly" ? toInput(target.amount) : "",
  );
  const [dueMonth, setDueMonth] = useState(
    target?.cadence === "payoff_by_date" && target.dueDate
      ? target.dueDate.slice(0, 7)
      : nextMonthValue(),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [year, month] = dueMonth.split("-").map(Number) as [number, number];
  const thisYear = Number(todayIso().slice(0, 4));

  async function submit(e: FormEvent) {
    e.preventDefault();
    let input: TargetInput;
    if (cadence === "payment_monthly") {
      const parsed = amountText.trim() === "" ? 0n : parse(amountText);
      if (typeof parsed === "string") return setError(parsed);
      if (parsed <= 0n) return setError("Enter how much you want to pay each month.");
      input = { cadence, amount: parsed.toString() };
    } else {
      // A pay-off month before today's would be dropped, even when saved from an earlier month.
      if (dueMonth < todayIso().slice(0, 7)) return setError("Choose this month or later.");
      input = { cadence, dueMonth };
    }
    setError(null);
    setBusy(true);
    try {
      await onSave(input);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Target" className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t pt-3">
      <h3 className="font-semibold text-sm">Target</h3>
      <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <NativeSelect
          aria-label="Target type"
          className="w-full"
          value={cadence}
          onChange={(e) => {
            setCadence(e.target.value as typeof cadence);
            setError(null);
          }}
        >
          {PAYMENT_TARGET_OPTIONS.map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {cadence === "payoff_by_date" ? (
          // The month gets the wider share so "September" fits.
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
            <NativeSelect
              aria-label="Month"
              className="w-full"
              value={String(month)}
              onChange={(e) => setDueMonth(`${year}-${e.target.value.padStart(2, "0")}`)}
            >
              {MONTH_OPTIONS.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Year"
              className="w-full"
              value={String(year)}
              onChange={(e) => setDueMonth(`${e.target.value}-${String(month).padStart(2, "0")}`)}
            >
              {Array.from({ length: 50 }, (_, i) => thisYear + i).map((y) => (
                <NativeSelectOption key={y} value={y}>
                  {y}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <Field>
            <FieldLabel htmlFor="target-amount" className="sr-only">
              Amount
            </FieldLabel>
            <Input
              id="target-amount"
              autoFocus
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </Field>
        )}
        {error && <FieldError>{error}</FieldError>}
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mx-auto text-destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDelete();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 /> Delete
          </Button>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            Save Target
          </Button>
        </div>
      </form>
    </section>
  );
}
