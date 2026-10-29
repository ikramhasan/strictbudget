import type { BudgetMonth, CategoryMonth } from "./months";
import { type CategoryTarget, type TargetNeed, weeklyDays } from "./targets";

/** A stretch of a section: money spent, money still available, or spending beyond the money. */
export interface BarSegment {
  kind: "spent" | "available" | "overspent";
  amount: bigint;
}

export interface BarSection {
  /**
   * rollover: money carried in for a "Set aside another…" target; target: the month, the target
   * (period) or one of its weeks; extra: a weekly target's money or spending beyond its weeks.
   */
  kind: "rollover" | "target" | "extra";
  /** How much the section stands for; sections are drawn in proportion to it. */
  size: bigint;
  /** In drawing order; they may not fill the section (the rest is empty). */
  segments: BarSegment[];
}

export interface ProgressBar {
  /** underfunded draws yellow (the target still asks for money), funded draws green. */
  tone: "funded" | "underfunded";
  sections: BarSection[];
}

/**
 * The progress bar under a category in `month`:
 * - Sections: one for the month (no target, snoozed, refill) or the target period (dated targets);
 *   "Set aside another…" monthly and weekly targets put money carried in first, in its own
 *   section; weekly targets get a section per week and an extra one for money or spending beyond
 *   them. Otherwise the one section grows to the money or spending when it's more than the target.
 * - Money (what counts toward the target, or carried in plus assigned without one) fills the
 *   sections in order; spending eats it from the first section on; spending beyond it fills the
 *   empty space, then extends the bar. Inflows that aren't assigned money aren't drawn.
 * - Yellow while the target asks for more this month; green otherwise.
 */
export function progressBar(
  figures: Pick<CategoryMonth, "carried" | "assigned" | "activity">,
  target:
    | (Pick<CategoryTarget, "cadence" | "behavior" | "amount" | "dueDay"> &
        Partial<Pick<CategoryTarget, "startMonth" | "startDay" | "goal">>)
    | null,
  need: TargetNeed | null,
  snoozed: boolean,
  month: BudgetMonth,
  /** A dated set aside target's money left from its last period (`periodRollover`). */
  rollover = 0n,
): ProgressBar {
  const spent = figures.activity < 0n ? -figures.activity : 0n;
  const positive = (v: bigint) => (v > 0n ? v : 0n);
  const sections: (BarSection & { money: bigint })[] = [];
  let tone: ProgressBar["tone"] = "funded";
  let weekly = false;

  if (!target || !need || snoozed) {
    // The month: what was carried in plus assigned.
    sections.push({ kind: "target", size: 0n, money: 0n, segments: [] });
    fill(sections, positive(figures.carried + figures.assigned));
  } else {
    if (need.underfunded > 0n) tone = "underfunded";
    weekly = target.cadence === "weekly";
    // A save-up goal fills with everything put in, as a dated target does.
    const setAsideMonthly =
      target.behavior === "set_aside" &&
      target.goal !== "save_up" &&
      (weekly || target.cadence === "monthly" || target.cadence === "debt_monthly");
    const carriedIn = setAsideMonthly ? figures.carried : rollover;
    if (carriedIn > 0n) {
      sections.push({ kind: "rollover", size: carriedIn, money: carriedIn, segments: [] });
    }
    if (weekly) {
      const weeks = weeklyDays(target, month).length;
      for (let i = 0; i < weeks; i++) {
        sections.push({ kind: "target", size: target.amount, money: 0n, segments: [] });
      }
    } else {
      sections.push({ kind: "target", size: need.needed, money: 0n, segments: [] });
    }
    fill(sections, positive(setAsideMonthly ? figures.assigned : need.funded), weekly);
  }

  // Spending eats the money from the first section on.
  let left = spent;
  for (const s of sections) {
    const used = left < s.money ? left : s.money;
    left -= used;
    if (used > 0n) s.segments.push({ kind: "spent", amount: used });
    if (s.money > used) s.segments.push({ kind: "available", amount: s.money - used });
  }
  // Spending beyond the money fills the empty space, then extends the bar.
  for (const s of sections) {
    if (left === 0n) break;
    const room = s.size - s.money;
    const over = left < room ? left : room;
    if (over > 0n) {
      s.segments.push({ kind: "overspent", amount: over });
      left -= over;
    }
  }
  if (left > 0n) {
    const last = grow(sections, left, weekly);
    last.segments.push({ kind: "overspent", amount: left });
  }
  return { tone, sections: sections.map(({ money: _money, ...s }) => s) };
}

/** Puts `money` into the sections that don't have theirs yet, in order; the rest goes on the end. */
function fill(sections: (BarSection & { money: bigint })[], money: bigint, weekly = false) {
  let left = money;
  for (const s of sections) {
    if (s.kind === "rollover") continue;
    const put = left < s.size ? left : s.size;
    s.money += put;
    left -= put;
  }
  if (left > 0n) grow(sections, left, weekly).money += left;
}

/** Makes room for `amount` more: an extra section for weekly targets, else the last one grows. */
function grow(sections: (BarSection & { money: bigint })[], amount: bigint, weekly: boolean) {
  const last = sections[sections.length - 1];
  if (last && (!weekly || last.kind === "extra")) {
    last.size += amount;
    return last;
  }
  const extra = { kind: "extra" as const, size: amount, money: 0n, segments: [] };
  sections.push(extra);
  return extra;
}
