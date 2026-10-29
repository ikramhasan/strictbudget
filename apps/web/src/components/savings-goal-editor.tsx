import {
  addMonths,
  type BudgetMonth,
  type CurrencyCode,
  monthBounds,
  saveUpPerMonth,
  saveUpReachedMonth,
  type TargetGoal,
} from "@strictbudget/engine";
import { Button } from "@strictbudget/ui/components/button";
import { Field, FieldError, FieldLabel } from "@strictbudget/ui/components/field";
import { Input } from "@strictbudget/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@strictbudget/ui/components/native-select";
import { RadioGroup, RadioGroupItem } from "@strictbudget/ui/components/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@strictbudget/ui/components/toggle-group";
import { cn } from "@strictbudget/ui/lib/utils";
import { Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  type CategoryTarget,
  GOAL_OPTIONS,
  MONTH_OPTIONS,
  shortMonth,
  type TargetInput,
} from "@/lib/targets";
import { CurrencyPicker } from "./currency-picker";
import type { MoneyIO, TargetCurrency } from "./target-inspector";

/**
 * The savings goal form on a savings category: save up for something (by a date or so much a
 * month), keep a safety fund (topped up all at once or up to so much a month), or keep saving so
 * much a month. Each is saved as the target that works it out (see `TARGET_GOALS`). A preview says
 * what the choice means: what a date asks each month, or when so much a month gets there.
 */
export function SavingsGoalEditor({
  target,
  saved,
  month,
  money,
  currency: currencies,
  onSave,
  onCancel,
  onDelete,
  onOtherTarget,
}: {
  /** The goal being edited; another kind of target starts the form afresh. */
  target: CategoryTarget | null;
  /**
   * What counts toward a save-up goal, in the budget's currency: `before` this month (its progress
   * so far, or for a new goal the money carried in) and this month's Assigned.
   */
  saved: { before: bigint; assigned: bigint };
  /** The month on screen, where the goal starts. */
  month: BudgetMonth;
  /** Amounts in the budget's currency. */
  money: MoneyIO;
  currency?: TargetCurrency;
  onSave: (input: TargetInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
  /** Switches to the usual target form. */
  onOtherTarget: () => void;
}) {
  const existing = target?.goal ? target : null;
  const [goal, setGoal] = useState<TargetGoal>(existing?.goal ?? "save_up");
  const [currency, setCurrency] = useState<CurrencyCode | null>(
    currencies ? (existing?.currency ?? currencies.budgetCurrency) : null,
  );
  const io = currencies && currency ? currencies.moneyIn(currency) : money;
  const foreign = Boolean(currencies && currency && currency !== currencies.budgetCurrency);
  const [goalText, setGoalText] = useState(
    existing?.goalAmount ? io.toInput(existing.goalAmount) : "",
  );
  // Save up's monthly amount, a safety fund's top-up limit, or keep saving's amount.
  const [perMonthText, setPerMonthText] = useState(
    existing &&
      !(existing.goal === "save_up" && existing.cadence === "custom") &&
      existing.amount !== existing.goalAmount
      ? io.toInput(existing.amount)
      : "",
  );
  // A new save-up goal starts with a date: "save $1,500 by June" is how most people put it.
  const [byDate, setByDate] = useState(existing ? existing.cadence === "custom" : true);
  const [dueMonth, setDueMonth] = useState<BudgetMonth>(
    existing?.cadence === "custom" && existing.dueDate
      ? existing.dueDate.slice(0, 7)
      : addMonths(month, 11),
  );
  const [allAtOnce, setAllAtOnce] = useState(
    existing?.goal === "safety_fund" ? existing.amount === existing.goalAmount : false,
  );
  const [error, setError] = useState<{ field: "goal" | "perMonth"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const amountOf = (text: string) => (text.trim() === "" ? null : io.parse(text));
  const goalAmount = amountOf(goalText);
  const perMonth = amountOf(perMonthText);
  const asked = {
    goal: goal !== "keep_saving",
    perMonth:
      goal === "keep_saving" ||
      (goal === "save_up" && !byDate) ||
      (goal === "safety_fund" && !allAtOnce),
  };

  function check(): TargetInput | { field: "goal" | "perMonth"; text: string } {
    if (asked.goal) {
      if (typeof goalAmount === "string") return { field: "goal", text: goalAmount };
      if (!goalAmount || goalAmount <= 0n)
        return { field: "goal", text: "Enter how much you want to have." };
    }
    if (asked.perMonth) {
      if (typeof perMonth === "string") return { field: "perMonth", text: perMonth };
      if (!perMonth || perMonth <= 0n)
        return { field: "perMonth", text: "Enter how much to put in each month." };
      if (asked.goal && typeof goalAmount === "bigint" && perMonth > goalAmount) {
        return { field: "perMonth", text: "That's more than the goal itself." };
      }
    }
    const total = (goalAmount as bigint | null)?.toString() ?? "";
    const each = (perMonth as bigint | null)?.toString() ?? "";
    switch (goal) {
      case "save_up":
        return byDate
          ? {
              cadence: "custom",
              behavior: "set_aside",
              amount: total,
              goalAmount: total,
              dueDate: monthBounds(dueMonth).end,
              repeat: null,
              goal,
            }
          : {
              cadence: "monthly",
              behavior: "set_aside",
              amount: each,
              goalAmount: total,
              dueDay: null,
              goal,
            };
      case "safety_fund":
        return {
          cadence: "monthly",
          behavior: "refill",
          amount: allAtOnce ? total : each,
          goalAmount: total,
          dueDay: null,
          goal,
        };
      case "keep_saving":
        return { cadence: "monthly", behavior: "set_aside", amount: each, dueDay: null, goal };
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = check();
    if ("field" in result) return setError(result);
    setError(null);
    setBusy(true);
    try {
      await onSave({ ...result, ...(currency && { currency }) });
    } finally {
      setBusy(false);
    }
  }

  const preview = goalPreview({
    goal,
    byDate,
    allAtOnce,
    month,
    dueMonth,
    saved,
    // Previews add up in the budget's currency, so a goal in another one gets none.
    goalAmount: !foreign && typeof goalAmount === "bigint" ? goalAmount : null,
    perMonth: !foreign && typeof perMonth === "bigint" ? perMonth : null,
    format: money.format,
  });
  const [dueYear, dueMonthNumber] = dueMonth.split("-").map(Number) as [number, number];
  const thisYear = Number(month.slice(0, 4));

  return (
    <section
      aria-label="Savings goal"
      className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t pt-3"
    >
      <h3 className="font-semibold text-sm">Savings Goal</h3>
      <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <RadioGroup
          aria-label="What kind of goal"
          value={goal}
          onValueChange={(value) => {
            setGoal(value as TargetGoal);
            setError(null);
          }}
          className="gap-1.5"
        >
          {GOAL_OPTIONS.map((o) => (
            <label
              key={o.value}
              htmlFor={`goal-${o.value}`}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors",
                o.value === goal ? "border-primary bg-primary/5" : "hover:bg-muted/60",
              )}
            >
              <RadioGroupItem id={`goal-${o.value}`} value={o.value} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-medium text-sm">{o.label}</span>
                <span className="text-muted-foreground text-xs">{o.use}</span>
              </span>
            </label>
          ))}
        </RadioGroup>

        {asked.goal && (
          <Field>
            <FieldLabel htmlFor="goal-amount">
              {goal === "save_up"
                ? "How much do you want to save?"
                : "How much do you want to keep?"}
            </FieldLabel>
            <Input
              id="goal-amount"
              inputMode="decimal"
              autoFocus
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              aria-invalid={error?.field === "goal" ? true : undefined}
            />
            {error?.field === "goal" && <FieldError>{error.text}</FieldError>}
          </Field>
        )}

        {goal === "save_up" && (
          <ToggleGroup
            type="single"
            size="sm"
            spacing={0}
            aria-label="How to get there"
            value={byDate ? "date" : "monthly"}
            onValueChange={(value) => value && setByDate(value === "date")}
            className="w-full"
          >
            <ToggleGroupItem value="date" className="flex-1">
              By a date
            </ToggleGroupItem>
            <ToggleGroupItem value="monthly" className="flex-1">
              So much a month
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {goal === "safety_fund" && (
          <ToggleGroup
            type="single"
            size="sm"
            spacing={0}
            aria-label="How to top it up"
            value={allAtOnce ? "all" : "monthly"}
            onValueChange={(value) => value && setAllAtOnce(value === "all")}
            className="w-full"
          >
            <ToggleGroupItem value="monthly" className="flex-1">
              A little each month
            </ToggleGroupItem>
            <ToggleGroupItem value="all" className="flex-1">
              All at once
            </ToggleGroupItem>
          </ToggleGroup>
        )}

        {goal === "save_up" && byDate && (
          <Field>
            <FieldLabel htmlFor="goal-month">By</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              <NativeSelect
                id="goal-month"
                className="w-full"
                value={String(dueMonthNumber)}
                onChange={(e) => setDueMonth(`${dueYear}-${e.target.value.padStart(2, "0")}`)}
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
                  setDueMonth(`${e.target.value}-${String(dueMonthNumber).padStart(2, "0")}`)
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

        {asked.perMonth && (
          <Field>
            <FieldLabel htmlFor="goal-per-month">
              {goal === "safety_fund" ? "Most to put in each month" : "How much each month?"}
            </FieldLabel>
            <Input
              id="goal-per-month"
              inputMode="decimal"
              autoFocus={goal === "keep_saving"}
              value={perMonthText}
              onChange={(e) => setPerMonthText(e.target.value)}
              aria-invalid={error?.field === "perMonth" ? true : undefined}
            />
            {error?.field === "perMonth" && <FieldError>{error.text}</FieldError>}
          </Field>
        )}

        {currencies && currency && (
          <Field>
            <FieldLabel htmlFor="goal-currency">Currency</FieldLabel>
            <CurrencyPicker id="goal-currency" value={currency} onChange={setCurrency} />
            {foreign && (
              <p className="text-muted-foreground text-xs">
                Amounts are converted into {currencies.budgetCurrency} at today's rate.
              </p>
            )}
          </Field>
        )}

        {preview && (
          <p className="rounded-md bg-muted p-2.5 text-sm" aria-live="polite">
            {preview}
          </p>
        )}

        <button
          type="button"
          onClick={onOtherTarget}
          className="w-fit text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
        >
          Use another kind of target
        </button>

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
            Save Goal
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * What the form's choice means, in words: "That's $250.00 a month, starting this month." (by a
 * date), "At $250.00 a month you'll get there by Aug 2027." (so much a month), how a safety fund
 * asks, and that keep saving counts as saved in reports. Null until there's enough to say it.
 */
export function goalPreview({
  goal,
  byDate,
  allAtOnce,
  month,
  dueMonth,
  saved,
  goalAmount,
  perMonth,
  format,
}: {
  goal: TargetGoal;
  byDate: boolean;
  allAtOnce: boolean;
  month: BudgetMonth;
  dueMonth: BudgetMonth;
  saved: { before: bigint; assigned: bigint };
  goalAmount: bigint | null;
  perMonth: bigint | null;
  format: (minorUnits: string) => string;
}): string | null {
  const f = (amount: bigint) => format(amount.toString());
  if (goal === "keep_saving") {
    return "Money you take out of this category counts as saved, not spent, in your reports.";
  }
  if (!goalAmount || goalAmount <= 0n) return null;
  if (goal === "safety_fund") {
    if (allAtOnce) {
      return `Whenever it's below ${f(goalAmount)}, it asks for what brings it back up.`;
    }
    if (!perMonth || perMonth <= 0n) return null;
    return `It asks for up to ${f(perMonth)} a month until it holds ${f(goalAmount)}, and again after you use it.`;
  }
  // The plan's own sums: this month asks for its share of what was left before it.
  const before = saved.before > 0n ? saved.before : 0n;
  const inNow = before + saved.assigned;
  const already = inNow > 0n ? ` ${f(inNow)} is in it already.` : "";
  if (goalAmount - inNow <= 0n) return "You've already saved that much.";
  if (byDate) {
    if (dueMonth < month) return "Choose this month or later.";
    const each = saveUpPerMonth(goalAmount - before, month, dueMonth);
    const months =
      dueMonth === month ? "this month" : `a month until ${shortMonth(`${dueMonth}-01`)}`;
    return `That's ${f(each)} ${months}.${already}`;
  }
  if (!perMonth || perMonth <= 0n) return null;
  const share = goalAmount - before < perMonth ? goalAmount - before : perMonth;
  const stillAsked = share > saved.assigned ? share - saved.assigned : 0n;
  const reached = saveUpReachedMonth(goalAmount - inNow, perMonth, month, stillAsked);
  if (!reached) return null;
  const when = reached === month ? "this month" : `by ${shortMonth(`${reached}-01`)}`;
  return `At ${f(perMonth)} a month you'll get there ${when}.${already}`;
}
