import { createRoute, z } from "@hono/zod-openapi";
import { CLEARED_STATES, FLAG_COLORS } from "@strictbudget/db/schema";
import { BUDGET_MONTH_PATTERN, zCurrencyCode, zMinorUnits } from "@strictbudget/engine";
import { jsonError } from "../../lib/errors";
import { REPORT_GROUPINGS, REPORT_KINDS, REPORT_LINE_ORDERS } from "../../lib/reports";
import { authSecurity, requireAuth } from "../../middleware/require-auth";

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});

const Month = z.string().regex(BUDGET_MONTH_PATTERN, "Expected a month as YYYY-MM");

const list = <T extends z.ZodType<string, string>>(item: T, description: string) =>
  z
    .string()
    .transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(item))
    .optional()
    .describe(description);

const ReportQuery = z.object({
  from: Month.describe("First month, YYYY-MM"),
  to: Month.describe("Last month, YYYY-MM (inclusive)"),
  kind: z
    .enum(REPORT_KINDS)
    .default("spending")
    .describe(
      "`spending`: lines on budget accounts with a category other than Ready to Assign " +
        "(transfers between budget accounts drop out), except saving lines. `saving`: the lines " +
        "that leave the plan as saving instead: transfers to or from tracking asset accounts, " +
        "and lines in savings categories whose goal is Keep saving (`spending` + `saving` is the " +
        "plan's Activity). `income`: lines on budget accounts categorized to Ready to Assign, " +
        "starting balances left out",
    ),
  accountIds: list(z.string(), "Comma-separated account ids"),
  groupIds: list(z.string(), "Comma-separated category group ids"),
  categoryIds: list(z.string(), "Comma-separated category ids"),
  payeeIds: list(z.string(), 'Comma-separated payee ids; "none" matches lines with no payee'),
  flags: list(
    z.enum([...FLAG_COLORS, "none"]),
    'Comma-separated flag colours; "none" matches unflagged transactions',
  ),
  fromDate: z.iso
    .date()
    .optional()
    .describe("Narrows the range to start on this day (e.g. one day of a calendar)"),
  toDate: z.iso.date().optional().describe("Narrows the range to end on this day (inclusive)"),
  today: z.iso
    .date()
    .optional()
    .describe(
      "The user's today; later transactions don't count. Defaults to the server's UTC date.",
    ),
});

const ReportSumSchema = z
  .object({
    month: Month.nullable().optional(),
    day: z.iso.date().nullable().optional(),
    groupId: z.string().nullable().optional(),
    categoryId: z.string().nullable().optional(),
    payeeId: z.string().nullable().optional(),
    accountId: z.string().nullable().optional(),
    flag: z.enum(FLAG_COLORS).nullable().optional(),
    outflow: zMinorUnits.describe("Sum of the outflows (≤ 0)"),
    inflow: zMinorUnits.describe("Sum of the inflows (≥ 0)"),
    net: zMinorUnits,
    count: z.number().int().describe("Lines summed (a split's lines one by one)"),
  })
  .openapi("ReportSum");

const errors = {
  400: jsonError("Invalid filters, or `from` after `to`"),
  401: jsonError("Not signed in"),
  403: jsonError("The account's email address isn't confirmed"),
  404: jsonError("No such budget, or the caller isn't a member"),
};

export const getReportActivity = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/reports/activity",
  operationId: "getReportActivity",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Spending or income summed by month, group, category, payee, account or flag",
  description:
    "Amounts are in the budget's currency (base amounts), from the range's first day up to the " +
    "user's today. Each row carries only the keys asked for in `groupBy`; a null key is a line " +
    "without one (no payee, no flag).",
  request: {
    params: BudgetParams,
    query: ReportQuery.extend({
      groupBy: list(z.enum(REPORT_GROUPINGS), "Comma-separated keys to group by"),
    }),
  },
  responses: {
    200: {
      description: "The sums",
      content: {
        "application/json": {
          schema: z
            .object({
              currency: zCurrencyCode.describe("The budget's currency"),
              firstMonth: Month.nullable().describe(
                "Month of the budget's oldest transaction (for All Dates), null when there's none",
              ),
              rows: z.array(ReportSumSchema),
              payees: z
                .array(z.object({ id: z.string(), name: z.string() }))
                .describe(
                  "Names of the payees in `rows` (grouped by payee), transfer payees included",
                ),
            })
            .openapi("ReportActivity"),
        },
      },
    },
    ...errors,
  },
});

const ReportTransactionSchema = z
  .object({
    id: z.string().describe("The transaction's id, or the split line's"),
    transactionId: z.string().describe("The transaction (the split, for a split line)"),
    accountId: z.string(),
    accountName: z.string(),
    date: z.iso.date(),
    payeeId: z.string().nullable(),
    payeeName: z.string().nullable(),
    categoryId: z.string().nullable(),
    groupName: z.string().nullable(),
    categoryName: z.string().nullable(),
    memo: z.string(),
    flag: z.enum(FLAG_COLORS).nullable(),
    cleared: z.enum(CLEARED_STATES),
    amount: zMinorUnits.describe("In the budget's currency; negative is an outflow"),
    nativeAmount: zMinorUnits.describe("In the account's currency, `currency`"),
    currency: zCurrencyCode.describe("The account's currency"),
  })
  .openapi("ReportTransaction");

export const listReportTransactions = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/reports/transactions",
  operationId: "listReportTransactions",
  tags: ["Reports"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "The transactions behind a report's sums (drill-down and export)",
  description:
    "The lines the same filters sum, a split's lines one by one: newest first, or largest outflow " +
    "first. `total` and `count` cover every match even when `limit` cuts the list.",
  request: {
    params: BudgetParams,
    query: ReportQuery.extend({
      order: z.enum(REPORT_LINE_ORDERS).default("newest"),
      limit: z.coerce.number().int().min(1).max(100000).optional(),
    }),
  },
  responses: {
    200: {
      description: "The transactions",
      content: {
        "application/json": {
          schema: z
            .object({
              total: zMinorUnits.describe("Sum of every matching line"),
              count: z.number().int(),
              transactions: z.array(ReportTransactionSchema),
            })
            .openapi("ReportTransactions"),
        },
      },
    },
    ...errors,
  },
});
