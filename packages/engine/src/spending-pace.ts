import { addDays } from "./age-of-money";
import { type BudgetMonth, monthBounds } from "./months";
import { percentOf } from "./reports";
import { divideRounded } from "./rounding";

/**
 * Spending pace: how a month's money to spend runs down day by day against an even pace to zero on
 * the month's last day.
 *
 * The money to spend is what the month started with plus everything assigned in it so far (money
 * moved out counts against it), so assigning mid-month raises the whole month's line rather than
 * stepping it up on the day. Spending is the categories' net activity: a refund gives money back.
 */

/** Ahead: spent less than an even pace by more than a day's share; behind: more. */
export const PACE_STATUSES = ["ahead", "on_pace", "behind"] as const;
export type PaceStatus = (typeof PACE_STATUSES)[number];

export interface PaceInput {
  month: BudgetMonth;
  /** The user's today, YYYY-MM-DD. A month after it has no pace; a month before it is finished. */
  today: string;
  /** Available carried in plus this month's Assigned. */
  start: bigint;
  /** Net activity per day of the month (negative is spending), YYYY-MM-DD → minor units. */
  activity: ReadonlyMap<string, bigint>;
}

export interface PaceDay {
  date: string;
  /** Day of the month, 1-based. */
  day: number;
  /** Money left at the end of the day; null for days still to come. */
  remaining: bigint | null;
  /** Money an even pace leaves at the end of the day (rounded down). */
  ideal: bigint;
}

export interface Pace {
  /** Days in the month. */
  days: number;
  /** Days counted as passed: today's included; all of them for a finished month. */
  elapsed: number;
  finished: boolean;
  start: bigint;
  /** Net spending so far (negative when refunds outweigh it). */
  spent: bigint;
  remaining: bigint;
  /** `spent` as a percent of `start`; null when nothing was there to spend. */
  usedPercent: number | null;
  passedPercent: number;
  /** Null when there was nothing to spend and nothing was spent. */
  status: PaceStatus | null;
  /**
   * What can go out each day for the rest of the month, today included, rounded down to the
   * minor unit so it never overstates; zero once nothing is left, null for a finished month.
   */
  safePerDay: bigint | null;
  /** Money left at the month's end at the pace so far (rounded down). */
  projectedEnd: bigint;
  /**
   * The day the money runs out: when it went below zero, or when it will at the pace so far;
   * null when it lasts the month.
   */
  runOutDate: string | null;
  points: PaceDay[];
}

const floorDiv = (a: bigint, b: bigint) => divideRounded(a, b, "floor");

/** The month's pace as of `today`, or null for a month after it. */
export function spendingPace(input: PaceInput): Pace | null {
  const { start: first, end } = monthBounds(input.month);
  if (input.today < first) return null;
  const days = Number(end.slice(8));
  const finished = input.today > end;
  const elapsed = finished ? days : Number(input.today.slice(8));
  const start = input.start;
  const big = BigInt(days);

  let remaining = start;
  // The day the money last went below zero, while it still is.
  let wentNegative: string | null = null;
  const points: PaceDay[] = [];
  for (let day = 1; day <= days; day++) {
    const date = addDays(first, day - 1);
    const passed = day <= elapsed;
    if (passed) {
      remaining += input.activity.get(date) ?? 0n;
      if (remaining >= 0n) wentNegative = null;
      else wentNegative ??= date;
    }
    points.push({
      date,
      day,
      remaining: passed ? remaining : null,
      ideal: start - divideRounded(start * BigInt(day), big, "ceil"),
    });
  }
  const spent = start - remaining;

  // At the pace so far: spent / elapsed a day for the days still to come.
  const projectedEnd =
    spent > 0n ? start - divideRounded(spent * big, BigInt(elapsed), "ceil") : remaining;
  let runOutDate = wentNegative;
  if (runOutDate === null && projectedEnd < 0n) {
    // The first day the pace spends more than `start`: spent × d / elapsed > start.
    const day = Number(floorDiv(start * BigInt(elapsed), spent)) + 1;
    runOutDate = addDays(first, day - 1);
  }

  const daysLeft = BigInt(days - elapsed + 1);
  return {
    days,
    elapsed,
    finished,
    start,
    spent,
    remaining,
    usedPercent: start > 0n ? percentOf(spent, start) : null,
    passedPercent: (elapsed * 100) / days,
    status: paceStatus(start, spent, elapsed, days),
    safePerDay: finished ? null : remaining > 0n ? remaining / daysLeft : 0n,
    projectedEnd,
    runOutDate,
    points,
  };
}

/**
 * Ahead, on pace or behind: spending against what an even pace would have spent by now, within one
 * day's share either way counting as on pace.
 */
export function paceStatus(
  start: bigint,
  spent: bigint,
  elapsed: number,
  days: number,
): PaceStatus | null {
  if (start <= 0n) return spent > 0n ? "behind" : null;
  const big = BigInt(days);
  // Compared in units of 1/days to stay exact: spent × days against start × elapsed.
  const gap = spent * big - start * BigInt(elapsed);
  if (gap > start) return "behind";
  if (gap < -start) return "ahead";
  return "on_pace";
}

/** Adds daily activity maps together (a group's or the whole plan's pace). */
export function addActivity(
  maps: Iterable<ReadonlyMap<string, bigint>>,
): ReadonlyMap<string, bigint> {
  const sum = new Map<string, bigint>();
  for (const map of maps) {
    for (const [date, amount] of map) sum.set(date, (sum.get(date) ?? 0n) + amount);
  }
  return sum;
}
