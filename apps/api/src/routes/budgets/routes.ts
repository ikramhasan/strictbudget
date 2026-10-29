import { createRoute, z } from "@hono/zod-openapi";
import { BUDGET_ROLES } from "@strictbudget/db/schema";
import {
  zCurrencyCode,
  zCurrencySymbolPosition,
  zDateFormat,
  zNumberFormat,
} from "@strictbudget/engine";
import { jsonError } from "../../lib/errors";
import {
  authSecurity,
  requireAuth,
  requireSession,
  sessionSecurity,
} from "../../middleware/require-auth";

const BudgetName = z.string().trim().min(1).max(100);
const SavingsRateGoal = z.number().int().min(0).max(10000);

export const BudgetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    currency: zCurrencyCode,
    numberFormat: zNumberFormat,
    currencySymbolPosition: zCurrencySymbolPosition,
    dateFormat: zDateFormat,
    role: z.enum(BUDGET_ROLES).describe("The signed-in user's role in this budget"),
    archivedAt: z.iso
      .datetime()
      .nullable()
      .describe(
        "Set when a fresh start replaced this budget (its name gets '(Archived on <date>)'); " +
          "it stays usable. Renaming it without that stamp restores it (clears this).",
      ),
    lastUsedAt: z.iso
      .datetime()
      .nullable()
      .describe("When the signed-in user last opened this budget; null if never"),
    savingsRateGoal: SavingsRateGoal.nullable().describe(
      "The savings rate report's goal in basis points (2000 = 20%); null for none",
    ),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("Budget");

const BudgetListSchema = z
  .object({
    budgets: z.array(BudgetSchema),
    lastUsedBudgetId: z.string().nullable(),
  })
  .openapi("BudgetList");

const CreateBudgetSchema = z
  .object({
    name: BudgetName,
    currency: zCurrencyCode,
    numberFormat: zNumberFormat,
    currencySymbolPosition: zCurrencySymbolPosition,
    dateFormat: zDateFormat,
  })
  .openapi("CreateBudget");

const UpdateBudgetSchema = z
  .strictObject({
    name: BudgetName.optional(),
    numberFormat: zNumberFormat.optional(),
    currencySymbolPosition: zCurrencySymbolPosition.optional(),
    dateFormat: zDateFormat.optional(),
    savingsRateGoal: SavingsRateGoal.nullable()
      .optional()
      .describe("The savings rate goal in basis points (2000 = 20%); null clears it"),
  })
  .openapi("UpdateBudget", { description: "The currency can't be changed after creation." });

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});

export const listBudgets = createRoute({
  method: "get",
  path: "/budgets",
  operationId: "listBudgets",
  tags: ["Budgets"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Budgets the signed-in user belongs to",
  responses: {
    200: {
      description: "Budgets, most recently used first (then by name), and the last-used one",
      content: { "application/json": { schema: BudgetListSchema } },
    },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
  },
});

export const createBudget = createRoute({
  method: "post",
  path: "/budgets",
  operationId: "createBudget",
  tags: ["Budgets"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Create a budget (the caller becomes its owner)",
  request: {
    body: { required: true, content: { "application/json": { schema: CreateBudgetSchema } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: BudgetSchema } } },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
  },
});

export const getBudget = createRoute({
  method: "get",
  path: "/budgets/{budgetId}",
  operationId: "getBudget",
  tags: ["Budgets"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "One budget (also records it as the caller's last-used budget)",
  request: { params: BudgetParams },
  responses: {
    200: { description: "The budget", content: { "application/json": { schema: BudgetSchema } } },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const updateBudget = createRoute({
  method: "patch",
  path: "/budgets/{budgetId}",
  operationId: "updateBudget",
  tags: ["Budgets"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Rename a budget, change its formats or set its savings rate goal",
  request: {
    params: BudgetParams,
    body: { required: true, content: { "application/json": { schema: UpdateBudgetSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: BudgetSchema } } },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't update this budget, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const deleteBudget = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}",
  operationId: "deleteBudget",
  tags: ["Budgets"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Delete a budget and everything in it (owner only)",
  request: { params: BudgetParams },
  responses: {
    204: { description: "Deleted" },
    401: jsonError("Not signed in"),
    403: jsonError(
      "Only the owner can delete a budget, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const freshStartBudget = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/fresh-start",
  operationId: "freshStartBudget",
  tags: ["Budgets"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Fresh start: archive this budget and continue in a copy without transactions",
  description:
    "Owner only. The new budget is named `name` and keeps the settings, partners, categories " +
    "(with their notes), payees, flag names, custom views, accounts (each starting at $0 on " +
    "`date`; starred ones stay starred) and scheduled " +
    "transactions. The old one gets ' (Archived on <date>)' added to its name. An archived " +
    "budget can make a fresh start again.",
  request: {
    params: BudgetParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              date: z.iso.date().describe("The user's today, YYYY-MM-DD"),
              name: BudgetName.describe("The new budget's name"),
            })
            .openapi("FreshStart"),
        },
      },
    },
  },
  responses: {
    201: {
      description: "The new budget",
      content: { "application/json": { schema: BudgetSchema } },
    },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "Only the owner can make a fresh start, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});
