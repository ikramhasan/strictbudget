import { createRoute, type RouteHandler, z } from "@hono/zod-openapi";
import { category, categoryGroup, payee } from "@strictbudget/db/schema";
import {
  BUDGET_MONTH_PATTERN,
  type BudgetMonth,
  monthBounds,
  zCurrencyCode,
  zMinorUnits,
} from "@strictbudget/engine";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { cashFlow } from "../../lib/cash-flow";
import { AppError, jsonError } from "../../lib/errors";
import { type ReportFilter, reportSums } from "../../lib/reports";
import { enterDueScheduled, entryDate, userToday } from "../../lib/scheduled";
import { type AuthedEnv, authSecurity, requireAuth } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";

type Env = AppEnv & AuthedEnv;

const Month = z.string().regex(BUDGET_MONTH_PATTERN, "Expected a month as YYYY-MM");

const SourceSchema = z
  .object({
    payeeId: z.string().nullable().describe("null: income without a payee"),
    name: z.string(),
    amount: zMinorUnits.describe("Positive"),
  })
  .openapi("CashFlowSource");

const CategorySchema = z
  .object({ categoryId: z.string(), name: z.string(), amount: zMinorUnits.describe("Positive") })
  .openapi("CashFlowCategory");

export const getCashFlow = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/reports/cash-flow",
  operationId: "getCashFlow",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Where the money came from and where it went (the cash flow Sankey's flows)",
  description:
    "Income v Expense's income per payee and spending per category, each on the side its sign " +
    "puts it: income `sources` (and income `paidBack` when a payee nets below zero), spending " +
    "by `groups` and their categories (and `refunds` when a category got back more than it " +
    "spent). What's left is `saved`; a shortfall comes in `fromSavings`. Every amount is positive " +
    "and sources + refunds + fromSavings = groups + paidBack + saved, exactly. Transactions after " +
    "`today` don't count yet.",
  request: {
    params: z.object({
      budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
    }),
    query: z.object({
      from: Month.describe("First month, YYYY-MM"),
      to: Month.describe("Last month, YYYY-MM (inclusive)"),
      accountIds: z
        .string()
        .transform((v) => v.split(",").filter(Boolean))
        .optional()
        .describe("Comma-separated budget account ids"),
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
      description: "The flows",
      content: {
        "application/json": {
          schema: z
            .object({
              currency: zCurrencyCode.describe("The budget's currency, every amount's"),
              income: zMinorUnits.describe("Income v Expense's total income"),
              spending: zMinorUnits.describe("Income v Expense's total expenses (negative)"),
              sources: z.array(SourceSchema).describe("Payees whose income nets above zero"),
              paidBack: z
                .array(SourceSchema)
                .describe("Payees whose income nets below zero, as the amount paid back"),
              refunds: z
                .array(CategorySchema.extend({ groupId: z.string().nullable() }))
                .describe("Categories where more came back than was spent"),
              groups: z
                .array(
                  z
                    .object({
                      groupId: z
                        .string()
                        .nullable()
                        .describe("null: Uncategorized, and categories outside the plan's groups"),
                      name: z.string(),
                      amount: zMinorUnits.describe("Its categories' sum"),
                      categories: z.array(CategorySchema),
                    })
                    .openapi("CashFlowGroup"),
                )
                .describe("Uncategorized first, then the plan's groups in order"),
              saved: zMinorUnits.describe("Income left over (≥ 0)"),
              fromSavings: zMinorUnits.describe("Spending beyond income (≥ 0)"),
            })
            .openapi("CashFlow"),
        },
      },
    },
    400: jsonError("Invalid query, or `from` after `to`"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const getCashFlowHandler: RouteHandler<typeof getCashFlow, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const query = c.req.valid("query");
  const deps = c.var.deps;
  const { db } = deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  if (query.from > query.to) throw new AppError(400, "BAD_REQUEST", "`from` is after `to`");
  const today = userToday(deps, query.today);
  if (query.today) await enterDueScheduled(db, deps, budgetId, entryDate(deps, query.today));
  const end = monthBounds(query.to as BudgetMonth).end;
  const span = {
    start: monthBounds(query.from as BudgetMonth).start,
    end: end < today ? end : today,
    accountIds: query.accountIds,
  } satisfies Omit<ReportFilter, "kind">;

  const [income, spending, categories] = await Promise.all([
    reportSums(db, budgetId, { kind: "income", ...span }, ["payee"]),
    reportSums(db, budgetId, { kind: "spending", ...span }, ["category"]),
    db
      .select({
        id: category.id,
        name: category.name,
        groupId: categoryGroup.id,
        groupName: categoryGroup.name,
        regular: sql<boolean>`not ${categoryGroup.internal} and ${categoryGroup.kind} is null`,
      })
      .from(category)
      .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
      .where(eq(category.budgetId, budgetId))
      .orderBy(asc(categoryGroup.sortOrder), asc(category.sortOrder), asc(category.id)),
  ]);
  const payeeIds = income.flatMap((s) => (s.keys.payee ? [s.keys.payee] : []));
  const payees = payeeIds.length
    ? await db
        .select({ id: payee.id, name: payee.name })
        .from(payee)
        .where(inArray(payee.id, payeeIds))
    : [];

  const groups = new Map<
    string,
    { id: string; name: string; categories: { id: string; name: string }[] }
  >();
  const otherNames = new Map<string, string>();
  for (const row of categories) {
    if (!row.regular) {
      otherNames.set(row.id, row.name);
      continue;
    }
    const g = groups.get(row.groupId) ?? { id: row.groupId, name: row.groupName, categories: [] };
    g.categories.push({ id: row.id, name: row.name });
    groups.set(row.groupId, g);
  }
  const flow = cashFlow({
    income: income.map((s) => ({ payeeId: s.keys.payee ?? null, net: s.net })),
    spending: spending.flatMap((s) =>
      s.keys.category ? [{ categoryId: s.keys.category, net: s.net }] : [],
    ),
    payeeNames: new Map(payees.map((p) => [p.id, p.name])),
    groups: [...groups.values()],
    otherCategoryNames: otherNames,
  });

  const str = (amount: bigint) => amount.toString();
  return c.json(
    {
      currency: budget.currency,
      income: str(flow.income),
      spending: str(flow.spending),
      sources: flow.sources.map((s) => ({ ...s, amount: str(s.amount) })),
      paidBack: flow.paidBack.map((s) => ({ ...s, amount: str(s.amount) })),
      refunds: flow.refunds.map((r) => ({ ...r, amount: str(r.amount) })),
      groups: flow.groups.map((g) => ({
        ...g,
        amount: str(g.amount),
        categories: g.categories.map((cat) => ({ ...cat, amount: str(cat.amount) })),
      })),
      saved: str(flow.saved),
      fromSavings: str(flow.fromSavings),
    },
    200,
  );
};
