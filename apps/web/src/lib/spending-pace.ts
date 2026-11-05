import type { components } from "@strictbudget/api-client";
import {
  BUDGET_MONTH_PATTERN,
  type BudgetMonth,
  monthOf,
  type PaceStatus,
} from "@strictbudget/engine";
import { format, parseISO } from "date-fns";
import { z } from "zod";
import { $api } from "./api";
import { todayIso } from "./dates";

export type SpendingPace = components["schemas"]["SpendingPace"];
export type PaceLine = SpendingPace["line"];
export type PaceCategory = SpendingPace["categories"][number];
export type PaceSummary = PaceCategory["pace"];

const id = z.string().optional().catch(undefined);

/** The report's URL: the month, the line shown (a group or one category) and chart or table. */
export const spendingPaceSearchSchema = z.object({
  month: z.string().regex(BUDGET_MONTH_PATTERN).optional().catch(undefined),
  group: id,
  category: id,
  view: z.enum(["chart", "table"]).optional().catch(undefined),
});
export type SpendingPaceSearch = z.infer<typeof spendingPaceSearchSchema>;

/**
 * A month's pace (`GET /reports/spending-pace`): the plan's line unless a group or category. The
 * month is always explicit (today's by default), so the plan's panel, the Reports home and the
 * report read one cached answer for the same month.
 */
export const spendingPaceOptions = (
  budgetId: string,
  { month, groupId, categoryId }: { month?: BudgetMonth; groupId?: string; categoryId?: string },
) => {
  const today = todayIso();
  return $api.queryOptions("get", "/v1/budgets/{budgetId}/reports/spending-pace", {
    params: {
      path: { budgetId },
      query: { today, month: month ?? monthOf(today), groupId, categoryId },
    },
  });
};

export const STATUS_LABELS: Record<PaceStatus, string> = {
  ahead: "Ahead",
  on_pace: "On pace",
  behind: "Behind",
};

export const STATUS_TONES: Record<PaceStatus, string> = {
  ahead: "text-green-700 dark:text-green-400",
  on_pace: "text-muted-foreground",
  behind: "text-red-700 dark:text-red-400",
};

/** "Nov 22". */
export const dayLabel = (date: string) => format(parseISO(date), "MMM d");

/**
 * The one line that answers "am I on track?": when the money ran or will run out, or what's left
 * at the month's end at the pace so far.
 */
export function paceCallout(
  line: PaceSummary,
  finished: boolean,
  formatAmount: (minorUnits: bigint) => string,
): string {
  const remaining = BigInt(line.remaining);
  if (line.status === null) return "Nothing to spend this month.";
  if (finished) {
    return remaining < 0n
      ? `Overspent by ${formatAmount(-remaining)}.`
      : `Finished with ${formatAmount(remaining)} left.`;
  }
  if (line.runOutDate) {
    return remaining < 0n
      ? `Ran out on ${dayLabel(line.runOutDate)}: ${formatAmount(-remaining)} over.`
      : `At this pace you'll run out on ${dayLabel(line.runOutDate)}.`;
  }
  const lead = line.status === "ahead" ? "Ahead of pace" : "On pace";
  return `${lead}, about ${formatAmount(BigInt(line.projectedEnd))} left at month end.`;
}

/** Why a category is out of pace by default, in words. */
export const REASON_LABELS: Record<NonNullable<PaceCategory["reason"]>, string> = {
  bill: "A bill (its target has a due date)",
  saving: "Saving up (a balance target)",
  scheduled: "Has a scheduled transaction",
  hidden: "Hidden",
};

const LEFT_OUT: Record<NonNullable<PaceCategory["reason"]> | "setting", string> = {
  bill: "bills",
  saving: "savings",
  scheduled: "scheduled",
  hidden: "hidden",
  setting: "switched off",
};

/**
 * What the plan's line covers, in words: the categories counted and why the rest aren't ("12
 * categories counted; 3 left out: bills, savings"). The line is everyday spending, not the month's
 * Available, so the two can differ.
 */
export function paceScope(categories: readonly PaceCategory[]): string {
  const counted = categories.filter((c) => c.included).length;
  const out = categories.filter((c) => !c.included);
  const noun = (n: number) => `${n} ${n === 1 ? "category" : "categories"}`;
  if (out.length === 0) return `All ${noun(counted)} you spend from are counted.`;
  const why = [...new Set(out.map((c) => LEFT_OUT[c.reason ?? "setting"]))];
  return `${noun(counted)} counted; ${out.length} left out (${why.join(", ")}).`;
}
