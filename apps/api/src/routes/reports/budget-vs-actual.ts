import { createRoute, type RouteHandler, z } from "@hono/zod-openapi";
import { category, categoryGroup } from "@strictbudget/db/schema";
import {
  addMonths,
  BUDGET_MONTH_PATTERN,
  type BudgetMonth,
  categoryMonth,
  monthBounds,
  monthOf,
  targetNeed,
  zCurrencyCode,
  zMinorUnits,
} from "@strictbudget/engine";
import { asc, eq } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError, jsonError } from "../../lib/errors";
import { enterDueScheduled, entryDate, userToday } from "../../lib/scheduled";
import type { AuthedEnv } from "../../middleware/require-auth";
import { authSecurity, requireAuth } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { budgetHistory, loadTargets, monthRange } from "../months/handlers";

const Month = z.string().regex(BUDGET_MONTH_PATTERN, "Expected a month as YYYY-MM");

/** How many months the heatmap and the over-plan count look back over at least. */
const HISTORY_MONTHS = 12;

const MonthFiguresSchema = z
  .object({
    month: Month,
    assigned: zMinorUnits.describe("The plan's Assigned (money moves included)"),
    activity: zMinorUnits.describe("The plan's Activity; spending is negative"),
    available: zMinorUnits.describe("The plan's Available at the month's end"),
    cashOverspent: zMinorUnits.describe("The cash part of a negative Available (≤ 0)"),
    creditOverspent: zMinorUnits.describe("The credit part of a negative Available (≤ 0)"),
    targetAmount: zMinorUnits
      .nullable()
      .describe("What the category's target asks of the month (the plan's month targets)"),
  })
  .openapi("BudgetVsActualMonth");

const BudgetVsActualSchema = z
  .object({
    currency: zCurrencyCode.describe("The budget's currency, every amount's"),
    firstMonth: Month.describe("The plan's first month"),
    months: z
      .array(Month)
      .describe(
        `The months returned: the range, reaching back to at least ${HISTORY_MONTHS} months ` +
          "before its end, within the plan's months (`firstMonth` to the plan's last month)",
      ),
    categories: z.array(
      z
        .object({
          categoryId: z.string(),
          groupId: z.string(),
          uncategorized: z.boolean(),
          hidden: z.boolean().describe("The category or its group is hidden"),
          months: z.array(MonthFiguresSchema).describe("One per month of `months`"),
        })
        .openapi("BudgetVsActualCategory"),
    ),
  })
  .openapi("BudgetVsActual");

export const getBudgetVsActual = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/reports/budget-vs-actual",
  operationId: "getBudgetVsActual",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Each category's Assigned against its Activity, month by month, as the plan shows them",
  description:
    "The plan's own numbers for every spending category with something assigned or spent in " +
    "`months`, in plan order, Uncategorized first. Ready to Assign and credit card payment " +
    "categories are left out. Transactions after `today` don't count yet.",
  request: {
    params: z.object({
      budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
    }),
    query: z.object({
      from: Month.describe("First month, YYYY-MM"),
      to: Month.describe("Last month, YYYY-MM (inclusive)"),
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
      description: "The report",
      content: { "application/json": { schema: BudgetVsActualSchema } },
    },
    400: jsonError("Invalid query, or `from` after `to`"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

function monthsBetween(from: BudgetMonth, to: BudgetMonth) {
  const months: BudgetMonth[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m);
  return months;
}

export const getBudgetVsActualHandler: RouteHandler<
  typeof getBudgetVsActual,
  AppEnv & AuthedEnv
> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const query = c.req.valid("query");
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  if (query.from > query.to) throw new AppError(400, "BAD_REQUEST", "`from` is after `to`");
  const today = userToday(c.var.deps, query.today);
  if (query.today) {
    await enterDueScheduled(db, c.var.deps, budgetId, entryDate(c.var.deps, query.today));
  }
  const from = query.from as BudgetMonth;
  const to = query.to as BudgetMonth;
  // Only the plan's own months (as the plan screen offers them): months outside hold nothing, and
  // the walk stays bounded however wide a range is asked for.
  const { first, last } = await monthRange(db, budgetId, today);
  const lookBack = addMonths(to, -(HISTORY_MONTHS - 1));
  const wanted = from < lookBack ? from : lookBack;
  const start = wanted < first ? first : wanted;
  const end = to > last ? last : to;
  const months = start <= end ? monthsBetween(start, end) : [];

  // The plan's history up to the range's end (or today): each month's numbers are the plan's for
  // that month, since later transactions never change an earlier month.
  const rangeEnd = monthBounds(to).end;
  const { history, paymentAccounts } = await budgetHistory(
    db,
    budgetId,
    rangeEnd < today ? rangeEnd : today,
  );
  const paymentCategories = new Set(paymentAccounts.values());
  const { targets } = await loadTargets(db, c.var.deps, budget, today);
  const current = monthOf(today);

  const rows = await db
    .select({
      id: category.id,
      groupId: category.groupId,
      hidden: category.hidden,
      groupHidden: categoryGroup.hidden,
      internalKind: category.internalKind,
    })
    .from(category)
    .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
    .where(eq(category.budgetId, budgetId))
    .orderBy(asc(categoryGroup.sortOrder), asc(category.sortOrder), asc(category.id));

  const listed = rows
    .filter((r) => r.internalKind !== "ready_to_assign" && !paymentCategories.has(r.id))
    .flatMap((r) => {
      const entries = history.get(r.id) ?? [];
      const target = targets.get(r.id);
      const figures = months.map((month) => {
        const f = categoryMonth(entries, month);
        // Payment categories are left out, so no target here pays toward what a card owes.
        const need = target ? targetNeed(entries, target, month, current) : null;
        return {
          month,
          assigned: f.assigned.toString(),
          activity: f.activity.toString(),
          available: f.available.toString(),
          cashOverspent: f.cashOverspent.toString(),
          creditOverspent: f.creditOverspent.toString(),
          targetAmount: need ? need.monthAmount.toString() : null,
        };
      });
      const active = figures.some((f) => f.assigned !== "0" || f.activity !== "0");
      if (!active) return [];
      return [
        {
          categoryId: r.id,
          groupId: r.groupId,
          uncategorized: r.internalKind === "uncategorized",
          hidden: r.internalKind !== "uncategorized" && (r.hidden || r.groupHidden),
          months: figures,
        },
      ];
    })
    .sort((a, b) => Number(b.uncategorized) - Number(a.uncategorized));

  return c.json({ currency: budget.currency, firstMonth: first, months, categories: listed }, 200);
};
