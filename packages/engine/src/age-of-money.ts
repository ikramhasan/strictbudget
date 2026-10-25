import type { AccountFamily } from "./accounts";
import { addMonths, type BudgetMonth, monthBounds, monthOf } from "./months";

/**
 * Age of Money:
 *
 * - Money enters one pool shared by every cash account (checking, savings, cash; open or closed)
 *   and leaves it oldest first (FIFO).
 * - Inflows: every positive line in a cash account, a positive starting balance included, and a
 *   transfer in from a loan or tracking account. Transfers between cash accounts don't count either
 *   way (money keeps its age).
 * - Outflows: every negative line in a cash account, including credit card payments (a transfer to
 *   a credit card or line of credit) and transfers out to a loan or tracking account, categorized
 *   or not. Spending on a card isn't an outflow until the card is paid.
 * - An outflow's age is how many days its money sat in the pool, measured to the outflow's own
 *   date: the amount-weighted average of the inflows it used, floored to whole days.
 * - An outflow larger than the pool counts the missing part as 0 days old, and that shortfall is
 *   repaid by the next inflows before they reach the pool. (With this rule an inflow and an
 *   outflow on the same day give the same result in either order.)
 * - Age of Money is the plain average of the last ten outflows' ages, floored; with fewer than
 *   ten outflows there's none.
 *
 * A negative starting balance and a transfer in from a credit card or line of credit are ignored.
 */
export const AGE_OF_MONEY_OUTFLOWS = 10;

/** One line of a cash-account transaction (a split's lines one by one, else the whole). */
export interface AgeOfMoneyPart {
  /** In the budget's currency; negative is an outflow. */
  amount: bigint;
  /** The other account's family when the line is a transfer. */
  transferFamily?: AccountFamily | null;
  startingBalance?: boolean;
}

/** How much of a cash-account transaction moves money in (> 0) or out (< 0) of the pool. */
export function countedAmount(parts: readonly AgeOfMoneyPart[]): bigint {
  let total = 0n;
  for (const part of parts) {
    if (part.startingBalance) {
      if (part.amount > 0n) total += part.amount;
    } else if (part.transferFamily === "cash") {
      // Between cash accounts: the money stays in the pool with its age.
    } else if (part.transferFamily === "credit") {
      if (part.amount < 0n) total += part.amount;
    } else {
      total += part.amount;
    }
  }
  return total;
}

/** Money entering (> 0) or leaving (< 0) the pool on a date. */
export interface MoneyFlow {
  /** YYYY-MM-DD. */
  date: string;
  amount: bigint;
}

export interface OutflowAge {
  date: string;
  /** Whole days. */
  days: number;
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) =>
  Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS;

export function addDays(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The age of every outflow, oldest first. Flows on the same date keep their given order (enter
 * them in the order they were entered).
 */
export function outflowAges(flows: readonly MoneyFlow[]): OutflowAge[] {
  const sorted = flows
    .filter((f) => f.amount !== 0n)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const pool: { day: number; amount: bigint }[] = [];
  let head = 0;
  let shortfall = 0n;
  const ages: OutflowAge[] = [];
  for (const flow of sorted) {
    const day = dayNumber(flow.date);
    if (flow.amount > 0n) {
      let amount = flow.amount;
      const repay = amount < shortfall ? amount : shortfall;
      shortfall -= repay;
      amount -= repay;
      if (amount > 0n) pool.push({ day, amount });
      continue;
    }
    const spent = -flow.amount;
    let need = spent;
    let dayAmounts = 0n;
    while (need > 0n && head < pool.length) {
      const lot = pool[head] as { day: number; amount: bigint };
      const take = lot.amount < need ? lot.amount : need;
      dayAmounts += take * BigInt(day - lot.day);
      need -= take;
      lot.amount -= take;
      if (lot.amount === 0n) head++;
    }
    shortfall += need;
    ages.push({ date: flow.date, days: Number(dayAmounts / spent) });
  }
  return ages;
}

/**
 * Age of Money as of the end of `asOf` (YYYY-MM-DD; default: after every outflow), or null with
 * fewer than ten outflows by then. `ages` as `outflowAges` returns them.
 */
export function ageOfMoneyAt(ages: readonly OutflowAge[], asOf?: string): number | null {
  let end = ages.length;
  if (asOf !== undefined) while (end > 0 && (ages[end - 1] as OutflowAge).date > asOf) end--;
  if (end < AGE_OF_MONEY_OUTFLOWS) return null;
  let sum = 0;
  for (let i = end - AGE_OF_MONEY_OUTFLOWS; i < end; i++) sum += (ages[i] as OutflowAge).days;
  return Math.floor(sum / AGE_OF_MONEY_OUTFLOWS);
}

/**
 * Age of Money at each month's end from `from` to `today`'s month (the current month as of
 * `today`), one point per month.
 */
export function ageOfMoneyByMonth(
  ages: readonly OutflowAge[],
  from: BudgetMonth,
  today: string,
): { month: BudgetMonth; days: number | null }[] {
  const last = monthOf(today);
  const out: { month: BudgetMonth; days: number | null }[] = [];
  for (let month = from; month <= last; month = addMonths(month, 1)) {
    const end = month === last ? today : monthBounds(month).end;
    out.push({ month, days: ageOfMoneyAt(ages, end) });
  }
  return out;
}
