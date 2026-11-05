import type { components } from "@strictbudget/api-client";
import { type BudgetMonth, monthBounds } from "@strictbudget/engine";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { $api } from "./api";
import { apiErrorMessage } from "./budgets";
import { categoriesQueryOptions } from "./categories";
import { todayIso } from "./dates";
import { invalidateMonths } from "./months";
import type { UndoCommand } from "./undo";

export type CategoryTarget = NonNullable<components["schemas"]["CategoryTarget"]>;
export type TargetNeed = NonNullable<components["schemas"]["TargetNeed"]>;
type SetTargetBody = components["schemas"]["SetCategoryTarget"];
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A target as the editor saves it, one shape per cadence. */
export type TargetInput = DistributiveOmit<SetTargetBody, "month" | "today">;
type Format = (minorUnits: string) => string;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export const WEEKDAY_OPTIONS = WEEKDAYS.map((label, value) => ({ value, label }));
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
export const MONTH_OPTIONS = MONTHS.map((label, i) => ({ value: i + 1, label }));

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/**
 * The day a monthly target is due in `month`: its due day, or the month's last day ("by the 31st"
 * in October, "by the 30th" in November). A day past the month's end is the last day.
 */
export function dueDayIn(dueDay: number | null, month: BudgetMonth) {
  const last = Number(monthBounds(month).end.slice(8));
  return dueDay === null || dueDay > last ? last : dueDay;
}

/** The days the "By" list offers, in order: Last day of month, then 31st down to 1st. */
export const DUE_DAY_OPTIONS: { value: string; label: string }[] = [
  { value: "last", label: "Last day of month" },
  ...Array.from({ length: 31 }, (_, i) => 31 - i).map((d) => ({
    value: String(d),
    label: ordinal(d),
  })),
];

const monthLabel = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1] ?? "";
/** "Dec 30 2026". */
export const shortDate = (iso: string) =>
  `${monthLabel(iso).slice(0, 3)} ${Number(iso.slice(8))} ${iso.slice(0, 4)}`;
/** "Dec 2026", for a balance target's month. */
const shortMonth = (iso: string) => `${monthLabel(iso).slice(0, 3)} ${iso.slice(0, 4)}`;

/**
 * Whether a target spreads a total over months up to a due date (yearly, custom, dated balance,
 * a card's pay off by date).
 */
export const isDated = (target: Pick<CategoryTarget, "cadence">) =>
  target.cadence === "yearly" || target.cadence === "custom" || target.cadence === "payoff_by_date";

/** Whether a target is one of a credit card payment category's two. */
export const isPaymentTarget = (target: Pick<CategoryTarget, "cadence">) =>
  target.cadence === "payment_monthly" || target.cadence === "payoff_by_date";

/** The payment targets' names, in the form's order (Pay Off Balance by Date first). */
export const PAYMENT_TARGET_OPTIONS = [
  { value: "payoff_by_date", label: "Pay off balance by date" },
  { value: "payment_monthly", label: "Pay specific amount monthly" },
] as const;

/** Whether a target is a loan's Monthly Debt Payment (only on a category paired with a loan). */
export const isDebtTarget = (target: Pick<CategoryTarget, "cadence">) =>
  target.cadence === "debt_monthly";

/** A payment or debt target's kind, shown above the inspector's heading ("Monthly debt payment"). */
export function paymentTargetKind(target: CategoryTarget) {
  if (isDebtTarget(target)) return "Monthly debt payment";
  return PAYMENT_TARGET_OPTIONS.find((o) => o.value === target.cadence)?.label ?? null;
}

/** " each month", " every 2 months", " each year", " every 2 years", or "" for a one-time target. */
function repeatPhrase(target: Pick<CategoryTarget, "repeatEvery" | "repeatUnit">) {
  if (!target.repeatEvery || !target.repeatUnit) return "";
  const unit = target.repeatUnit === "year" ? "year" : "month";
  return target.repeatEvery === 1 ? ` each ${unit}` : ` every ${target.repeatEvery} ${unit}s`;
}

/**
 * The inspector heading: "Set aside another $100.00 each month", "Refill up to $10.00 each week",
 * "Set aside another $300.00 every 2 months", "Have a balance of $300.00". Payment targets: "$30.00"
 * (Pay Specific Amount Monthly) and "Pay off $125.00" (Pay Off Balance by Date, `amount` being
 * what's still to pay off: what the target needs).
 */
export function targetHeading(target: CategoryTarget, amount: string) {
  if (target.cadence === "payment_monthly") return amount;
  if (target.cadence === "debt_monthly") return `${amount} needed each month`;
  if (target.cadence === "payoff_by_date") return `Pay off ${amount}`;
  if (target.behavior === "balance") return `Have a balance of ${amount}`;
  const suffix =
    target.cadence === "weekly"
      ? " each week"
      : target.cadence === "monthly"
        ? " each month"
        : target.cadence === "yearly"
          ? " each year"
          : repeatPhrase(target);
  if (target.behavior === "set_aside") return `Set aside another ${amount}${suffix}`;
  // "Fill up to $200.00", then "By Sep 8 2026".
  return target.cadence === "custom"
    ? `Fill up to ${amount}${suffix}`
    : `Refill up to ${amount}${suffix}`;
}

/**
 * The line under the heading: "By the end of the month", "By the 15th of the month", "By Saturday",
 * "By Dec 30 2026" (the current period's due date), "By Dec 2026", "Eventually"; for payment targets
 * "Each month" and "By Mar 2027".
 */
export function targetDueLine(target: CategoryTarget, need: Pick<TargetNeed, "dueDate"> | null) {
  if (target.cadence === "payment_monthly") return "Each month";
  if (target.cadence === "payoff_by_date") {
    return target.dueDate ? `By ${shortMonth(target.dueDate)}` : "";
  }
  if (target.cadence === "weekly") return `By ${WEEKDAYS[target.dueDay ?? 0]}`;
  if (target.cadence === "monthly" || target.cadence === "debt_monthly") {
    return target.dueDay === null
      ? "By the end of the month"
      : `By the ${ordinal(target.dueDay)} of the month`;
  }
  if (target.behavior === "balance") {
    return target.dueDate ? `By ${shortMonth(target.dueDate)}` : "Eventually";
  }
  const due = need?.dueDate ?? target.dueDate;
  return due ? `By ${shortDate(due)}` : "";
}

/** Where a target stands this month: met, on track (this month's share is in), or underfunded. */
export function targetStatus(need: TargetNeed) {
  if (BigInt(need.funded) >= BigInt(need.needed)) return "met" as const;
  return need.underfunded === "0" ? ("onTrack" as const) : ("underfunded" as const);
}

/**
 * The note under a category's name: "Funded" when met or past a one-time target's due month; "On
 * track" when this month's share of a dated target is in; otherwise "$60.00 more needed by the
 * 31st", "… this month" (weekly, and dated targets before their due month), "… by December 30th" (a
 * dated target's due month), "$300.00 needed eventually" (a balance target without a date). Set
 * aside always says "more"; other targets only once something counts toward them.
 */
export function targetRowNote(
  target: CategoryTarget,
  need: TargetNeed,
  month: BudgetMonth,
  format: Format,
) {
  const status = targetStatus(need);
  // A one-time target past its due month reads like a met one ("Funded. Spent $10.00 of $30.00");
  // `categoryRowNote` drops it when nothing's in.
  if (status === "met" || need.pastDue) return { met: true, text: "Funded" };
  // A debt payment reads "$300.00 needed by the 31st" with nothing assigned.
  const more =
    (target.behavior === "set_aside" && !isDebtTarget(target)) || BigInt(need.funded) > 0n
      ? " more"
      : "";
  if (status === "onTrack") {
    if (target.behavior === "balance" && !target.dueDate) {
      const toGo = BigInt(need.needed) - BigInt(need.funded);
      return { met: false, text: `${format(toGo.toString())}${more} needed eventually` };
    }
    return { met: false, text: "On track" };
  }
  const when =
    target.cadence === "monthly" || target.cadence === "debt_monthly"
      ? `by the ${ordinal(dueDayIn(target.dueDay, month))}`
      : need.dueDate && need.dueDate.slice(0, 7) === month && target.behavior !== "balance"
        ? `by ${monthLabel(need.dueDate)} ${ordinal(Number(need.dueDate.slice(8)))}`
        : "this month";
  return { met: false, text: `${format(need.underfunded)}${more} needed ${when}` };
}

/**
 * Pay Off Balance by Date's heading amount ("Pay off $125.00"): what's been put toward the payoff
 * (carried and assigned: what counts plus this month's payments) and what's still to go ($50.00 +
 * $75.00 = $125.00; $0.00 counted + $20.00 paid = $20.00).
 */
export function payoffAmount(need: Pick<TargetNeed, "needed" | "funded">, paymentsMade: string) {
  const funded = BigInt(need.funded);
  const toGo = BigInt(need.needed) - funded;
  return (funded - BigInt(paymentsMade) + (toGo > 0n ? toGo : 0n)).toString();
}

/**
 * The inspector's lines: what's needed, what counts, and To go (what's left of the total). Pay Off
 * Balance by Date shows the card's whole debt and Available ("Needed for Payoff", "Available for
 * Payment"), which include this month's `fundedSpending`; the target leaves it out of both, so To Go
 * is the same.
 */
export function targetLines(
  target: CategoryTarget,
  need: TargetNeed,
  format: Format,
  fundedSpending = "0",
) {
  // Before its card was opened a payment target has nothing to go.
  const toGo = need.beforeOpening ? 0n : BigInt(need.needed) - BigInt(need.funded);
  const toGoLine = { label: "To go", value: format((toGo > 0n ? toGo : 0n).toString()) };
  if (target.cadence === "payoff_by_date") {
    const extra = BigInt(fundedSpending);
    return [
      { label: "Needed for payoff", value: format((BigInt(need.needed) + extra).toString()) },
      { label: "Available for payment", value: format((BigInt(need.funded) + extra).toString()) },
      toGoLine,
    ];
  }
  const due = need.dueDate ? shortDate(need.dueDate) : null;
  const setAside = target.behavior === "set_aside";
  const [neededLabel, fundedLabel] =
    target.behavior === "balance"
      ? [
          target.dueDate ? `Balance needed by ${shortMonth(target.dueDate)}` : "Balance needed",
          "Current balance",
        ]
      : !isDated(target)
        ? setAside
          ? ["Amount to assign this month", "Assigned so far"]
          : ["Needed this month", "Funded"]
        : setAside
          ? [`Total to assign by ${due}`, "Assigned so far"]
          : [`Needed by ${due}`, "Funded"];
  return [
    { label: neededLabel, value: format(need.needed) },
    { label: fundedLabel, value: format(need.funded) },
    toGoLine,
  ];
}

/**
 * The inspector's message: "This target is fully funded.", "On track to meet this target.",
 * "Assign $333.34 this month to stay on track" (dated), "Assign $60.00 more to meet your target",
 * or nothing (a balance target without a date, a one-time target past its due month). `prompt` is
 * the amount the Assign button adds.
 */
export function targetMessage(
  target: CategoryTarget,
  need: TargetNeed,
  format: Format,
  month?: BudgetMonth,
) {
  // Before its card was opened a payment target asks nothing, yet still reads "Assign $0.00 to meet
  // your target".
  if (need.beforeOpening) return { prompt: format("0"), suffix: " to meet your target" };
  const status = targetStatus(need);
  // Past a one-time target's due month there's no message unless it's met.
  if (need.pastDue && status !== "met") return null;
  if (status === "met") {
    return {
      text:
        target.cadence === "payoff_by_date"
          ? "Enough is set aside to pay off this card."
          : "This target is fully funded.",
    };
  }
  if (status === "onTrack") {
    return target.behavior === "balance" && !target.dueDate
      ? null
      : { text: "On track to meet this target." };
  }
  const amount = format(need.underfunded);
  // In its own month a pay-off target asks to meet it ("Assign $1.00 to meet your target"); custom
  // targets keep "this month to stay on track".
  if (target.cadence === "payoff_by_date" && month && need.dueDate?.slice(0, 7) === month) {
    return { prompt: amount, suffix: " to meet your target" };
  }
  if (isDated(target)) return { prompt: amount, suffix: " this month to stay on track" };
  return {
    prompt: `${amount}${BigInt(need.funded) > 0n ? " more" : ""}`,
    suffix: " to meet your target",
  };
}

/** Create, replace and remove a category's target; failures show a toast. */
export function useTargetActions(budgetId: string, record?: (command: UndoCommand) => void) {
  const queryClient = useQueryClient();
  const put = $api.useMutation("put", "/v1/budgets/{budgetId}/categories/{categoryId}/target");
  const restore = $api.useMutation(
    "put",
    "/v1/budgets/{budgetId}/categories/{categoryId}/target/restore",
  );
  const remove = $api.useMutation(
    "delete",
    "/v1/budgets/{budgetId}/categories/{categoryId}/target",
  );
  const snooze = $api.useMutation(
    "put",
    "/v1/budgets/{budgetId}/categories/{categoryId}/target/snooze",
  );
  const income = $api.useMutation("put", "/v1/budgets/{budgetId}/expected-income");
  return useMemo(() => {
    async function run(work: () => Promise<unknown>, failure: string) {
      try {
        await work();
        return true;
      } catch (error) {
        toast.error(apiErrorMessage(error, failure));
        return false;
      } finally {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: categoriesQueryOptions(budgetId).queryKey }),
          invalidateMonths(queryClient),
        ]);
      }
    }
    /** Puts a category's target back exactly as it was (or removes it), for undo and redo. */
    const putBack = async (categoryId: string, target: CategoryTarget | null) => {
      const ok = await run(
        () => restore.mutateAsync({ params: { path: { budgetId, categoryId } }, body: { target } }),
        "Couldn't restore the target.",
      );
      // UndoProvider keeps the command where it was only when undo/redo throws.
      if (!ok) throw new Error("Couldn't restore the target.");
    };
    // Undo covers creating, editing and deleting a target, start month included.
    const remember = (
      label: string,
      categoryId: string,
      before: CategoryTarget | null,
      after: CategoryTarget | null,
    ) =>
      record?.({
        label,
        undo: () => putBack(categoryId, before),
        redo: () => putBack(categoryId, after),
      });
    return {
      /** Saves the target from `month`, the month on screen; `before` is the target it replaces. */
      save: async (
        categoryId: string,
        month: BudgetMonth,
        input: TargetInput,
        before: CategoryTarget | null = null,
      ) => {
        let after: CategoryTarget | null = null;
        const ok = await run(async () => {
          const saved = await put.mutateAsync({
            params: { path: { budgetId, categoryId } },
            body: { ...input, month, today: todayIso() } as SetTargetBody,
          });
          after = saved.target;
        }, "Couldn't save the target.");
        if (ok) remember(before ? "edit target" : "create target", categoryId, before, after);
        return ok;
      },
      remove: async (categoryId: string, before: CategoryTarget | null = null) => {
        const ok = await run(
          () => remove.mutateAsync({ params: { path: { budgetId, categoryId } } }),
          "Couldn't delete the target.",
        );
        if (ok && before) remember("delete target", categoryId, before, null);
        return ok;
      },
      /** Snoozes the target for `month` (the current month), or wakes it. */
      snooze: (categoryId: string, month: BudgetMonth, snoozed: boolean) =>
        run(
          () =>
            snooze.mutateAsync({
              params: { path: { budgetId, categoryId } },
              body: { month, snoozed, today: todayIso() },
            }),
          snoozed ? "Couldn't snooze the target." : "Couldn't wake the target.",
        ),
      /** Sets the budget's expected monthly income (Targets and Income). */
      setExpectedIncome: (amount: bigint) =>
        run(
          () =>
            income.mutateAsync({
              params: { path: { budgetId } },
              body: { amount: amount.toString() },
            }),
          "Couldn't save the expected income.",
        ),
    };
    // mutateAsync is stable; the mutation objects change every render.
  }, [budgetId, queryClient, record]);
}

type MonthBar = NonNullable<components["schemas"]["ProgressBar"]>;

/**
 * The note under a category that isn't overspent. With a target that's working this month: its
 * note ("Funded", "$60.00 more needed by the 31st", …), a met one adding what was spent of its money
 * ("Funded. Spent $30.00 of $100.00"), or "Fully spent" once all of it is. Without one (or
 * snoozed): "Fully spent" when spending used all the money, "Spent $7.00 of $20.00" while some is
 * left, nothing otherwise. `strong` is the part set in bold.
 */
export function categoryRowNote(
  target: CategoryTarget | null,
  need: TargetNeed | null,
  bar: MonthBar | null,
  month: BudgetMonth,
  format: Format,
): { strong: string; rest: string } | null {
  let spent = 0n;
  let money = 0n;
  let left = 0n;
  for (const section of bar?.sections ?? []) {
    for (const g of section.segments) {
      if (g.kind === "spent") spent += BigInt(g.amount);
      if (g.kind === "available") left += BigInt(g.amount);
    }
  }
  money = spent + left;
  const spentOf = `Spent ${format(spent.toString())} of ${format(money.toString())}`;
  if (target && need && !need.snoozed) {
    const note = targetRowNote(target, need, month, format);
    if (!note.met) return { strong: "", rest: note.text };
    // A target past its due month with nothing in it has no note; a met one whose money is all spent
    // reads "Fully spent".
    if (need.pastDue && money === 0n) return null;
    if (spent > 0n && left === 0n) return { strong: "", rest: "Fully spent" };
    // Once spending starts, what was spent says more than "Funded" (the bar already shows it).
    return spent > 0n ? { strong: "", rest: spentOf } : { strong: note.text, rest: "" };
  }
  if (spent === 0n) return null;
  return left === 0n ? { strong: "", rest: "Fully spent" } : { strong: "", rest: spentOf };
}
