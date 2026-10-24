import { createRoute, type RouteHandler, z } from "@hono/zod-openapi";
import {
  addDays,
  ageOfMoneyAt,
  ageOfMoneyByMonth,
  BUDGET_MONTH_PATTERN,
  monthOf,
  outflowAges,
} from "@strictbudget/engine";
import { ageOfMoneyFlows } from "../../lib/age-of-money";
import { loadBudgetAccess } from "../../lib/budget-access";
import { jsonError } from "../../lib/errors";
import { userToday as clampedToday, enterDueScheduled, entryDate } from "../../lib/scheduled";
import { type AuthedEnv, authSecurity, requireAuth } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";

const Days = z.number().int().nullable();

export const getAgeOfMoney = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/reports/age-of-money",
  operationId: "getAgeOfMoney",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Age of Money now, 30 days ago, and at each month's end",
  description:
    "Age of Money: the average age in days of the last ten outflows from cash accounts " +
    "(credit card payments and transfers to loan or tracking accounts included), each outflow's " +
    "money taken oldest first. Null when there have been fewer than ten outflows.",
  request: {
    params: z.object({
      budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
    }),
    query: z.object({
      today: z.iso
        .date()
        .optional()
        .describe(
          "The user's today; later transactions don't count. Defaults to the server's UTC date.",
        ),
    }),
  },
  responses: {
    200: {
      description: "Age of Money",
      content: {
        "application/json": {
          schema: z
            .object({
              asOf: z.iso.date().describe("The day `current` is for (the user's today)"),
              current: Days.describe("Age of Money today, in days"),
              thirtyDaysAgo: Days.describe("Age of Money as of 30 days before `asOf`"),
              months: z
                .array(
                  z.object({
                    month: z.string().regex(BUDGET_MONTH_PATTERN),
                    days: Days.describe("As of the month's last day (today for this month)"),
                  }),
                )
                .describe(
                  "Each month from the first one with a cash-account transaction to this month",
                ),
            })
            .openapi("AgeOfMoney"),
        },
      },
    },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const getAgeOfMoneyHandler: RouteHandler<typeof getAgeOfMoney, AppEnv & AuthedEnv> = async (
  c,
) => {
  const { budgetId } = c.req.valid("param");
  const { today: userToday } = c.req.valid("query");
  const deps = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  const today = clampedToday(deps, userToday);
  if (userToday) await enterDueScheduled(deps.db, deps, budgetId, entryDate(deps, userToday));
  const flows = await ageOfMoneyFlows(deps.db, budgetId, today);
  const ages = outflowAges(flows);
  const [first] = flows;
  return c.json(
    {
      asOf: today,
      current: ageOfMoneyAt(ages, today),
      thirtyDaysAgo: ageOfMoneyAt(ages, addDays(today, -30)),
      months: first ? ageOfMoneyByMonth(ages, monthOf(first.date), today) : [],
    },
    200,
  );
};
