import { targetPercent } from "@strictbudget/engine";
import { useCallback, useState } from "react";
import { useProgressBarsSetting } from "./display-options";
import type { BudgetMonthData, MonthTotals } from "./months";
import type { TargetNeed } from "./targets";

export const BUDGET_FILTERS = [
  "all",
  "overspent",
  "underfunded",
  "overfunded",
  "available",
  "snoozed",
] as const;
export type BudgetFilter = (typeof BUDGET_FILTERS)[number];

export const UNCATEGORIZED = "uncategorized";

/**
 * Whether a category's numbers belong in a view: Overspent is below zero, Money Available above;
 * Underfunded is anything Underfunded would add to (overspending included), Overfunded anything
 * Reduce Overfunding would take from. Uncategorized, with no Auto-Assign, counts as underfunded
 * while it's negative. Snoozed is a target snoozed this month.
 */
export function matchesFilter(
  filter: BudgetFilter,
  totals: {
    available: string;
    assigned?: string;
    autoAssign?: { underfunded: string; reduceOverfunding: string };
    target?: { snoozed: boolean } | null;
  },
) {
  if (filter === "all") return true;
  const available = BigInt(totals.available);
  const { assigned = "0", autoAssign } = totals;
  switch (filter) {
    case "overspent":
      return available < 0n;
    case "available":
      return available > 0n;
    case "underfunded":
      return autoAssign ? BigInt(autoAssign.underfunded) > BigInt(assigned) : available < 0n;
    case "overfunded":
      return autoAssign ? BigInt(autoAssign.reduceOverfunding) < BigInt(assigned) : false;
    case "snoozed":
      return Boolean(totals.target?.snoozed);
  }
}

export const EMPTY_VIEW: Record<Exclude<BudgetFilter, "all">, string> = {
  overspent: "That's a win! You've knocked out all overspent categories.",
  underfunded: "Cheers! You don't currently have any underfunded categories.",
  overfunded: "You don't currently have any overfunded targets.",
  available: "You don't currently have categories with money available.",
  snoozed: "You don't currently have categories with snoozed targets in this month.",
};

/**
 * Visible categories only (hidden ones are left out of every view but All), plus Uncategorized when
 * it matches.
 */
export function filteredIds(
  filter: BudgetFilter,
  month: BudgetMonthData,
  visible: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  for (const c of month.categories) {
    if (visible.has(c.categoryId) && matchesFilter(filter, c)) ids.add(c.categoryId);
  }
  if (month.uncategorized && matchesFilter(filter, month.uncategorized)) ids.add(UNCATEGORIZED);
  return ids;
}

/**
 * Whether all of the month's overspending is credit overspending, which draws the Overspent view in
 * yellow; any cash overspending makes it red.
 */
export function overspentOnlyCredit(month: BudgetMonthData, visible: ReadonlySet<string>) {
  const cash = [
    ...month.categories.filter((c) => visible.has(c.categoryId)),
    ...(month.uncategorized ? [month.uncategorized] : []),
  ].some((c) => c.cashOverspent !== "0");
  return !cash && overspentCount(month, visible) > 0;
}

export function overspentCount(month: BudgetMonthData, visible: ReadonlySet<string>) {
  return filteredIds("overspent", month, visible).size;
}

/**
 * What a category's upcoming scheduled transactions need beyond Available (a negative "Available
 * After Upcoming"); zero when it covers them or nothing is coming.
 */
export function upcomingShortfall(totals: {
  available: string;
  upcoming?: { amount: string } | null;
}): bigint {
  if (!totals.upcoming) return 0n;
  const after = BigInt(totals.available) + BigInt(totals.upcoming.amount);
  return after < 0n && BigInt(totals.upcoming.amount) < 0n ? -after : 0n;
}

/**
 * Whether a category's Available is yellow: overspent with credit only (any uncovered cash part
 * keeps it red), not enough for what's scheduled later in the month (snoozed or not), an
 * underfunded target that isn't snoozed, or a payment category that doesn't cover what its card
 * owes (or, with a target, what the target asks). A payment's Underfunded shows only from the
 * current month on, and paying more than was set aside is red.
 */
export function isCaution(
  totals: Pick<MonthTotals, "available" | "cashOverspent"> & {
    payment?: { underfunded: string } | null;
    target?: { underfunded: string; snoozed?: boolean } | null;
    upcoming?: { amount: string } | null;
  },
  month: string,
  current: string,
) {
  const scheduledShort = !totals.available.startsWith("-") && upcomingShortfall(totals) > 0n;
  if (totals.payment) {
    if (totals.available.startsWith("-")) return false;
    if (scheduledShort) return true;
    // With a target, its own status decides, as for any target.
    if (totals.target) return totals.target.underfunded !== "0";
    return totals.payment.underfunded !== "0" && month >= current;
  }
  if (totals.available.startsWith("-")) return totals.cashOverspent === "0";
  if (scheduledShort) return true;
  return Boolean(totals.target && totals.target.underfunded !== "0" && !totals.target.snoozed);
}

/**
 * The icon on a category's Available pill: a target's pie filled to the funded percentage while
 * underfunded, a check when met, Zz when snoozed, and a calendar when scheduled transactions later
 * in the month aren't covered.
 */
export type TargetMark =
  | { kind: "met" }
  | { kind: "underfunded"; percent: number }
  | { kind: "snoozed" }
  | { kind: "upcoming" };

/**
 * The calendar when upcoming scheduled transactions aren't covered wins over a target's pie or
 * check; a snoozed target keeps its Zz. Payment categories keep their target's mark.
 */
export function availableMark(totals: {
  available: string;
  target?: TargetNeed | null;
  payment?: unknown;
  upcoming?: { amount: string } | null;
}): TargetMark | undefined {
  if (!totals.payment && !totals.target?.snoozed && upcomingShortfall(totals) > 0n) {
    return { kind: "upcoming" };
  }
  return targetMark(totals.target);
}

export function targetMark(target: TargetNeed | null | undefined): TargetMark | undefined {
  if (!target) return undefined;
  if (target.snoozed) return { kind: "snoozed" };
  const needed = BigInt(target.needed);
  const funded = BigInt(target.funded);
  return funded >= needed
    ? { kind: "met" }
    : { kind: "underfunded", percent: targetPercent({ needed, funded }) };
}

export interface Breakdown {
  carried: bigint;
  assigned: bigint;
  activity: bigint;
  /** The part of activity in cash accounts (Cash Spending). */
  cashActivity: bigint;
  /** The part of activity in credit accounts (Credit Spending). */
  creditActivity: bigint;
  available: bigint;
  /** The cash part of a negative Available (taken from next month's Ready to Assign). */
  cashOverspent: bigint;
  /** The credit part of a negative Available (new card debt). */
  creditOverspent: bigint;
}

export function breakdown(totals: MonthTotals): Breakdown {
  const assigned = BigInt(totals.assigned);
  const activity = BigInt(totals.activity);
  const available = BigInt(totals.available);
  return {
    carried: available - assigned - activity,
    assigned,
    activity,
    cashActivity: BigInt(totals.cashActivity),
    creditActivity: BigInt(totals.creditActivity),
    available,
    cashOverspent: BigInt(totals.cashOverspent),
    creditOverspent: BigInt(totals.creditOverspent),
  };
}

export function toTotals(b: Breakdown): MonthTotals {
  return {
    assigned: b.assigned.toString(),
    activity: b.activity.toString(),
    cashActivity: b.cashActivity.toString(),
    creditActivity: b.creditActivity.toString(),
    available: b.available.toString(),
    cashOverspent: b.cashOverspent.toString(),
    creditOverspent: b.creditOverspent.toString(),
  };
}

/**
 * The inspector's month summary over the given categories (`UNCATEGORIZED` included), adding up
 * the rows in view: every category, hidden ones too, under All.
 */
export function summarize(month: BudgetMonthData, ids: Iterable<string>): Breakdown {
  const byId = new Map(month.categories.map((c) => [c.categoryId, c]));
  const sum: Breakdown = {
    carried: 0n,
    assigned: 0n,
    activity: 0n,
    cashActivity: 0n,
    creditActivity: 0n,
    available: 0n,
    cashOverspent: 0n,
    creditOverspent: 0n,
  };
  for (const id of ids) {
    const totals =
      id === UNCATEGORIZED
        ? month.uncategorized && { assigned: "0", ...month.uncategorized }
        : byId.get(id);
    if (!totals) continue;
    const b = breakdown(totals);
    sum.carried += b.carried;
    sum.assigned += b.assigned;
    sum.activity += b.activity;
    sum.cashActivity += b.cashActivity;
    sum.creditActivity += b.creditActivity;
    sum.cashOverspent += b.cashOverspent;
    sum.creditOverspent += b.creditOverspent;
    sum.available += b.available;
  }
  return sum;
}

export function isPresetFilter(view: string): view is BudgetFilter {
  return (BUDGET_FILTERS as readonly string[]).includes(view);
}

function readFilter(key: string): string {
  try {
    return localStorage.getItem(key) || "all";
  } catch {
    return "all";
  }
}

/**
 * The budget list's view: a preset (`BudgetFilter`) or a custom view's id, kept across reloads and
 * months in this browser, per budget.
 */
export function useBudgetFilter(budgetId: string) {
  const key = `strictbudget:budget-filter:${budgetId}`;
  const [filter, setFilter] = useState<string>(() => readFilter(key));
  const update = useCallback(
    (next: string) => {
      setFilter(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Storage can be unavailable (private windows); the view still works for this visit.
      }
    },
    [key],
  );
  return { filter, setFilter: update };
}

export function useProgressBars() {
  const [progressBars, setProgressBars] = useProgressBarsSetting();
  return { progressBars, setProgressBars };
}

/**
 * Whether the view at `index` on the views bar (All is 0) fits a `viewportWidth`-pixel window, by
 * fixed breakpoints rather than measuring the buttons: below 20rem only the selected view shows;
 * from 20rem views 0 and 2 do, view 1 from 29.875rem, and each later view 9.875rem after the one
 * before (view i from 20 + (i - 2) × 9.875rem). The rest go into the Views Menu; the selected view
 * always stays.
 */
export function fitsViewsBar(index: number, viewportWidth: number) {
  const rem = viewportWidth / 16;
  const from = index === 1 ? 29.875 : 20 + Math.max(index - 2, 0) * 9.875;
  return rem >= from;
}
