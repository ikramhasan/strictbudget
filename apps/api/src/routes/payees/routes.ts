import { createRoute, z } from "@hono/zod-openapi";
import {
  zCurrencyCode,
  zMinorUnits,
  zPayeeCategorization,
  zPayeeRuleOperator,
} from "@strictbudget/engine";
import { jsonError } from "../../lib/errors";
import { authSecurity, requireAuth } from "../../middleware/require-auth";

const PayeeName = z.string().trim().min(1, "Payee name cannot be empty").max(200);
const PayeeIds = z.array(z.string()).min(1).max(1000);

const PayeeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    hidden: z
      .boolean()
      .describe("Left out of the payee field's suggestions; typing the exact name still uses it"),
    useCount: z
      .number()
      .int()
      .describe("Transactions and scheduled transactions (split lines included) using the payee"),
    categorization: zPayeeCategorization.describe(
      'Manage Payees\' Categorization: "auto" (Auto-categorize based on payee history), "always" ' +
        '(Always use my choice) or "never" (Do not auto-categorize)',
    ),
    defaultCategoryId: z
      .string()
      .nullable()
      .describe('The "Always use my choice" category; null unless `categorization` is "always"'),
    autoCategoryId: z
      .string()
      .nullable()
      .describe(
        "Current default category from the payee's history: the first categorization, changed " +
          "only when two of the last three (by date; splits and Uncategorized left out) agree",
      ),
    prefillCategoryId: z
      .string()
      .nullable()
      .describe("The category a new transaction for this payee starts with, by `categorization`"),
    recentCategoryIds: z
      .array(z.string())
      .describe(
        "Categories used with the payee, most recent first, each once, split lines included " +
          "(up to six: the category list suggests five besides the selected one)",
      ),
  })
  .openapi("Payee");

const PayeeUsesSchema = z
  .object({
    payeeId: z.string(),
    transactionIds: z.array(z.string()),
    subTransactionIds: z.array(z.string()),
    scheduledTransactionIds: z.array(z.string()),
    scheduledSubTransactionIds: z.array(z.string()),
  })
  .openapi("PayeeUses");

const RuleText = z
  .string()
  .min(1)
  .max(200)
  .refine((t) => t.trim().length > 0, "Rule text cannot be empty")
  .describe("Kept as typed, surrounding spaces included");

const PayeeRuleSchema = z
  .object({
    id: z.string(),
    payeeId: z.string().describe("The payee an imported payee meeting the rule is renamed to"),
    operator: zPayeeRuleOperator,
    text: z.string(),
  })
  .openapi("PayeeRule");

export const PayeeRuleSnapshotSchema = PayeeRuleSchema.extend({
  text: RuleText,
  position: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
}).openapi("PayeeRuleSnapshot");

const PayeeSnapshotSchema = z
  .object({
    payees: z
      .array(
        z.object({
          id: z.string(),
          name: PayeeName,
          hidden: z.boolean(),
          categorization: zPayeeCategorization.optional(),
          defaultCategoryId: z.string().nullable().optional(),
          carriedCategoryId: z.string().nullable().optional(),
          autoCategoryId: z.string().nullable().optional(),
          autoCategorySaved: z.boolean().optional(),
        }),
      )
      .max(1000)
      .describe("Each payee as it was"),
    uses: z.array(PayeeUsesSchema).max(1000).describe("The rows that pointed at each payee"),
    rules: z
      .array(PayeeRuleSnapshotSchema)
      .max(5000)
      .default([])
      .describe("The payees' renaming rules as they were"),
  })
  .openapi("PayeeSnapshot");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});
const PayeeParams = BudgetParams.extend({
  payeeId: z.string().openapi({ param: { name: "payeeId", in: "path" } }),
});

function ok<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}
function body<T extends z.ZodType>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}
const notFound = jsonError("No such budget or payee, or the caller isn't a member");
const forbidden = jsonError(
  "The caller's role can't change transactions, or the account's email address isn't confirmed",
);

export const listPayees = createRoute({
  tags: ["Payees"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "get",
  path: "/budgets/{budgetId}/payees",
  operationId: "listPayees",
  summary: "The budget's payees, by name (built-in and transfer ones left out unless asked for)",
  request: {
    params: BudgetParams,
    query: z.object({
      include: z
        .enum(["all"])
        .optional()
        .describe(
          '"all" adds the transfer payees ("Transfer : <account>") and built-in ones like ' +
            '"Starting Balance", for naming every payee an id points at (the Activity feed)',
        ),
    }),
  },
  responses: {
    200: ok("Payees", z.object({ payees: z.array(PayeeSchema) }).openapi("PayeeList")),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const updatePayee = createRoute({
  tags: ["Payees"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "patch",
  path: "/budgets/{budgetId}/payees/{payeeId}",
  operationId: "updatePayee",
  summary: "Rename, hide or unhide a payee, or change how it categorizes",
  description:
    "Another payee can't have the same name (case aside: `PAYEE_NAME_TAKEN`). Transfer and " +
    'built-in payees can\'t be changed (`PAYEE_LOCKED`). `categorization` "always" needs a ' +
    "`defaultCategoryId` (`CATEGORY_REQUIRED`): one of the budget's categories other than " +
    'Uncategorized and credit card payment ones (`INVALID_CATEGORY`). Switching to "auto" or ' +
    '"never" forgets the chosen category.',
  request: {
    params: PayeeParams,
    body: body(
      z
        .object({
          name: PayeeName.optional(),
          hidden: z.boolean().optional(),
          categorization: zPayeeCategorization.optional(),
          defaultCategoryId: z.string().nullable().optional(),
          restore: z
            .boolean()
            .optional()
            .describe('Undo: allows an "always" category that has been hidden since it was chosen'),
        })
        .openapi("UpdatePayee"),
    ),
  },
  responses: {
    200: ok("Updated", PayeeSchema),
    400: jsonError(
      "Invalid input, a missing (`CATEGORY_REQUIRED`) or unusable (`INVALID_CATEGORY`) category",
    ),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    409: jsonError("Name taken (`PAYEE_NAME_TAKEN`) or a transfer/built-in payee (`PAYEE_LOCKED`)"),
  },
});

export const setPayeesHidden = createRoute({
  tags: ["Payees"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "post",
  path: "/budgets/{budgetId}/payees/hide",
  operationId: "setPayeesHidden",
  summary: "Hide or unhide several payees",
  request: {
    params: BudgetParams,
    body: body(z.object({ payeeIds: PayeeIds, hidden: z.boolean() }).openapi("SetPayeesHidden")),
  },
  responses: {
    204: { description: "Done" },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    409: jsonError("A transfer or built-in payee (`PAYEE_LOCKED`)"),
  },
});

const ChangeResult = z
  .object({
    snapshot: PayeeSnapshotSchema.describe("What changed, for `restorePayees` to undo it"),
  })
  .openapi("PayeeChange");

export const combinePayees = createRoute({
  tags: ["Payees"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "post",
  path: "/budgets/{budgetId}/payees/combine",
  operationId: "combinePayees",
  summary: "Combine payees into one, under a name",
  description:
    "Every transaction and scheduled transaction using them moves to one payee called `name`: " +
    "the payee that already has that name (one of these or another), else the first of " +
    "`payeeIds`, renamed. The others are deleted. Categories don't change.",
  request: {
    params: BudgetParams,
    body: body(z.object({ payeeIds: PayeeIds.min(2), name: PayeeName }).openapi("CombinePayees")),
  },
  responses: {
    200: ok("Combined", ChangeResult.extend({ payee: PayeeSchema }).openapi("CombinedPayees")),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    409: jsonError("A transfer or built-in payee (`PAYEE_LOCKED`)"),
  },
});

export const deletePayees = createRoute({
  tags: ["Payees"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "post",
  path: "/budgets/{budgetId}/payees/delete",
  operationId: "deletePayees",
  summary: "Delete payees, moving their transactions to another payee or none",
  description:
    "Transactions and scheduled transactions using them move to `replacementPayeeId` (null for " +
    "no payee). The replacement can't be one of the deleted payees, a transfer or a built-in " +
    "payee (`INVALID_REPLACEMENT`).",
  request: {
    params: BudgetParams,
    body: body(
      z
        .object({ payeeIds: PayeeIds, replacementPayeeId: z.string().nullable().default(null) })
        .openapi("DeletePayees"),
    ),
  },
  responses: {
    200: ok("Deleted", ChangeResult),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    409: jsonError("A transfer or built-in payee (`PAYEE_LOCKED`), or a bad replacement"),
  },
});

export const restorePayees = createRoute({
  tags: ["Payees"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "post",
  path: "/budgets/{budgetId}/payees/restore",
  operationId: "restorePayees",
  summary: "Put payees back as a snapshot describes them (undoing a combine or delete)",
  description:
    "Recreates or renames each payee and points the listed rows back at it. Rows that no longer " +
    "exist are skipped. A name another payee has taken since fails with `PAYEE_NAME_TAKEN`.",
  request: { params: BudgetParams, body: body(PayeeSnapshotSchema) },
  responses: {
    204: { description: "Restored" },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    409: jsonError("Name taken (`PAYEE_NAME_TAKEN`) or a transfer/built-in payee (`PAYEE_LOCKED`)"),
  },
});

const PayeeTransactionSchema = z
  .object({
    id: z.string().describe("The transaction, split line or scheduled transaction"),
    kind: z.enum(["transaction", "scheduled"]),
    splitLine: z.boolean().describe("A line of a split transaction or scheduled split"),
    accountId: z.string(),
    accountName: z.string(),
    date: z.string().describe("A scheduled transaction's next date"),
    categoryName: z.string().nullable().describe("Null when uncategorized or none"),
    memo: z.string(),
    amount: zMinorUnits,
    currency: zCurrencyCode,
  })
  .openapi("PayeeTransaction");

export const listPayeeTransactions = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/payees/transactions",
  operationId: "listPayeeTransactions",
  tags: ["Payees"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Everything using these payees: transactions, split lines and scheduled ones",
  description: 'Newest first, as Manage Payees\' "Show N Transactions" lists them.',
  request: {
    params: BudgetParams,
    query: z.object({
      payeeIds: z
        .string()
        .min(1)
        .transform((v) => v.split(","))
        .describe("Comma-separated payee ids"),
    }),
  },
  responses: {
    200: ok(
      "Transactions",
      z.object({ transactions: z.array(PayeeTransactionSchema) }).openapi("PayeeTransactionList"),
    ),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

const RuleParams = BudgetParams.extend({
  ruleId: z.string().openapi({ param: { name: "ruleId", in: "path" } }),
});
const ruleNotFound = jsonError("No such budget or rule, or the caller isn't a member");

export const listPayeeRules = createRoute({
  tags: ["Payees"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "get",
  path: "/budgets/{budgetId}/payees/rules",
  operationId: "listPayeeRules",
  summary: "The budget's renaming rules, each payee's in order",
  description:
    "Rules of transfer payees are included; `transferPayees` gives each account's transfer payee " +
    "so they can be shown and added to.",
  request: { params: BudgetParams },
  responses: {
    200: ok(
      "Rules",
      z
        .object({
          rules: z.array(PayeeRuleSchema),
          transferPayees: z.array(z.object({ payeeId: z.string(), accountId: z.string() })),
        })
        .openapi("PayeeRuleList"),
    ),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const createPayeeRule = createRoute({
  tags: ["Payees"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "post",
  path: "/budgets/{budgetId}/payees/{payeeId}/rules",
  operationId: "createPayeeRule",
  summary: "Add a renaming rule to a payee (a transfer payee too)",
  description:
    "Added after the payee's other rules. The same rule twice is allowed. Built-in " +
    "payees like Starting Balance take no rules (`PAYEE_LOCKED`).",
  request: {
    params: PayeeParams,
    body: body(
      z
        .object({
          operator: zPayeeRuleOperator,
          text: RuleText,
          position: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Where among the payee's rules (undoing a removal); default after the last"),
        })
        .openapi("CreatePayeeRule"),
    ),
  },
  responses: {
    201: ok("Created", PayeeRuleSchema),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    409: jsonError("A built-in payee (`PAYEE_LOCKED`)"),
  },
});

export const updatePayeeRule = createRoute({
  tags: ["Payees"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "patch",
  path: "/budgets/{budgetId}/payees/rules/{ruleId}",
  operationId: "updatePayeeRule",
  summary: "Change a renaming rule's condition or text",
  request: {
    params: RuleParams,
    body: body(
      z
        .object({ operator: zPayeeRuleOperator.optional(), text: RuleText.optional() })
        .openapi("UpdatePayeeRule"),
    ),
  },
  responses: {
    200: ok("Updated", PayeeRuleSchema),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: ruleNotFound,
  },
});

export const deletePayeeRule = createRoute({
  tags: ["Payees"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  method: "delete",
  path: "/budgets/{budgetId}/payees/rules/{ruleId}",
  operationId: "deletePayeeRule",
  summary: "Remove a renaming rule",
  request: { params: RuleParams },
  responses: {
    204: { description: "Removed" },
    401: jsonError("Not signed in"),
    403: forbidden,
    404: ruleNotFound,
  },
});
