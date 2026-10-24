import type { components } from "@strictbudget/api-client";
import { BUDGET_MONTH_PATTERN, type BudgetMonth, type PaceStatus } from "@strictbudget/engine";
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

/** A month's pace (`GET /reports/spending-pace`): the plan's line unless a group or category. */
export const spendingPaceOptions = (
  budgetId: string,
  { month, groupId, categoryId }: { month?: BudgetMonth; groupId?: string; categoryId?: string },
) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/reports/spending-pace", {
    params: { path: { budgetId }, query: { today: todayIso(), month, groupId, categoryId } },
  });

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
