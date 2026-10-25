import type { BudgetMonth } from "./months";
import { averageOf, splitSpending } from "./reports";
import { divideRounded } from "./rounding";

/** One key's (a category's or group's) net in one month: negative is money spent. */
export interface TrendCell<K> {
  month: BudgetMonth;
  key: K;
  net: bigint;
}

export interface TrendMonth<K> {
  month: BudgetMonth;
  /**
   * Total spending, positive: the month's spending less its positive rows, as Spending Breakdown
   * counts it.
   */
  total: bigint;
  /** What the keys that spent money spent, positive. */
  spending: bigint;
  /** What the keys whose inflows beat their outflows brought in, positive. */
  netInflows: bigint;
  /** Each key's net that month (keys with no lines are missing). */
  nets: Map<K, bigint>;
}

/** Spending Trends' months, oldest first, one per month of `months` (empty months included). */
export function trendMonths<K>(
  cells: readonly TrendCell<K>[],
  months: readonly BudgetMonth[],
): TrendMonth<K>[] {
  return months.map((month) => {
    const nets = new Map<K, bigint>();
    for (const c of cells) {
      if (c.month === month) nets.set(c.key, (nets.get(c.key) ?? 0n) + c.net);
    }
    const split = splitSpending([...nets].map(([key, net]) => ({ key, net })));
    return {
      month,
      total: split.total,
      spending: split.grossOutflows,
      netInflows: split.positiveInflows,
      nets,
    };
  });
}

/**
 * `part` as a percent of |`whole`|, unsigned, to one decimal ("75.5"), rounded half away from
 * zero; null when `whole` is zero (+$1,549.00 of $2,052.00 is "75.5"). Compared to Average and
 * segment shares read this way.
 */
export function percentTenths(part: bigint, whole: bigint): string | null {
  if (whole === 0n) return null;
  const abs = (v: bigint) => (v < 0n ? -v : v);
  const tenths = divideRounded(abs(part) * 1000n, abs(whole), "half-up");
  return `${tenths / 10n}.${tenths % 10n}`;
}

/**
 * Spending Trends' Compared to Average: a month's total less the range's
 * average, and that difference as a percent of the average ("+$1,549.00 (75.5%)").
 */
export function comparedToAverage(total: bigint, average: bigint) {
  const difference = total - average;
  return { difference, percent: percentTenths(difference, average) };
}

/** Average Monthly Spending: the range's total over its months, half away from zero. */
export function averageMonthlySpending(months: readonly { total: bigint }[]): bigint {
  return averageOf(
    months.reduce((s, m) => s + m.total, 0n),
    months.length,
  );
}

/**
 * The average of each value with the `window - 1` values before it (a rolling average), null
 * until there are `window` values.
 */
export function rollingAverage(values: readonly bigint[], window: number): (bigint | null)[] {
  return values.map((_, i) => {
    if (window <= 0 || i + 1 < window) return null;
    return averageOf(
      values.slice(i + 1 - window, i + 1).reduce((s, v) => s + v, 0n),
      window,
    );
  });
}

/**
 * The `n` keys that spent the most over `months` (spending as Total Spending counts it, a key's
 * nets summed), most first; keys that spent nothing overall are left for "Other".
 */
export function topSpenders<K>(months: readonly TrendMonth<K>[], n: number): K[] {
  const spent = new Map<K, bigint>();
  for (const m of months)
    for (const [key, net] of m.nets) spent.set(key, (spent.get(key) ?? 0n) - net);
  return [...spent]
    .filter(([, s]) => s > 0n)
    .sort(([, a], [, b]) => (a > b ? -1 : a < b ? 1 : 0))
    .slice(0, Math.max(0, n))
    .map(([key]) => key);
}
