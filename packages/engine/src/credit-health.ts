export const CARD_COVERAGE = ["covered", "partial", "unfunded"] as const;
export type CardCoverage = (typeof CARD_COVERAGE)[number];

export interface CardHealth {
  status: CardCoverage;
  /** What's set aside for the balance (never more than it, never below zero). */
  covered: bigint;
  /** What the card's payment category still lacks: the plan screen's Underfunded. */
  gap: bigint;
  /** Of `gap`, what a category's credit overspending this month added (the rest is older debt). */
  fromCreditOverspending: bigint;
  /** Of `gap`, everything else: spending not yet funded, starting debt, payments above Available. */
  other: bigint;
}

/**
 * Where a card stands against its payment category. `owed` is the balance owed (zero when it owes
 * nothing), `gap` the payment category's Underfunded on the plan screen (the debt Available
 * doesn't reach, plus a negative Available while the card owes), and `fromOverspending` the part
 * of it that this month's credit overspending explains. Taking the gap from the plan screen keeps
 * the report's numbers equal to it.
 *
 * - `covered`: nothing lacks (Available pays the balance, or the card owes nothing).
 * - `partial`: some of the balance is set aside, not all.
 * - `unfunded`: none of it is.
 */
export function cardHealth(owed: bigint, gap: bigint, fromOverspending: bigint): CardHealth {
  const covered = owed > gap ? owed - gap : 0n;
  const status: CardCoverage = gap <= 0n ? "covered" : covered > 0n ? "partial" : "unfunded";
  const fromCreditOverspending = fromOverspending < gap ? fromOverspending : gap;
  return {
    status,
    covered,
    gap,
    fromCreditOverspending,
    other: gap - fromCreditOverspending,
  };
}

/**
 * The most Ready to Assign can put toward a card's gap: all of it, or what Ready to Assign has
 * (nothing when it's zero or negative).
 */
export function coverAmount(gap: bigint, readyToAssign: bigint): bigint {
  if (gap <= 0n || readyToAssign <= 0n) return 0n;
  return gap < readyToAssign ? gap : readyToAssign;
}
