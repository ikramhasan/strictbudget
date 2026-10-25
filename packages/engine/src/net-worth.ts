import { type AccountType, accountFamily } from "./accounts";

/**
 * Net worth: each account's balance at the
 * end of every month (the last day's working balance, uncleared included; the current month is
 * today's), on- and off-budget, closed accounts included with whatever they hold. Assets are the
 * accounts with a positive balance, debts those with a negative one, decided per account by its
 * sign, not by its type.
 */
export interface NetWorthTotals {
  /** Σ of the positive balances (≥ 0). */
  assets: bigint;
  /** Σ of the negative balances (≤ 0). */
  debts: bigint;
  netWorth: bigint;
}

/** Assets, debts and net worth of a month's balances; null balances (no rate) are left out. */
export function netWorthTotals(balances: Iterable<bigint | null>): NetWorthTotals {
  let assets = 0n;
  let debts = 0n;
  for (const b of balances) {
    if (b === null) continue;
    if (b > 0n) assets += b;
    else debts += b;
  }
  return { assets, debts, netWorth: assets + debts };
}

/** The waterfall's account groups: budget accounts (cash and credit), loans, tracking accounts. */
export type NetWorthGroup = "budget" | "loan" | "tracking";

export function netWorthGroup(type: AccountType): NetWorthGroup {
  const family = accountFamily(type);
  return family === "cash" || family === "credit" ? "budget" : family;
}

/** One account's month for the waterfall, in the budget's currency (the transactions' base amounts). */
export interface NetWorthFlows {
  group: NetWorthGroup;
  /** Everything the month's transactions added, starting balances and transfers included. */
  total: bigint;
  /** The month's Starting Balance transactions. */
  starting: bigint;
  /** The month's transfers (either side; into a loan is positive). */
  transfers: bigint;
}

/**
 * "What changed this month": last month's net worth to this month's, in four parts that always
 * add up to `change` exactly.
 *
 * - `netSaved`, net saved from income: the budget accounts' cash flow, what their transactions
 *   added (income less spending, money sent to loans and tracking accounts counting as spent, as
 *   the plan sees it), starting balances left out. Transfers between budget accounts cancel out.
 * - `debtPaidDown`: transfers into loan accounts (payments; a transfer out of a loan, borrowing,
 *   counts negative).
 * - `tracking`: what the tracking accounts' transactions added (contributions, value updates),
 *   starting balances left out.
 * - `other`: the rest. That's starting balances of new accounts, loan interest, escrow and other
 *   loan adjustments, and in a multi-currency budget the change in what foreign balances are worth
 *   at the month-end rate (flows count at the rate they were booked at).
 */
export interface NetWorthParts {
  netSaved: bigint;
  debtPaidDown: bigint;
  tracking: bigint;
  other: bigint;
}

export function netWorthParts(change: bigint, flows: Iterable<NetWorthFlows>): NetWorthParts {
  let netSaved = 0n;
  let debtPaidDown = 0n;
  let tracking = 0n;
  for (const f of flows) {
    if (f.group === "budget") netSaved += f.total - f.starting;
    else if (f.group === "loan") debtPaidDown += f.transfers;
    else tracking += f.total - f.starting;
  }
  return { netSaved, debtPaidDown, tracking, other: change - netSaved - debtPaidDown - tracking };
}

/**
 * Which months set a new all-time high: a net worth above every earlier month-end since the first
 * one in `netWorths` (the budget's first month). The first month only sets the baseline.
 */
export function allTimeHighs(netWorths: readonly bigint[]): boolean[] {
  let best: bigint | null = null;
  return netWorths.map((nw) => {
    const high = best !== null && nw > best;
    if (best === null || nw > best) best = nw;
    return high;
  });
}
