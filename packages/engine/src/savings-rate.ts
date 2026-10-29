import { percentOf } from "./reports";

/**
 * One month's sums for the savings rate, every amount in the budget's currency. Each line is in
 * exactly one place, so nothing counts twice:
 * - `income`: Income v Expense's income (Ready to Assign lines, no starting balances);
 *   `incomeFromTracking` is the part of it moved in from tracking asset accounts.
 * - `spending`: the net of every spending line (Income v Expense's expenses, negative when spent);
 *   `savingCategories` is the part in categories that count as saving, and `toTracking` the part,
 *   in other categories, moved out to tracking asset accounts.
 */
export interface SavingsMonth {
  income: bigint;
  incomeFromTracking: bigint;
  spending: bigint;
  savingCategories: bigint;
  toTracking: bigint;
}

export interface SavingsFigures {
  /** The saving rate's income: `income` less what came back in from tracking accounts. */
  income: bigint;
  /** Income v Expense's net income (income + spending): "Left over". */
  netIncome: bigint;
  /** Spending in saving categories, added back (a refund lowers it). */
  savedViaCategories: bigint;
  /** Moved out to tracking asset accounts, less what came back in. */
  movedToTracking: bigint;
  /** netIncome + savedViaCategories + movedToTracking. */
  saved: bigint;
  /** saved ÷ income in percent (display only); null when income ≤ 0. */
  rate: number | null;
  /** Income v Expense's savings rate: netIncome ÷ its income; null when that income ≤ 0. */
  plainRate: number | null;
}

export const NO_SAVINGS: SavingsMonth = {
  income: 0n,
  incomeFromTracking: 0n,
  spending: 0n,
  savingCategories: 0n,
  toTracking: 0n,
};

const rateOf = (part: bigint, whole: bigint) => (whole > 0n ? percentOf(part, whole) : null);

export function savingsFigures(m: SavingsMonth): SavingsFigures {
  const income = m.income - m.incomeFromTracking;
  const netIncome = m.income + m.spending;
  const savedViaCategories = -m.savingCategories;
  const movedToTracking = -m.toTracking - m.incomeFromTracking;
  const saved = netIncome + savedViaCategories + movedToTracking;
  return {
    income,
    netIncome,
    savedViaCategories,
    movedToTracking,
    saved,
    rate: rateOf(saved, income),
    plainRate: rateOf(netIncome, m.income),
  };
}

export function addSavings(months: readonly SavingsMonth[]): SavingsMonth {
  return months.reduce(
    (sum, m) => ({
      income: sum.income + m.income,
      incomeFromTracking: sum.incomeFromTracking + m.incomeFromTracking,
      spending: sum.spending + m.spending,
      savingCategories: sum.savingCategories + m.savingCategories,
      toTracking: sum.toTracking + m.toTracking,
    }),
    NO_SAVINGS,
  );
}

/**
 * The rolling sums ending at each month of `months` (consecutive, oldest first): that month and up
 * to `window − 1` before it. The rate of a window is its sums' rate, not an average of monthly
 * rates. A window at the start of the list is shorter.
 */
export function rollingSavings(months: readonly SavingsMonth[], window = 12): SavingsMonth[] {
  return months.map((_, i) => addSavings(months.slice(Math.max(0, i - window + 1), i + 1)));
}
