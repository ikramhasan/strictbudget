import { createRoute, type RouteHandler, z } from "@hono/zod-openapi";
import { category, categoryGroup, transaction } from "@strictbudget/db/schema";
import {
  addMonths,
  addSavings,
  BUDGET_MONTH_PATTERN,
  type BudgetMonth,
  monthBounds,
  monthsIn,
  NO_SAVINGS,
  rollingSavings,
  type SavingsFigures,
  type SavingsMonth,
  savingsFigures,
  zCurrencyCode,
  zMinorUnits,
} from "@strictbudget/engine";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError, jsonError } from "../../lib/errors";
import type { Db } from "../../lib/ledger";
import { type ReportSum, reportSums } from "../../lib/reports";
import { enterDueScheduled, entryDate, userToday } from "../../lib/scheduled";
import { type AuthedEnv, authSecurity, requireAuth } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";

type Env = AppEnv & AuthedEnv;

const Month = z.string().regex(BUDGET_MONTH_PATTERN, "Expected a month as YYYY-MM");

/** The most months a request covers, keeping its work bounded. */
export const SAVINGS_RATE_MAX_MONTHS = 1200;
/** The rolling line's window. */
const ROLLING_MONTHS = 12;
/** A category is suggested when at least this share of its outflows went to tracking accounts. */
const SUGGEST_PERCENT = 50n;

const FiguresSchema = z.object({
  income: zMinorUnits.describe("Income v Expense's income (Ready to Assign, no starting balances)"),
  incomeFromTracking: zMinorUnits.describe(
    "The part of `income` brought back in from tracking asset accounts: not income for the " +
      "saving rate, and taken off `movedToTracking`",
  ),
  netIncome: zMinorUnits.describe("Income v Expense's net income: left over"),
  savedViaCategories: zMinorUnits.describe(
    "Spending in categories that count as saving, added back (a refund lowers it)",
  ),
  movedToTracking: zMinorUnits.describe(
    "Moved from budget accounts to tracking asset accounts in other categories, less what came " +
      "back",
  ),
  saved: zMinorUnits.describe("netIncome + savedViaCategories + movedToTracking"),
  rate: z
    .number()
    .nullable()
    .describe("Percent: saved ÷ (income − incomeFromTracking); null when that is ≤ 0"),
  plainRate: z
    .number()
    .nullable()
    .describe("Income v Expense's rate in percent: netIncome ÷ income; null when income ≤ 0"),
});

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});

export const getSavingsRate = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/reports/savings-rate",
  operationId: "getSavingsRate",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Savings rate by month, with a rolling 12-month rate and what counts as saving",
  description:
    "Income and spending are Income v Expense's. The rate adds back spending in categories that " +
    "count as saving and money moved to tracking asset accounts (not loans or liabilities). " +
    "Each spending line is in one bucket only: a transfer to a tracking account in a saving " +
    "category counts under the category. The rolling rate sums the 12 months up to each month " +
    "(fewer before the budget's first transaction), it doesn't average monthly rates. " +
    "Transactions after `today` don't count yet.",
  request: {
    params: BudgetParams,
    query: z.object({
      from: Month.describe("First month, YYYY-MM (from 0001-01)"),
      to: Month.describe(
        `Last month, YYYY-MM (inclusive); at most ${SAVINGS_RATE_MAX_MONTHS} months after \`from\``,
      ),
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
      content: {
        "application/json": {
          schema: z
            .object({
              currency: zCurrencyCode.describe("The budget's currency, every amount's"),
              firstMonth: Month.nullable().describe(
                "Month of the budget's oldest transaction, null when there's none",
              ),
              goal: z
                .number()
                .int()
                .nullable()
                .describe("The budget's goal in basis points (2000 = 20%); null for none"),
              months: z.array(
                FiguresSchema.extend({
                  month: Month,
                  rollingRate: z
                    .number()
                    .nullable()
                    .describe("`rate` over the 12 months ending with this one"),
                  rollingPlainRate: z
                    .number()
                    .nullable()
                    .describe("`plainRate` over the 12 months ending with this one"),
                }).openapi("SavingsRateMonth"),
              ),
              total: FiguresSchema.describe("The whole range").openapi("SavingsRateFigures"),
              categories: z
                .array(
                  z
                    .object({
                      categoryId: z.string(),
                      name: z.string(),
                      groupId: z.string(),
                      groupName: z.string(),
                      countsAsSaving: z.boolean(),
                      suggested: z
                        .boolean()
                        .describe(
                          "Not marked, but most of its outflows in the range went to tracking " +
                            "asset accounts",
                        ),
                      spent: zMinorUnits.describe("Its net spending in the range (negative)"),
                    })
                    .openapi("SavingsRateCategory"),
                )
                .describe(
                  "The categories that can count as saving, in plan order (hidden ones only " +
                    "when they do)",
                ),
            })
            .openapi("SavingsRate"),
        },
      },
    },
    400: jsonError(
      `Invalid query, \`from\` after \`to\` or before 0001-01, or a range over ${SAVINGS_RATE_MAX_MONTHS} months`,
    ),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const setCategorySaving = createRoute({
  method: "put",
  path: "/budgets/{budgetId}/reports/savings-rate/categories/{categoryId}",
  operationId: "setCategorySaving",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: 'Mark a category as "Counts as saving", or unmark it',
  description:
    "Spending in a category that counts as saving is added back in the savings rate, and " +
    "spending pace leaves the category out by default.",
  request: {
    params: BudgetParams.extend({
      categoryId: z.string().openapi({ param: { name: "categoryId", in: "path" } }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ countsAsSaving: z.boolean() }).openapi("SetCategorySaving"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The category's setting",
      content: {
        "application/json": {
          schema: z
            .object({ categoryId: z.string(), countsAsSaving: z.boolean() })
            .openapi("CategorySaving"),
        },
      },
    },
    400: jsonError("Invalid setting, or an internal or card payment category"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change categories, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget or category, or the caller isn't a member"),
  },
});

const figuresJson = (f: SavingsFigures, m: SavingsMonth) => ({
  income: m.income.toString(),
  incomeFromTracking: m.incomeFromTracking.toString(),
  netIncome: f.netIncome.toString(),
  savedViaCategories: f.savedViaCategories.toString(),
  movedToTracking: f.movedToTracking.toString(),
  saved: f.saved.toString(),
  rate: f.rate,
  plainRate: f.plainRate,
});

/** Adds income and spending sums (grouped by month and `saving`) into each month's buckets. */
function savingsByMonth(income: readonly ReportSum[], spending: readonly ReportSum[]) {
  const months = new Map<string, SavingsMonth>();
  const at = (month: string) => {
    const m = months.get(month) ?? { ...NO_SAVINGS };
    months.set(month, m);
    return m;
  };
  for (const s of income) {
    if (!s.keys.month) continue;
    const m = at(s.keys.month);
    m.income += s.net;
    if (s.keys.saving === "tracking") m.incomeFromTracking += s.net;
  }
  for (const s of spending) {
    if (!s.keys.month) continue;
    const m = at(s.keys.month);
    m.spending += s.net;
    if (s.keys.saving === "category") m.savingCategories += s.net;
    if (s.keys.saving === "tracking") m.toTracking += s.net;
  }
  return months;
}

export const getSavingsRateHandler: RouteHandler<typeof getSavingsRate, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const query = c.req.valid("query");
  const deps = c.var.deps;
  const { db } = deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  const from = query.from as BudgetMonth;
  const to = query.to as BudgetMonth;
  if (from > to) throw new AppError(400, "BAD_REQUEST", "`from` is after `to`");
  // The rolling line reaches 11 months before `from`, which has to be a month too.
  if (from < "0001-01") throw new AppError(400, "BAD_REQUEST", "`from` is before 0001-01");
  if (addMonths(from, SAVINGS_RATE_MAX_MONTHS) <= to) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      `The range is over ${SAVINGS_RATE_MAX_MONTHS} months; ask for a shorter one`,
    );
  }
  const today = userToday(deps, query.today);
  if (query.today) await enterDueScheduled(db, deps, budgetId, entryDate(deps, query.today));

  const [first] = await db
    .select({ month: sql<string | null>`to_char(min(${transaction.date}), 'YYYY-MM')` })
    .from(transaction)
    .where(eq(transaction.budgetId, budgetId));
  const firstMonth = (first?.month ?? null) as BudgetMonth | null;
  // Nothing is earlier than the first transaction, so the rolling line needn't read before it.
  const reach = addMonths(from, -(ROLLING_MONTHS - 1));
  const historyFrom =
    firstMonth && firstMonth > reach ? (firstMonth < from ? firstMonth : from) : reach;
  const end = monthBounds(to).end;
  const span = { end: end < today ? end : today };
  const history = { ...span, start: monthBounds(historyFrom).start };
  const range = { ...span, start: monthBounds(from).start };

  const [income, spending, byCategory, categories] = await Promise.all([
    reportSums(db, budgetId, { kind: "income", ...history }, ["month", "saving"]),
    reportSums(db, budgetId, { kind: "spending", ...history }, ["month", "saving"]),
    reportSums(db, budgetId, { kind: "spending", ...range }, ["category", "saving"]),
    savingCategories(db, budgetId),
  ]);

  const sums = savingsByMonth(income, spending);
  const historyMonths = monthsIn({ from: historyFrom, to });
  const monthly = historyMonths.map((m) => sums.get(m) ?? NO_SAVINGS);
  const rolling = rollingSavings(monthly, ROLLING_MONTHS);
  const skip = historyMonths.indexOf(from);
  const inRange = monthly.slice(skip);
  const total = addSavings(inRange);

  const spent = new Map<string, { net: bigint; outflow: bigint; tracking: bigint }>();
  for (const s of byCategory) {
    if (!s.keys.category) continue;
    const row = spent.get(s.keys.category) ?? { net: 0n, outflow: 0n, tracking: 0n };
    row.net += s.net;
    row.outflow += s.outflow;
    if (s.keys.saving === "tracking") row.tracking += s.outflow;
    spent.set(s.keys.category, row);
  }

  return c.json(
    {
      currency: budget.currency,
      firstMonth,
      goal: budget.savingsRateGoal,
      months: inRange.map((m, i) => {
        const window = rolling[skip + i] ?? NO_SAVINGS;
        const rollingFigures = savingsFigures(window);
        return {
          month: historyMonths[skip + i] as string,
          ...figuresJson(savingsFigures(m), m),
          rollingRate: rollingFigures.rate,
          rollingPlainRate: rollingFigures.plainRate,
        };
      }),
      total: figuresJson(savingsFigures(total), total),
      categories: categories.flatMap((cat) => {
        if (cat.hidden && !cat.countsAsSaving) return [];
        const s = spent.get(cat.id);
        // Outflows are negative: at least half of them went to tracking accounts.
        const suggested =
          !cat.countsAsSaving &&
          s !== undefined &&
          s.tracking < 0n &&
          -s.tracking * 100n >= -s.outflow * SUGGEST_PERCENT;
        return [
          {
            categoryId: cat.id,
            name: cat.name,
            groupId: cat.groupId,
            groupName: cat.groupName,
            countsAsSaving: cat.countsAsSaving,
            suggested,
            spent: (s?.net ?? 0n).toString(),
          },
        ];
      }),
    },
    200,
  );
};

/** The categories a person spends from (no internal or card payment ones), in plan order. */
async function savingCategories(db: Db, budgetId: string) {
  return db
    .select({
      id: category.id,
      name: category.name,
      hidden: sql<boolean>`${category.hidden} or ${categoryGroup.hidden}`,
      countsAsSaving: category.countsAsSaving,
      groupId: categoryGroup.id,
      groupName: categoryGroup.name,
    })
    .from(category)
    .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
    .where(
      and(
        eq(category.budgetId, budgetId),
        eq(categoryGroup.internal, false),
        isNull(categoryGroup.kind),
        isNull(category.linkedAccountId),
      ),
    )
    .orderBy(asc(categoryGroup.sortOrder), asc(category.sortOrder), asc(category.id));
}

export const setCategorySavingHandler: RouteHandler<typeof setCategorySaving, Env> = async (c) => {
  const { budgetId, categoryId } = c.req.valid("param");
  const { countsAsSaving } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { category: ["update"] });
  const [row] = await db
    .select({
      internalKind: category.internalKind,
      linkedAccountId: category.linkedAccountId,
      groupKind: categoryGroup.kind,
    })
    .from(category)
    .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
    .where(and(eq(category.id, categoryId), eq(category.budgetId, budgetId)));
  if (!row) throw new AppError(404, "NOT_FOUND", "Category not found");
  if (row.internalKind || row.linkedAccountId || row.groupKind) {
    throw new AppError(400, "BAD_REQUEST", "This category can't count as saving");
  }
  await db.update(category).set({ countsAsSaving }).where(eq(category.id, categoryId));
  return c.json({ categoryId, countsAsSaving }, 200);
};
