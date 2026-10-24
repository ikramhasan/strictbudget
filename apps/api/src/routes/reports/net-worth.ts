import { createRoute, type RouteHandler, z } from "@hono/zod-openapi";
import {
  BUDGET_MONTH_PATTERN,
  type BudgetMonth,
  zAccountType,
  zCurrencyCode,
  zMinorUnits,
} from "@strictbudget/engine";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError, jsonError } from "../../lib/errors";
import { zFxRate } from "../../lib/fx/rate-schema";
import { serverToday } from "../../lib/ledger";
import { type NetWorthBalance, netWorthReport } from "../../lib/net-worth";
import { enterDueScheduled, entryDate } from "../../lib/scheduled";
import type { AuthedEnv } from "../../middleware/require-auth";
import { authSecurity, requireAuth } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";

const Month = z.string().regex(BUDGET_MONTH_PATTERN, "Expected a month as YYYY-MM");

const BalanceSchema = z
  .object({
    native: zMinorUnits.describe("In the account's currency"),
    base: zMinorUnits
      .nullable()
      .describe("In the budget's currency at the month-end rate; null when no rate is known"),
  })
  .openapi("NetWorthBalance");

const TotalsShape = {
  assets: zMinorUnits.describe("Σ of the positive account balances"),
  debts: zMinorUnits.describe("Σ of the negative account balances (≤ 0)"),
  netWorth: zMinorUnits,
};

const NetWorthSchema = z
  .object({
    currency: zCurrencyCode.describe("The budget's currency, every total's"),
    firstMonth: Month.nullable().describe(
      "Month of the accounts' first transaction (for All Dates), null when there's none",
    ),
    opening: z
      .object({ month: Month, ...TotalsShape })
      .describe("The month before the range (each month's change is against the one before)"),
    months: z.array(
      z
        .object({
          month: Month,
          ...TotalsShape,
          allTimeHigh: z
            .boolean()
            .describe("Net worth above every earlier month-end since the first month"),
          missing: z
            .array(z.string())
            .describe("Accounts left out of the totals: no rate to the budget's currency"),
          parts: z
            .object({
              netSaved: zMinorUnits.describe(
                "Budget accounts' cash flow (income less spending, transfers to loans and " +
                  "tracking accounts counting as spent), starting balances left out",
              ),
              debtPaidDown: zMinorUnits.describe("Transfers into loan accounts"),
              tracking: zMinorUnits.describe(
                "Tracking accounts' transactions, starting balances left out",
              ),
              other: zMinorUnits.describe(
                "The rest: starting balances, loan interest, escrow and adjustments, exchange rates",
              ),
            })
            .describe("What changed since the previous month-end; adds up to the change exactly"),
        })
        .openapi("NetWorthMonth"),
    ),
    accounts: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          type: zAccountType,
          onBudget: z.boolean(),
          closed: z.boolean(),
          currency: zCurrencyCode,
          firstMonth: Month.nullable(),
          opening: BalanceSchema,
          balances: z.array(BalanceSchema).describe("At the end of each month of the range"),
        })
        .openapi("NetWorthAccount"),
    ),
    rates: z
      .array(
        z.object({
          currency: zCurrencyCode,
          month: Month,
          rate: zFxRate.nullable().describe("1 `currency` = rate budget currency"),
          rateDate: z.iso.date().nullable(),
        }),
      )
      .describe("The month-end rate of each foreign currency, for each month of the range"),
  })
  .openapi("NetWorthReport");

export const getNetWorthReport = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/reports/net-worth",
  operationId: "getNetWorthReport",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Month-end balances of every account and the net worth they add up to",
  description:
    "Each account's working balance at the end of each month (uncleared included, a loan's " +
    "interest and escrow included, the current month as of `today`), on- and off-budget, closed " +
    "accounts included. Assets and debts split by each account's sign. Foreign balances convert " +
    "at the month-end's rate; with none known they're left out of the totals (`missing`).",
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
        .describe("Comma-separated account ids; all accounts when left out"),
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
      content: { "application/json": { schema: NetWorthSchema } },
    },
    400: jsonError("Invalid query, or `from` after `to`"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

const wire = (b: NetWorthBalance) => ({
  native: b.native.toString(),
  base: b.base === null ? null : b.base.toString(),
});

export const getNetWorthReportHandler: RouteHandler<
  typeof getNetWorthReport,
  AppEnv & AuthedEnv
> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const query = c.req.valid("query");
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  if (query.from > query.to) throw new AppError(400, "BAD_REQUEST", "`from` is after `to`");
  const today = query.today ?? serverToday();
  if (query.today) {
    await enterDueScheduled(db, c.var.deps, budgetId, entryDate(c.var.deps, query.today));
  }
  const report = await netWorthReport(db, c.var.deps, {
    budgetId,
    budgetCurrency: budget.currency,
    from: query.from as BudgetMonth,
    to: query.to as BudgetMonth,
    today,
    accountIds: query.accountIds,
  });
  const totals = (t: { assets: bigint; debts: bigint; netWorth: bigint }) => ({
    assets: t.assets.toString(),
    debts: t.debts.toString(),
    netWorth: t.netWorth.toString(),
  });
  return c.json(
    {
      currency: budget.currency,
      firstMonth: report.firstMonth,
      opening: { month: report.opening.month, ...totals(report.opening) },
      months: report.months.map((m) => ({
        month: m.month,
        ...totals(m),
        allTimeHigh: m.allTimeHigh,
        missing: m.missing,
        parts: {
          netSaved: m.parts.netSaved.toString(),
          debtPaidDown: m.parts.debtPaidDown.toString(),
          tracking: m.parts.tracking.toString(),
          other: m.parts.other.toString(),
        },
      })),
      accounts: report.accounts.map((a) => ({
        id: a.account.id,
        name: a.account.name,
        type: a.account.type,
        onBudget: a.onBudget,
        closed: a.account.closed,
        currency: a.account.currency,
        firstMonth: a.firstMonth,
        opening: wire(a.opening),
        balances: a.balances.map(wire),
      })),
      rates: report.rates,
    },
    200,
  );
};
