import { createRoute, z } from "@hono/zod-openapi";
import { AUDIT_OPS } from "@strictbudget/db/schema";
import { jsonError } from "../../lib/errors";
import { zMemberRef } from "../../lib/member-colors";
import { authSecurity, requireAuth } from "../../middleware/require-auth";

const RowValues = z
  .record(z.string(), z.string().nullable())
  .describe(
    "The row's columns (snake_case) as text, money included (minor units), so nothing loses precision",
  );

const ActivityEventSchema = z
  .object({
    id: z.string(),
    at: z.iso.datetime(),
    actor: zMemberRef
      .nullable()
      .describe("Who made the change; null for one nobody made (see `source`)"),
    source: z
      .string()
      .nullable()
      .describe("Why a change without an actor happened: 'scheduled' for an entered occurrence"),
    entity: z.string().describe("The table changed, e.g. 'transaction', 'category_assignment'"),
    rowId: z.string(),
    op: z.enum(AUDIT_OPS),
    before: RowValues.nullable().describe("The row before the change; null for an insert"),
    after: RowValues.nullable().describe("The row after the change; null for a delete"),
  })
  .openapi("ActivityEvent");

const ActivityPage = z
  .object({
    events: z.array(ActivityEventSchema).describe("Newest first"),
    nextCursor: z
      .string()
      .nullable()
      .describe("Pass as `cursor` for the next page; null on the last page"),
  })
  .openapi("ActivityPage");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});

const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { "application/json": { schema } },
});

export const listActivity = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/activity",
  operationId: "listBudgetActivity",
  tags: ["Activity"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "The budget's change history, newest first",
  description:
    "Every insert, update and delete of the budget's data, who made it and when, with the row " +
    "before and after. Changes to bookkeeping columns alone aren't listed.",
  request: {
    params: BudgetParams,
    query: z.object({
      member: z
        .string()
        .optional()
        .describe("Only this user's changes; 'none' for changes nobody made"),
      entity: z
        .string()
        .optional()
        .describe(
          "Only changes to these tables, comma-separated (e.g. 'transaction,sub_transaction')",
        ),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  },
  responses: {
    200: ok("A page of changes", ActivityPage),
    400: jsonError("Invalid input or cursor (INVALID_CURSOR)"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const transactionHistory = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/transactions/{transactionId}/history",
  operationId: "getTransactionHistory",
  tags: ["Activity"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "One transaction's change history, oldest first",
  description:
    "Its insert, updates and delete, and those of its split lines (`sub_transaction`), with who " +
    "made each. Works for a deleted transaction too.",
  request: {
    params: BudgetParams.extend({
      transactionId: z.string().openapi({ param: { name: "transactionId", in: "path" } }),
    }),
  },
  responses: {
    200: ok(
      "Its changes",
      z.object({ events: z.array(ActivityEventSchema) }).openapi("TransactionHistory"),
    ),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});
