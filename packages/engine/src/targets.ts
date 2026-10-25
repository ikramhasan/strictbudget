import { z } from "zod";
import type { CurrencyCode } from "./currency";
import { convert } from "./fx";
import { money } from "./money";
import {
  addMonths,
  type BudgetMonth,
  type CategoryMonth,
  categoryMonth,
  type MonthFigures,
  monthOf,
} from "./months";

/**
 * What a target asks for:
 * - set_aside: "Set aside another…": the full amount each period; money carried in doesn't count.
 * - refill: "Refill up to…" (custom: "Fill up to…"): only what brings the category up to the amount.
 * - balance: "Have a balance of…" (custom only): reach the amount, by a month or eventually.
 */
export const TARGET_BEHAVIORS = ["set_aside", "refill", "balance"] as const;
export type TargetBehavior = (typeof TARGET_BEHAVIORS)[number];
export const zTargetBehavior = z.enum(TARGET_BEHAVIORS);

/**
 * The four target tabs, then the two targets a credit card's payment category takes instead:
 * "Pay Specific Amount Monthly" (`payment_monthly`) and "Pay Off Balance by Date"
 * (`payoff_by_date`), then a loan's "Monthly Debt Payment" (`debt_monthly`).
 */
export const TARGET_CADENCES = [
  "weekly",
  "monthly",
  "yearly",
  "custom",
  "payment_monthly",
  "payoff_by_date",
  "debt_monthly",
] as const;
export type TargetCadence = (typeof TARGET_CADENCES)[number];
export const zTargetCadence = z.enum(TARGET_CADENCES);

export const PAYMENT_TARGET_CADENCES = ["payment_monthly", "payoff_by_date"] as const;
export const isPaymentTarget = (target: Pick<CategoryTarget, "cadence">) =>
  (PAYMENT_TARGET_CADENCES as readonly string[]).includes(target.cadence);

/**
 * The "Monthly Debt Payment" target, only on a category paired with a loan: an amount each month,
 * due on `dueDay` (null for the last day), asked like a monthly "Set aside another…": payments
 * don't change what's left to assign, and money carried into the next month doesn't count.
 */
export const isDebtTarget = (target: Pick<CategoryTarget, "cadence">) =>
  target.cadence === "debt_monthly";

/** How a custom target repeats: every N months (1–11) or years (1–2). */
export const TARGET_REPEAT_UNITS = ["month", "year"] as const;
export type TargetRepeatUnit = (typeof TARGET_REPEAT_UNITS)[number];

export interface CategoryTarget {
  cadence: TargetCadence;
  /** Payment targets: set_aside for Pay Specific Amount Monthly, balance for Pay Off by Date. */
  behavior: TargetBehavior;
  /**
   * Minor units: per week (weekly), per month (monthly, payment_monthly, debt_monthly), or per
   * period (yearly, custom); zero for payoff_by_date, which pays off whatever the card owes.
   */
  amount: bigint;
  /**
   * Monthly and debt_monthly: day of the month it's due (1–31), null for the last day. Weekly:
   * the weekday (0 = Sunday … 6 = Saturday). Null otherwise. Only changes the wording.
   */
  dueDay: number | null;
  /**
   * Yearly and custom: the (first) due date, YYYY-MM-DD; a balance target's is the first of its
   * month, or null for "eventually". payoff_by_date: the first of the month to pay off by. Null for
   * weekly and monthly.
   */
  dueDate: string | null;
  /** Custom: repeats every `repeatEvery` `repeatUnit`s; null for a one-time target. */
  repeatEvery: number | null;
  repeatUnit: TargetRepeatUnit | null;
  /** The first month the target applies to. */
  startMonth: BudgetMonth;
  /**
   * Weekly: the day of `startMonth` it was created on; occurrences before it aren't asked for in
   * that month. Null (or absent) for the whole month.
   */
  startDay?: number | null;
}

export interface TargetNeed {
  /**
   * What the target needs: this month's amount (weekly, monthly), the period's total (yearly,
   * custom), or the balance to reach.
   */
  needed: bigint;
  funded: bigint;
  /** What's still to assign this month to stay on track; never below zero. */
  underfunded: bigint;
  /**
   * What the target asks of this month before anything is assigned in it: the month's amount
   * (weekly, monthly) or this month's share of what's missing (yearly, custom); zero for a balance
   * with no date. These add up to the month's targets total.
   */
  monthAmount: bigint;
  /**
   * What Reduce Overfunding takes back: this month's Assigned above what the month asks, never more
   * than the category's Available; zero for a balance with no date.
   */
  overfunded: bigint;
  /** The due date of the period `month` is in (yearly, custom), YYYY-MM-DD; null otherwise. */
  dueDate: string | null;
}

/**
 * A target set in its own currency (a EUR holiday target in a USD budget) restated in the budget's
 * currency, so `targetNeed` and everything after it run on base amounts as usual. Only the amount
 * converts, rounded up at the budget currency's minor unit so rounding never leaves the target
 * underfunded; cadence, dates and snoozes stay as they are. `rate` is "1 target currency = rate
 * budget currency" (today's rate). A target already in the budget's currency comes back as is.
 */
export function targetInBase<T extends { amount: bigint; currency: CurrencyCode }>(
  target: T,
  rate: string,
  budgetCurrency: CurrencyCode,
): T {
  if (target.currency === budgetCurrency) return target;
  const amount = convert(money(target.amount, target.currency), rate, budgetCurrency, "ceil");
  return { ...target, amount: amount.amount, currency: budgetCurrency };
}

/** Months from `a` to `b`, counting both ends (a ≤ b). */
const monthsThrough = (a: BudgetMonth, b: BudgetMonth) => {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am) + 1;
};

const ceilDiv = (a: bigint, b: bigint) => (a <= 0n ? 0n : (a + b - 1n) / b);

/** How many times `weekday` (0 = Sunday) falls in `month`. */
export function weekdaysIn(month: BudgetMonth, weekday: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const offset = (weekday - first + 7) % 7;
  return offset >= days ? 0 : Math.floor((days - 1 - offset) / 7) + 1;
}

/**
 * The days of `month` a weekly target asks for: each time its weekday falls in the month, from its
 * start day in its first month (created on Monday the 12th, a Saturday target asks for the 17th,
 * 24th and 31st; the next month asks for all of them).
 */
export function weeklyDays(
  target: Pick<CategoryTarget, "dueDay"> & Partial<Pick<CategoryTarget, "startMonth" | "startDay">>,
  month: BudgetMonth,
): number[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const offset = ((target.dueDay ?? 0) - first + 7) % 7;
  const from = month === target.startMonth ? (target.startDay ?? 1) : 1;
  return Array.from(
    { length: weekdaysIn(month, target.dueDay ?? 0) },
    (_, i) => 1 + offset + i * 7,
  ).filter((day) => day >= from);
}

/** Months between due dates: yearly is 12, custom every N months or N × 12. */
function periodMonths(target: CategoryTarget): number | null {
  if (target.cadence === "yearly") return 12;
  if (target.cadence !== "custom" || !target.repeatEvery || !target.repeatUnit) return null;
  return target.repeatUnit === "year" ? target.repeatEvery * 12 : target.repeatEvery;
}

/**
 * The period of a dated target that `month` falls in: its due date and first month. A repeating
 * target starts a new period the month after each due month. A one-time target stays in its only
 * period after its due month (`past`), except a balance target, which has none then (null).
 */
function periodOf(target: CategoryTarget, dueDate: string, month: BudgetMonth) {
  const firstDue = monthOf(dueDate);
  const step = periodMonths(target);
  if (step === null) {
    if (month <= firstDue) return { due: dueDate, dueMonth: firstDue, start: null, past: false };
    return target.behavior === "balance"
      ? null
      : { due: dueDate, dueMonth: firstDue, start: null, past: true };
  }
  let k = 0;
  if (month > firstDue) k = Math.ceil((monthsThrough(firstDue, month) - 1) / step);
  const dueMonth = addMonths(firstDue, k * step);
  const due = `${dueMonth}-${dueDate.slice(8)}`;
  return { due: clampDay(due), dueMonth, start: addMonths(dueMonth, 1 - step), past: false };
}

/**
 * What a dated "Set aside another…" target (yearly, custom) had left when its last period ended:
 * the money carried into the current period's first month, drawn as the bar's first section and
 * the same in every month of the period. Zero for other targets.
 */
export function periodRollover(
  history: readonly MonthFigures[],
  target: CategoryTarget,
  month: BudgetMonth,
): bigint {
  const dated = target.cadence === "yearly" || target.cadence === "custom";
  if (!dated || target.behavior !== "set_aside" || !target.dueDate) return 0n;
  const period = periodOf(target, target.dueDate, month);
  if (!period || period.past) return 0n;
  const first =
    period.start === null || period.start < target.startMonth ? target.startMonth : period.start;
  return categoryMonth(history, first > month ? month : first).carried;
}

/** A YYYY-MM-DD whose day is past its month's end moves to the last day (Jan 31 → Feb 28). */
function clampDay(date: string) {
  const month = monthOf(date);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Number(date.slice(8));
  return day > last ? `${month}-${String(last).padStart(2, "0")}` : date;
}

/**
 * What a category's target asks for in `month`, from the category's history. Nothing before the
 * target's start month (null).
 *
 * - Monthly and weekly: the month's amount (weekly: once per occurrence of its weekday). Set aside
 *   counts this month's Assigned; refill counts what was carried in plus this month's Assigned.
 * - Yearly and custom (dated): the period's total, spread over the months left up to the due month,
 *   rounding up. Set aside counts what was assigned in the period; refill counts what was
 *   carried in plus this month's Assigned. This month's share is what's missing from the total
 *   before this month, divided by the months left; anything assigned this month counts against it.
 * - Balance counts the category's Available, this month's spending included. Without a date it
 *   never asks for money this month.
 * - A one-time set aside or fill up target past its due month stays on, asking for nothing; a
 *   balance target is gone.
 *
 * In a month after `currentMonth` (the user's month) carried money doesn't count for refill and
 * balance: leftover money only counts once the month begins.
 *
 * Payment categories (`owed`: what the card owes, zero when it isn't in debt): Pay Specific Amount
 * Monthly asks like a monthly "Set aside another…"; Pay Off Balance by Date see `payoffNeed`.
 */
export function targetNeed(
  history: readonly MonthFigures[],
  target: CategoryTarget,
  month: BudgetMonth,
  currentMonth: BudgetMonth,
  owed = 0n,
): TargetNeed | null {
  if (month < target.startMonth) return null;
  const figures = categoryMonth(history, month);
  if (target.cadence === "payoff_by_date") return payoffNeed(figures, target, month, owed);
  const carried = month <= currentMonth ? figures.carried : 0n;
  const holds = target.behavior !== "set_aside";
  // Balance counts what the category holds: carried in, Assigned and this month's activity.
  const holding =
    target.behavior === "balance" ? carried + figures.assigned + figures.activity : null;

  if (
    target.cadence === "monthly" ||
    target.cadence === "weekly" ||
    target.cadence === "payment_monthly" ||
    target.cadence === "debt_monthly"
  ) {
    const needed =
      target.cadence === "weekly"
        ? target.amount * BigInt(weeklyDays(target, month).length)
        : target.amount;
    // What this month's Assigned has to reach: refill counts what was carried in (below zero
    // when more was carried in than the target).
    const due = holds ? needed - carried : needed;
    return {
      needed,
      funded: holds ? carried + figures.assigned : figures.assigned,
      underfunded: under(due, figures.assigned),
      monthAmount: needed,
      overfunded: over(figures, due),
      dueDate: null,
      // The month's targets total counts every week, even those before a weekly target began.
      ...(target.cadence === "weekly" && {
        monthAmount: target.amount * BigInt(weekdaysIn(month, target.dueDay ?? 0)),
      }),
    };
  }

  const needed = target.amount;
  if (!target.dueDate) {
    // "Have a balance of…" eventually: tracked, never asked for this month. What it holds above
    // the balance (up to Available) is over.
    const funded = holding ?? 0n;
    const extra = funded - needed;
    return {
      needed,
      funded,
      underfunded: 0n,
      monthAmount: 0n,
      overfunded: extra <= 0n || figures.available <= 0n ? 0n : min(extra, figures.available),
      dueDate: null,
    };
  }
  const period = periodOf(target, target.dueDate, month);
  if (!period) return null;
  const monthsLeft = BigInt(monthsThrough(month, period.dueMonth));

  if (holds) {
    const funded = holding ?? carried + figures.assigned;
    if (period.past) return pastDue(needed, funded, period.due);
    // What was in before this month's Assigned.
    const share = shareOf(needed - (funded - figures.assigned), monthsLeft);
    // A Fill up repeating every month counts in full in the month's targets total, as a monthly
    // refill does, whatever its due date; other dated targets count their share.
    const everyMonth =
      target.cadence === "custom" && target.repeatEvery === 1 && target.repeatUnit === "month";
    return {
      needed,
      funded,
      underfunded: under(share, figures.assigned),
      monthAmount: everyMonth ? needed : share > 0n ? share : 0n,
      overfunded: over(figures, share),
      dueDate: period.due,
    };
  }
  // Set aside: what was assigned in the period, no earlier than the target's start.
  const from =
    period.start === null || period.start < target.startMonth ? target.startMonth : period.start;
  let before = 0n;
  for (const h of history) {
    if (h.month >= from && h.month < month) before += h.assigned;
  }
  if (period.past) return pastDue(needed, before + figures.assigned, period.due);
  const share = shareOf(needed - before, monthsLeft);
  return {
    needed,
    funded: before + figures.assigned,
    underfunded: under(share, figures.assigned),
    monthAmount: share > 0n ? share : 0n,
    overfunded: over(figures, share),
    dueDate: period.due,
  };
}

/**
 * Pay Off Balance by Date: pay off what the card owes by the end of the target's month.
 *
 * - What's still to pay off is what's owed beyond Available ($125.00 owed, $50.00 available →
 *   $75.00 to go). This month's Funded Spending is left out of both sides, so funded card spending
 *   changes nothing, while credit overspending raises what's owed at once.
 * - This month's share is what was still to go before this month's Assigned, spread over the months
 *   left up to the target's month and rounded up, as for dated targets ($100.00 by December from
 *   October: $33.34). Money carried in counts in a future month too.
 * - After the target's month it stays on and asks for nothing. A target saved with a month already
 *   past is refused.
 */
function payoffNeed(
  figures: CategoryMonth,
  target: CategoryTarget,
  month: BudgetMonth,
  owed: bigint,
): TargetNeed | null {
  if (!target.dueDate) return null;
  const dueMonth = monthOf(target.dueDate);
  const left = owed - figures.fundedSpending;
  const needed = left > 0n ? left : 0n;
  const funded = figures.available - figures.fundedSpending;
  if (month > dueMonth) return pastDue(needed, funded, target.dueDate);
  const share = shareOf(
    needed - (funded - figures.assigned),
    BigInt(monthsThrough(month, dueMonth)),
  );
  return {
    needed,
    funded,
    underfunded: under(share, figures.assigned),
    monthAmount: share > 0n ? share : 0n,
    overfunded: over(figures, share),
    dueDate: target.dueDate,
  };
}

/** A one-time target after its due month: still shown, asking for nothing. */
const pastDue = (needed: bigint, funded: bigint, dueDate: string): TargetNeed => ({
  needed,
  funded,
  underfunded: 0n,
  monthAmount: 0n,
  overfunded: 0n,
  dueDate,
});

const min = (a: bigint, b: bigint) => (a < b ? a : b);

const under = (needed: bigint, funded: bigint) => (funded < needed ? needed - funded : 0n);

/**
 * This month's share of what's still missing from a dated target, rounding up. When nothing is
 * missing (more is already in than the target), it's the surplus, below zero, so Reduce
 * Overfunding can take it back.
 */
const shareOf = (missing: bigint, monthsLeft: bigint) =>
  missing > 0n ? ceilDiv(missing, monthsLeft) : missing;

/**
 * What's over: this month's Assigned above what it has to reach (`due`), but never more than is
 * Available ($150.00 assigned against $100.00 with $120.00 spent gives back $30.00).
 */
function over(figures: CategoryMonth, due: bigint) {
  const extra = figures.assigned - due;
  if (extra <= 0n || figures.available <= 0n) return 0n;
  return extra < figures.available ? extra : figures.available;
}

/**
 * The share of a target that's funded, in whole percent from 0 to 100, rounded down so it never
 * reads 100 before the target is met.
 */
export function targetPercent(need: Pick<TargetNeed, "needed" | "funded">): number {
  if (need.funded >= need.needed) return 100;
  if (need.funded <= 0n) return 0;
  return Number((need.funded * 100n) / need.needed);
}
