import { addMonths, type BudgetMonth } from "./months";
import { divideRounded } from "./rounding";

/**
 * The Reports home's observations: short rule-based notes, no AI, each with its rule, threshold
 * and the evidence to link to. Amounts are minor units of the
 * budget's currency; "spent" amounts are positive.
 */
export type Observation =
  | {
      rule: "category_above_average";
      categoryId: string;
      name: string;
      spent: bigint;
      average: bigint;
      /** How far above the average, in whole percent (display only). */
      percentAbove: number;
    }
  | { rule: "category_overspent"; categoryId: string; name: string; overspent: bigint }
  | { rule: "net_worth_high"; month: BudgetMonth; netWorth: bigint; previousHigh: bigint }
  | {
      rule: "income_lower";
      month: BudgetMonth;
      income: bigint;
      previousMonth: BudgetMonth;
      previousIncome: bigint;
    }
  | { rule: "new_top_payee"; payeeId: string; name: string; spent: bigint; rank: number };

/** A category's spending this month and in each of the months before it (oldest first). */
export interface CategorySpending {
  categoryId: string;
  name: string;
  spent: bigint;
  previous: readonly bigint[];
}

export interface ObservationInput {
  month: BudgetMonth;
  /** Categories' spending this month (to date) and in up to the 6 months before. */
  categories: readonly CategorySpending[];
  /** Categories overspent this month, with how much (positive). */
  overspent: readonly { categoryId: string; name: string; overspent: bigint }[];
  /** Month-end net worth by month, oldest first, up to this month (left out when unknown). */
  netWorth?: readonly { month: BudgetMonth; netWorth: bigint }[];
  /** Income by month (complete months compared: last month against the one before). */
  income: ReadonlyMap<BudgetMonth, bigint>;
  /** This month's top payees by spending, largest first. */
  topPayees: readonly { payeeId: string; name: string; spent: bigint }[];
  /** Payees with spending before this month. */
  knownPayees: ReadonlySet<string>;
  /**
   * The smallest amount a "spending above average" note is about (minor units), so that $3 against
   * a $2 average says nothing.
   */
  minimumSpend: bigint;
}

/** Spending at least this much above the 6-month average is worth a note (25%). */
export const ABOVE_AVERAGE_PERCENT = 25n;
/** At most this many notes, most telling first. */
export const MAX_OBSERVATIONS = 5;
/** At most this many notes of one rule, so one kind can't crowd out the others. */
export const MAX_PER_RULE = 2;
/** How many of the month's top payees are checked for new ones. */
export const TOP_PAYEES = 10;

/**
 * The month's observations, in this order, at most MAX_PER_RULE of a rule and MAX_OBSERVATIONS
 * in all: overspent categories, categories well above their average (largest gap first), a new
 * net worth high, lower income
 * than the month before, new payees among the top ten.
 */
export function observations(input: ObservationInput): Observation[] {
  const notes: Observation[] = [];

  for (const c of [...input.overspent].sort((a, b) => cmp(b.overspent, a.overspent))) {
    if (c.overspent > 0n) notes.push({ rule: "category_overspent", ...c });
  }

  const above = input.categories.flatMap((c) => {
    if (c.previous.length === 0 || c.spent < input.minimumSpend) return [];
    const average = divideRounded(
      c.previous.reduce((s, v) => s + v, 0n),
      BigInt(c.previous.length),
      "half-up",
    );
    if (average <= 0n || c.spent * 100n < average * (100n + ABOVE_AVERAGE_PERCENT)) return [];
    const percentAbove = Number(divideRounded((c.spent - average) * 100n, average, "half-up"));
    return [
      {
        rule: "category_above_average" as const,
        categoryId: c.categoryId,
        name: c.name,
        spent: c.spent,
        average,
        percentAbove,
      },
    ];
  });
  notes.push(...above.sort((a, b) => cmp(b.spent - b.average, a.spent - a.average)));

  const worth = input.netWorth ?? [];
  const latest = worth.at(-1);
  if (latest && latest.month === input.month && worth.length > 1) {
    const previousHigh = worth
      .slice(0, -1)
      .reduce((m, w) => (w.netWorth > m ? w.netWorth : m), worth[0]?.netWorth ?? 0n);
    if (latest.netWorth > previousHigh) {
      notes.push({
        rule: "net_worth_high",
        month: latest.month,
        netWorth: latest.netWorth,
        previousHigh,
      });
    }
  }

  // Complete months only: this month's income is still coming in.
  const last = addMonths(input.month, -1);
  const before = addMonths(input.month, -2);
  const lastIncome = input.income.get(last);
  const beforeIncome = input.income.get(before);
  if (lastIncome !== undefined && beforeIncome !== undefined && lastIncome < beforeIncome) {
    notes.push({
      rule: "income_lower",
      month: last,
      income: lastIncome,
      previousMonth: before,
      previousIncome: beforeIncome,
    });
  }

  input.topPayees.slice(0, TOP_PAYEES).forEach((p, i) => {
    if (p.spent > 0n && !input.knownPayees.has(p.payeeId)) {
      notes.push({ rule: "new_top_payee", ...p, rank: i + 1 });
    }
  });

  const perRule = new Map<Observation["rule"], number>();
  return notes
    .filter((n) => {
      const count = (perRule.get(n.rule) ?? 0) + 1;
      perRule.set(n.rule, count);
      return count <= MAX_PER_RULE;
    })
    .slice(0, MAX_OBSERVATIONS);
}

/**
 * Months of runway: cash in budget accounts over the average monthly spending of the last 6
 * months, as a display number with one decimal (null when nothing was spent).
 */
export function monthsOfRunway(cash: bigint, monthlySpending: readonly bigint[]): number | null {
  if (monthlySpending.length === 0) return null;
  const total = monthlySpending.reduce((s, v) => s + v, 0n);
  if (total <= 0n) return null;
  // Tenths of a month: cash × months × 10 ÷ total spending, rounded once.
  const tenths = divideRounded(cash * BigInt(monthlySpending.length) * 10n, total, "half-up");
  return Number(tenths) / 10;
}

const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
