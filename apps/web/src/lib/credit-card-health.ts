import type { components } from "@strictbudget/api-client";
import { BUDGET_MONTH_PATTERN, type BudgetMonth, type CardCoverage } from "@strictbudget/engine";
import { z } from "zod";
import { $api } from "./api";
import { todayIso } from "./dates";

export type CreditCardHealth = components["schemas"]["CreditCardHealth"];
export type HealthCard = CreditCardHealth["cards"][number];

/** The report's URL: the last month shown, and chart or table. */
export const creditCardHealthSearchSchema = z.object({
  month: z.string().regex(BUDGET_MONTH_PATTERN).optional().catch(undefined),
  view: z.enum(["chart", "table"]).optional().catch(undefined),
});

/** The cards' health (`GET /reports/credit-card-health`), six months ending at `month`. */
export const creditCardHealthOptions = (budgetId: string, month?: BudgetMonth) =>
  $api.queryOptions("get", "/v1/budgets/{budgetId}/reports/credit-card-health", {
    params: { path: { budgetId }, query: { today: todayIso(), month, months: 6 } },
  });

export const COVERAGE_LABELS: Record<CardCoverage, string> = {
  covered: "Paid in full ready",
  partial: "Partly covered",
  unfunded: "Unfunded debt",
};

export const COVERAGE_HELP: Record<CardCoverage, string> = {
  covered:
    "The card's payment category has at least as much as the card owes, so you could pay it off today.",
  partial:
    "Some of what the card owes is set aside in its payment category. The rest was spent on the card without money in the category behind it.",
  unfunded:
    "Nothing is set aside for what the card owes. This is debt from before the budget, or spending the categories couldn't cover. Assigning money to the payment category sets it aside.",
};

export const COVERAGE_TONES: Record<CardCoverage, string> = {
  covered: "text-green-700 dark:text-green-400",
  partial: "text-yellow-800 dark:text-yellow-300",
  unfunded: "text-red-700 dark:text-red-400",
};
