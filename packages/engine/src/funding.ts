import { type BudgetMonth, monthOf } from "./months";
import { type CategoryTarget, type TargetNeed, weeklyDays } from "./targets";

/**
 * Underfunded's order when it can't fund everything: overspent
 * categories first, then what's due this month by date (weekly occurrences, monthly targets, dated
 * targets due this month; "end of month" is the month's last day), then, in a budget's first
 * month only, what fell due before the budget started, then dated targets due in a later month by
 * due date, then credit card payments. On the same date or within a step, categories go top to
 * bottom.
 */
export const FUNDING_STEPS = {
  overspent: 1,
  dueThisMonth: 2,
  beforeStart: 3,
  dueLater: 4,
  cardPayment: 5,
} as const;
export type FundingStep = (typeof FUNDING_STEPS)[keyof typeof FUNDING_STEPS];

/** One piece of what a category asks for, with its place in Underfunded's order. */
export interface FundingPart {
  amount: bigint;
  step: FundingStep;
  /** YYYY-MM-DD the part is due, or "" when the step doesn't order by date. */
  date: string;
  /** Orders parts of one step and date before the list order: lower first. Defaults to zero. */
  rank?: number;
}

/**
 * A category's scheduled transactions still to come in the month: their net amount (negative when
 * more goes out than comes in) and the earliest one's date.
 */
export interface Upcoming {
  amount: bigint;
  date: string;
}

/** What the upcoming transactions need beyond Available. */
export function upcomingShort(available: bigint, upcoming: Upcoming | null | undefined): bigint {
  if (!upcoming || upcoming.amount >= 0n) return 0n;
  const short = -upcoming.amount - available;
  return short > 0n ? short : 0n;
}

export interface CategoryFunding {
  /** What Underfunded adds to the category's Assigned when it can fund it in full. */
  underfunded: bigint;
  /** What Reduce Overfunding takes back from its Assigned. */
  overfunded: bigint;
  /** `underfunded` split into the pieces Underfunded funds in order (they add up to it). */
  parts: FundingPart[];
}

const NONE: CategoryFunding = { underfunded: 0n, overfunded: 0n, parts: [] };

const lastDay = (month: BudgetMonth) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const dayOf = (month: BudgetMonth, day: number) =>
  `${month}-${String(Math.min(day, lastDay(month))).padStart(2, "0")}`;

/**
 * What Underfunded and Reduce Overfunding do to a spending category in `month`:
 * - Underfunded assigns enough to meet the target and to cover any overspending, whichever is more
 *   ($100.00 target, $30.00 overspent → $100.00; met, $30.00 overspent → $30.00). A
 *   category without a target only gets its overspending covered.
 * - Reduce Overfunding takes back what the target says is over (`TargetNeed.overfunded`).
 * - A snoozed target asks for nothing, but its overspending is still covered and what's over can
 *   still be taken back.
 * - Upcoming scheduled transactions ask for what Available doesn't cover, or the target's need if
 *   that's more (a $40.00 target and $30.00 scheduled asks $40.00; a target met at $40.00 with
 *   $60.00 scheduled, $20.00), snoozed or not. The whole amount is funded at the earliest upcoming
 *   date.
 */
export function spendingFunding(
  month: BudgetMonth,
  available: bigint,
  target: FundedTarget | null,
  need: TargetNeed | null,
  snoozed = false,
  upcoming: Upcoming | null = null,
): CategoryFunding {
  const overspent = available < 0n ? -available : 0n;
  const short = snoozed ? 0n : (need?.underfunded ?? 0n);
  const scheduled = upcomingShort(available, upcoming);
  const underfunded = [short, overspent, scheduled].reduce((a, b) => (b > a ? b : a));
  const overfunded = need?.overfunded ?? 0n;
  if (underfunded === 0n) return { ...NONE, overfunded };
  if (overspent > 0n || ((!target || !need) && scheduled === 0n)) {
    return {
      underfunded,
      overfunded,
      parts: [{ amount: underfunded, step: FUNDING_STEPS.overspent, date: "" }],
    };
  }
  if (scheduled > 0n && upcoming) {
    return {
      underfunded,
      overfunded,
      parts: [{ amount: underfunded, step: FUNDING_STEPS.dueThisMonth, date: upcoming.date }],
    };
  }
  if (!target || !need) return { ...NONE, overfunded };
  return { underfunded, overfunded, parts: targetParts(month, target, need) };
}

/** What Underfunded needs to know of a target. */
type FundedTarget = Pick<CategoryTarget, "cadence" | "dueDay"> &
  Partial<Pick<CategoryTarget, "startMonth" | "startDay">>;

/** A target's shortfall placed in Underfunded's order. */
function targetParts(month: BudgetMonth, target: FundedTarget, need: TargetNeed): FundingPart[] {
  const amount = need.underfunded;
  if (target.cadence === "weekly") {
    // Each week's occurrence is due on its own date; what's assigned so far covers the earliest.
    const dates = weeklyDays(target, month).map((day) => dayOf(month, day));
    const perWeek = dates.length ? need.needed / BigInt(dates.length) : amount;
    const parts: FundingPart[] = [];
    let left = amount;
    for (let i = dates.length - 1; i >= 0 && left > 0n; i--) {
      const part = i === 0 || left < perWeek ? left : perWeek;
      parts.unshift({ amount: part, step: FUNDING_STEPS.dueThisMonth, date: dates[i] ?? "" });
      left -= part;
    }
    return parts;
  }
  // A debt payment is due like a monthly target.
  if (target.cadence === "monthly" || target.cadence === "debt_monthly") {
    const day = target.dueDay ?? lastDay(month);
    return [{ amount, step: FUNDING_STEPS.dueThisMonth, date: dayOf(month, day) }];
  }
  const due = need.dueDate ?? "";
  return [
    {
      amount,
      step: due && monthOf(due) === month ? FUNDING_STEPS.dueThisMonth : FUNDING_STEPS.dueLater,
      date: due,
    },
  ];
}

/**
 * What Underfunded and Reduce Overfunding do to a credit card's payment category, without a
 * target:
 * - Underfunded assigns what the card owes beyond Available, less this month's credit overspending
 *   on it (covering those categories moves that money in): owing $103.00 with $3.00 → $100.00;
 *   owing nothing with −$10.00 → $10.00; owing $65.00 with $31.00 and $33.00 of credit
 *   overspending → $1.00.
 * - Reduce Overfunding takes back Available above what's owed (paid off, $6.00 → $6.00).
 *
 * With a target that applies this month, both follow the target instead of the working balance
 * ($30.00 a month with $5.00 credit overspending asks $30.00; a card red at −$10.00 still asks
 * its target share, the overspending covered too if more).
 *
 * A scheduled payment asks for what Available doesn't cover, or the above if more (owing $10.00
 * with a $5.00 payment scheduled still asks $10.00), and puts the card first among card payments.
 * Then come cards with a payment target, then plain Underfunded alerts, whatever the list order.
 */
export function paymentFunding(
  available: bigint,
  owed: bigint,
  creditOverspending: bigint,
  need: TargetNeed | null = null,
  upcoming: Upcoming | null = null,
): CategoryFunding {
  let underfunded: bigint;
  let overfunded: bigint;
  if (need) {
    const overspent = available < 0n ? -available : 0n;
    underfunded = need.underfunded > overspent ? need.underfunded : overspent;
    overfunded = need.overfunded;
  } else {
    const short = owed - available - creditOverspending;
    const extra = available - owed;
    underfunded = short > 0n ? short : 0n;
    overfunded = extra > 0n ? extra : 0n;
  }
  const scheduled = upcomingShort(available, upcoming);
  if (scheduled > underfunded) underfunded = scheduled;
  const date = upcoming && upcoming.amount < 0n ? upcoming.date : "";
  return {
    underfunded,
    overfunded,
    parts: underfunded
      ? [{ amount: underfunded, step: FUNDING_STEPS.cardPayment, date, rank: need ? 0 : 1 }]
      : [],
  };
}

/**
 * In a budget's first month, what was due before the budget started goes after everything else
 * due that month (for a budget created on the 12th, due the 5th or 11th goes after, due the 12th
 * doesn't). `start` is the budget's first day, YYYY-MM-DD.
 */
export function afterStart(parts: readonly FundingPart[], start: string): FundingPart[] {
  return parts.map((p) =>
    p.step === FUNDING_STEPS.dueThisMonth && p.date !== "" && p.date < start
      ? { ...p, step: FUNDING_STEPS.beforeStart }
      : p,
  );
}

/**
 * Underfunded over many categories with only `readyToAssign` to give: each part in order (step,
 * then date, undated parts last, then rank, then the categories' order as listed) gets what's left
 * until nothing is.
 * Returns what each category gets. Categories come in list order.
 */
export function fundUnderfunded(
  categories: readonly { categoryId: string; parts: readonly FundingPart[] }[],
  readyToAssign: bigint,
): Map<string, bigint> {
  const queue = categories.flatMap((c, index) =>
    c.parts.map((part) => ({ ...part, index, id: c.categoryId })),
  );
  queue.sort((a, b) =>
    a.step !== b.step
      ? a.step - b.step
      : a.date !== b.date
        ? a.date === "" || (b.date !== "" && a.date > b.date)
          ? 1
          : -1
        : (a.rank ?? 0) - (b.rank ?? 0) || a.index - b.index,
  );
  const given = new Map<string, bigint>();
  let left = readyToAssign;
  for (const part of queue) {
    if (left <= 0n) break;
    const amount = part.amount < left ? part.amount : left;
    given.set(part.id, (given.get(part.id) ?? 0n) + amount);
    left -= amount;
  }
  return given;
}
