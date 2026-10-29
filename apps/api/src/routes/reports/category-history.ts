import { createRoute, type RouteHandler, z } from "@hono/zod-openapi";
import { category, categoryGroup, moneyMove, user } from "@strictbudget/db/schema";
import {
  averageOf,
  BUDGET_MONTH_PATTERN,
  type BudgetMonth,
  monthBounds,
  monthOf,
  zCurrencyCode,
  zMinorUnits,
} from "@strictbudget/engine";
import { and, asc, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError, jsonError } from "../../lib/errors";
import { enterDueScheduled, entryDate, userToday } from "../../lib/scheduled";
import type { AuthedEnv } from "../../middleware/require-auth";
import { authSecurity, requireAuth } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { budgetHistory, loadTargets } from "../months/handlers";
import { planFigures, planMonths } from "./plan-figures";

const Month = z.string().regex(BUDGET_MONTH_PATTERN, "Expected a month as YYYY-MM");

const MoveSchema = z
  .object({
    id: z.string(),
    categoryId: z
      .string()
      .describe("The side in the category or group (for a group: which of its categories)"),
    otherCategoryId: z
      .string()
      .nullable()
      .describe("The category on the other side; null once it's deleted"),
    otherDeletedCategory: z
      .string()
      .nullable()
      .describe("The name of a deleted category on the other side"),
    amount: zMinorUnits.describe("Positive moved in, negative moved out"),
    movedAt: z.iso.datetime(),
    userName: z.string().nullable().describe("Who moved it; null once their account is gone"),
  })
  .openapi("CategoryHistoryMove");

const MonthSchema = z
  .object({
    month: Month,
    assigned: zMinorUnits.describe("The plan's Assigned (money moves included)"),
    activity: zMinorUnits.describe("The plan's Activity; spending is negative"),
    available: zMinorUnits.describe("The plan's Available at the month's end"),
    cashOverspent: zMinorUnits.describe(
      "The cash part of a negative Available (≤ 0); a group's sums its overspent categories', " +
        "so it can be below zero while the group's Available isn't",
    ),
    creditOverspent: zMinorUnits.describe(
      "The credit part of a negative Available (≤ 0), likewise",
    ),
    targetAmount: zMinorUnits
      .nullable()
      .describe(
        "What the target asks of the month (the plan's month targets); null without a target. " +
          "Targets have no history: the current target applies from its start month",
      ),
    targetMet: z
      .boolean()
      .nullable()
      .describe(
        "Whether the month's Assigned covered what the target asked (nothing left underfunded); " +
          "null when no target asked for money that month",
      ),
    moves: z
      .array(MoveSchema)
      .describe(
        "Money moved between this and other categories in the month, newest first (assigning " +
          "from or returning to Ready to Assign is what Assigned shows, so it's not listed)",
      ),
  })
  .openapi("CategoryHistoryMonth");

const CategoryHistorySchema = z
  .object({
    currency: zCurrencyCode.describe("The budget's currency, every amount's"),
    firstMonth: Month.describe("The plan's first month"),
    name: z.string().describe("The category's or group's name"),
    hidden: z.boolean().describe("The category or group is hidden"),
    months: z
      .array(MonthSchema)
      .describe("The range's months that the plan shows, oldest first; a group's are summed"),
    stats: z
      .object({
        averageAssigned: zMinorUnits,
        averageSpent: zMinorUnits.describe("Average of −Activity"),
        monthsOverspent: z
          .number()
          .int()
          .describe("Months ending overspent (for a group: any of its categories)"),
        targetMonths: z.number().int().describe("Months a target asked for money"),
        targetMonthsMet: z.number().int().describe("Of those, months the target was met"),
      })
      .openapi("CategoryHistoryStats"),
  })
  .openapi("CategoryHistory");

export const getCategoryHistory = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/reports/category-history",
  operationId: "getCategoryHistory",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "One category's or group's plan numbers month by month, with its target and moves",
  description:
    "Each month's Assigned, Activity and Available as the plan shows them, what the target asked " +
    "of the month, and the money moved in and out. Pass `categoryId` or `groupId`. Ready to " +
    "Assign and credit card payment categories have no spending plan and are refused. " +
    "Transactions after `today` don't count yet.",
  request: {
    params: z.object({
      budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
    }),
    query: z.object({
      categoryId: z.string().optional().describe("The category (or pass `groupId`)"),
      groupId: z.string().optional().describe("The category group, its categories summed"),
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
      description: "The history",
      content: { "application/json": { schema: CategoryHistorySchema } },
    },
    400: jsonError(
      "Invalid query, `from` after `to`, both or neither of `categoryId` and `groupId`, or a " +
        "category without a spending plan (Ready to Assign, a card payment)",
    ),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget or category, or the caller isn't a member"),
  },
});

/** The categories a query asks for, refusing those without a spending plan. */
async function subject(
  db: Parameters<typeof budgetHistory>[0],
  budgetId: string,
  query: { categoryId?: string; groupId?: string },
) {
  if ((query.categoryId === undefined) === (query.groupId === undefined)) {
    throw new AppError(400, "BAD_REQUEST", "Pass either `categoryId` or `groupId`");
  }
  const rows = await db
    .select({
      id: category.id,
      name: category.name,
      hidden: category.hidden,
      internalKind: category.internalKind,
      linkedAccountId: category.linkedAccountId,
      groupId: categoryGroup.id,
      groupName: categoryGroup.name,
      groupHidden: categoryGroup.hidden,
      groupInternal: categoryGroup.internal,
      groupKind: categoryGroup.kind,
    })
    .from(category)
    .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
    .where(
      and(
        eq(category.budgetId, budgetId),
        query.categoryId
          ? eq(category.id, query.categoryId)
          : eq(categoryGroup.id, query.groupId ?? ""),
      ),
    )
    .orderBy(asc(category.sortOrder), asc(category.id));
  const [first] = rows;
  if (!first) {
    // An empty group still exists: its history is all zeros.
    if (query.groupId) {
      const [group] = await db
        .select({
          name: categoryGroup.name,
          hidden: categoryGroup.hidden,
          kind: categoryGroup.kind,
        })
        .from(categoryGroup)
        .where(and(eq(categoryGroup.budgetId, budgetId), eq(categoryGroup.id, query.groupId)));
      if (group && !group.kind) return { name: group.name, hidden: group.hidden, ids: [] };
      if (group) throw noPlan();
    }
    throw new AppError(404, "NOT_FOUND", "No such category");
  }
  if (query.categoryId) {
    if (first.internalKind === "ready_to_assign" || first.linkedAccountId) throw noPlan();
    return {
      name: first.internalKind === "uncategorized" ? "Uncategorized" : first.name,
      hidden: first.internalKind !== "uncategorized" && (first.hidden || first.groupHidden),
      ids: [first.id],
    };
  }
  if (first.groupInternal || first.groupKind) throw noPlan();
  return { name: first.groupName, hidden: first.groupHidden, ids: rows.map((r) => r.id) };
}

const noPlan = () =>
  new AppError(
    400,
    "NO_SPENDING_PLAN",
    "Ready to Assign and credit card payments have no spending plan to show",
  );

export const getCategoryHistoryHandler: RouteHandler<
  typeof getCategoryHistory,
  AppEnv & AuthedEnv
> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const query = c.req.valid("query");
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  if (query.from > query.to) throw new AppError(400, "BAD_REQUEST", "`from` is after `to`");
  const { name, hidden, ids } = await subject(db, budgetId, query);
  const today = userToday(c.var.deps, query.today);
  if (query.today) {
    await enterDueScheduled(db, c.var.deps, budgetId, entryDate(c.var.deps, query.today));
  }
  const from = query.from as BudgetMonth;
  const to = query.to as BudgetMonth;
  const { first, months } = await planMonths(db, budgetId, from, to, today);

  // Each month's numbers are the plan's for that month: later transactions never change it.
  const rangeEnd = monthBounds(to).end;
  const { history } = await budgetHistory(db, budgetId, rangeEnd < today ? rangeEnd : today);
  const { targets } = await loadTargets(db, c.var.deps, budget, today);
  const current = monthOf(today);
  const perCategory = ids.map((id) =>
    planFigures(history.get(id) ?? [], targets.get(id), months, current),
  );
  const moves = await movesIn(db, budgetId, ids, months);

  const figures = months.map((month, i) => {
    const sum = (pick: (f: (typeof perCategory)[number][number]) => bigint) =>
      perCategory.reduce((total, rows) => total + (rows[i] ? pick(rows[i]) : 0n), 0n);
    const needs = perCategory.flatMap((rows) => (rows[i]?.need ? [rows[i].need] : []));
    // A month counts when a target asked for money in it; it's met when every such target is.
    const asking = needs.filter((n) => n.monthAmount > 0n);
    return {
      month,
      assigned: sum((f) => f.assigned),
      activity: sum((f) => f.activity),
      available: sum((f) => f.available),
      cashOverspent: sum((f) => f.cashOverspent),
      creditOverspent: sum((f) => f.creditOverspent),
      targetAmount: needs.length ? needs.reduce((t, n) => t + n.monthAmount, 0n) : null,
      targetMet: asking.length ? asking.every((n) => n.underfunded === 0n) : null,
      moves: moves.get(month) ?? [],
    };
  });

  const total = (pick: (f: (typeof figures)[number]) => bigint) =>
    figures.reduce((t, f) => t + pick(f), 0n);
  return c.json(
    {
      currency: budget.currency,
      firstMonth: first,
      name,
      hidden,
      months: figures.map((f) => ({
        ...f,
        assigned: f.assigned.toString(),
        activity: f.activity.toString(),
        available: f.available.toString(),
        cashOverspent: f.cashOverspent.toString(),
        creditOverspent: f.creditOverspent.toString(),
        targetAmount: f.targetAmount === null ? null : f.targetAmount.toString(),
      })),
      stats: {
        averageAssigned: averageOf(
          total((f) => f.assigned),
          figures.length,
        ).toString(),
        averageSpent: averageOf(
          total((f) => -f.activity),
          figures.length,
        ).toString(),
        monthsOverspent: figures.filter((f) => f.cashOverspent + f.creditOverspent < 0n).length,
        targetMonths: figures.filter((f) => f.targetMet !== null).length,
        targetMonthsMet: figures.filter((f) => f.targetMet === true).length,
      },
    },
    200,
  );
};

/**
 * Money moved between `ids` and other categories in `months`, per month, newest first. Moves
 * from or to Ready to Assign are assigning and removing money (the month's Assigned), and a move
 * between two of `ids` changes nothing for the whole, so neither is listed.
 */
async function movesIn(
  db: Parameters<typeof budgetHistory>[0],
  budgetId: string,
  ids: readonly string[],
  months: readonly BudgetMonth[],
) {
  const byMonth = new Map<BudgetMonth, z.infer<typeof MoveSchema>[]>();
  const [start] = months;
  const end = months.at(-1);
  if (!start || !end || ids.length === 0) return byMonth;
  const [readyToAssign] = await db
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.budgetId, budgetId), eq(category.internalKind, "ready_to_assign")));
  const rows = await db
    .select({
      id: moneyMove.id,
      month: moneyMove.month,
      fromCategoryId: moneyMove.fromCategoryId,
      toCategoryId: moneyMove.toCategoryId,
      fromCategoryName: moneyMove.fromCategoryName,
      toCategoryName: moneyMove.toCategoryName,
      amount: moneyMove.amount,
      createdAt: moneyMove.createdAt,
      userName: user.name,
    })
    .from(moneyMove)
    .leftJoin(user, eq(user.id, moneyMove.userId))
    .where(
      and(
        eq(moneyMove.budgetId, budgetId),
        gte(moneyMove.month, `${start}-01`),
        lte(moneyMove.month, `${end}-01`),
        or(inArray(moneyMove.fromCategoryId, [...ids]), inArray(moneyMove.toCategoryId, [...ids])),
      ),
    )
    .orderBy(desc(moneyMove.createdAt), desc(moneyMove.id));
  const inside = new Set(ids);
  const ready = readyToAssign?.id;
  for (const m of rows) {
    if (m.fromCategoryId === ready || m.toCategoryId === ready) continue;
    const into = m.toCategoryId !== null && inside.has(m.toCategoryId);
    const outOf = m.fromCategoryId !== null && inside.has(m.fromCategoryId);
    if (into && outOf) continue;
    const month = monthOf(m.month);
    const list = byMonth.get(month) ?? [];
    list.push({
      id: m.id,
      categoryId: (into ? m.toCategoryId : m.fromCategoryId) ?? "",
      otherCategoryId: into ? m.fromCategoryId : m.toCategoryId,
      otherDeletedCategory: into ? m.fromCategoryName : m.toCategoryName,
      amount: (into ? m.amount : -m.amount).toString(),
      movedAt: m.createdAt.toISOString(),
      userName: m.userName,
    });
    byMonth.set(month, list);
  }
  return byMonth;
}
