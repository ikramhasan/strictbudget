import { createRoute, z } from "@hono/zod-openapi";
import { IsoDate } from "../../lib/dates";
import { jsonError } from "../../lib/errors";
import { authSecurity, requireAuth } from "../../middleware/require-auth";
import { SelectionSchema } from "../transactions/routes";

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});

const TodayQuery = z.object({
  today: IsoDate.optional().describe(
    "The user's today: the plan's months run up to it. Defaults to the server's UTC date.",
  ),
});

const delimited = (description: string) => ({
  description,
  content: {
    "text/csv": { schema: z.string() },
    "text/tab-separated-values": { schema: z.string() },
  },
});

const common = {
  401: jsonError("Not signed in"),
  403: jsonError("The account's email address isn't confirmed"),
  404: jsonError("No such budget, or the caller isn't a member"),
};

const FORMAT =
  "Comma-separated, or tab-separated when the budget's number format uses a comma as its decimal " +
  "mark. Text cells are quoted; amounts are bare, in the budget's number format with no " +
  "group separator. Lines end with CRLF. Streamed.";

export const exportPlan = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/export/plan",
  operationId: "exportPlan",
  tags: ["Export"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "The plan file: every category's month, from the first month on",
  description:
    "Columns: Month, Category Group/Category, Category Group, Category, Assigned, Activity, " +
    "Available; one row per category and month, visible categories first, then hidden ones " +
    `(group "Hidden Categories"). Starts with a UTF-8 byte-order mark. ${FORMAT}`,
  request: { params: BudgetParams, query: TodayQuery },
  responses: { 200: delimited("The plan file"), 400: jsonError("Invalid input"), ...common },
});

export const exportRegister = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/export/register",
  operationId: "exportRegister",
  tags: ["Export"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "The register file: every transaction, newest first",
  description:
    "Columns: Account, Flag, Date, Payee, Category Group/Category, Category Group, Category, " +
    "Memo, Outflow, Inflow, Cleared, plus Currency, FX Rate, Base Outflow and Base Inflow when " +
    "the budget has an account in another currency. A split is one row per line, memo " +
    `"Split (i/n) …". Starts with a UTF-8 byte-order mark. ${FORMAT}`,
  request: { params: BudgetParams },
  responses: { 200: delimited("The register file"), ...common },
});

export const exportSelectedTransactions = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/export/transactions",
  operationId: "exportSelectedTransactions",
  tags: ["Export"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Export # Transactions: the register file for the selected transactions",
  description: `The register file's layout for a selection, with no byte-order mark. ${FORMAT}`,
  request: {
    params: BudgetParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ selection: SelectionSchema }).openapi("ExportSelection"),
        },
      },
    },
  },
  responses: {
    200: delimited("The selected transactions"),
    400: jsonError("Invalid input"),
    ...common,
  },
});
