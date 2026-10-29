import { createRoute, z } from "@hono/zod-openapi";
import { CATEGORY_GROUP_KINDS } from "@strictbudget/db/schema";
import {
  BUDGET_MONTH_PATTERN,
  TARGET_REPEAT_UNITS,
  zCurrencyCode,
  zMinorUnits,
  zTargetBehavior,
  zTargetCadence,
  zTargetGoal,
} from "@strictbudget/engine";
import { jsonError } from "../../lib/errors";
import { serverToday } from "../../lib/ledger";
import { authSecurity, requireAuth } from "../../middleware/require-auth";

const Name = z.string().trim().min(1).max(100);
const Note = z.string().max(10_000);

const zMonth = z
  .string()
  .regex(BUDGET_MONTH_PATTERN, "Expected a month as YYYY-MM")
  .describe("A month, YYYY-MM");
const DueDay = z
  .number()
  .int()
  .min(1)
  .max(31)
  .nullable()
  .describe("Day of the month it's due; null is the last day. Only changes the wording");
const Weekday = z.number().int().min(0).max(6).describe("The weekday it's due, 0 = Sunday");
const RepeatUnit = z.enum(TARGET_REPEAT_UNITS);

const Goal = zTargetGoal.describe(
  "A savings goal, for savings categories, saved on the target that works it out. keep_saving " +
    "('Keep saving'): monthly set_aside, `amount` a month; money taken out of a savings category " +
    "with this goal counts as saved, not spent, in reports. safety_fund ('Keep a safety fund'): " +
    "monthly refill up to `goalAmount`, asking at most `amount` a month (equal to goalAmount for " +
    "all at once). save_up ('Save up for something'): `goalAmount` in all, either `amount` a month " +
    "(monthly set_aside) or by `dueDate` (custom one-time set_aside with amount = goalAmount); it " +
    "counts what was put in (the money in the category when it began, plus Assigned since), so " +
    "spending the money on what it was for doesn't undo it, and editing it keeps counting from its " +
    "start. Null for an ordinary target",
);
const GoalAmount = zMinorUnits.describe(
  "save_up: the total to save; safety_fund: the balance to keep. In `currency`'s minor units; " +
    "null for other targets",
);

const TargetSchema = z
  .object({
    cadence: zTargetCadence,
    behavior: zTargetBehavior.describe(
      "set_aside: the full amount each period ('Set aside another'); refill: only what " +
        "brings the category back up to the amount ('Refill up to', custom 'Fill up to'); balance: " +
        "reach the amount, by a month or eventually ('Have a balance of', custom only). Payment " +
        "targets: set_aside for payment_monthly and debt_monthly, balance for payoff_by_date",
    ),
    amount: zMinorUnits.describe(
      "Per week (weekly), per month (monthly, payment_monthly, debt_monthly) or per period " +
        "(yearly, custom); " +
        "0 for payoff_by_date, which pays off what the card owes. In `currency`'s minor units",
    ),
    currency: zCurrencyCode.describe(
      "The target's own currency (a EUR holiday target in a USD budget). Its amount is converted " +
        "into the budget's currency at today's rate, rounded up, before the month's math",
    ),
    dueDay: z
      .number()
      .int()
      .nullable()
      .describe(
        "Monthly and debt_monthly: day of the month, null for the last. Weekly: weekday, 0 = Sunday",
      ),
    dueDate: z.iso
      .date()
      .nullable()
      .describe(
        "Yearly and custom: the first due date; a balance target's month (day 1), null for " +
          "eventually. payoff_by_date: the month to pay off by (day 1)",
      ),
    repeatEvery: z
      .number()
      .int()
      .nullable()
      .describe("Custom: repeats every N months or years; null for one-time"),
    repeatUnit: RepeatUnit.nullable(),
    startMonth: zMonth.describe("The first month the target applies to"),
    startDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .nullable()
      .describe(
        "Weekly: the day of the start month it began on (earlier weeks that month aren't asked " +
          "for); null for the whole month",
      ),
    snoozedMonth: zMonth
      .nullable()
      .describe("The month it's snoozed for: it asks for nothing more that month only"),
    goal: Goal.nullable(),
    goalAmount: GoalAmount.nullable(),
  })
  .openapi("CategoryTarget");

const Amount = zMinorUnits.refine((v) => BigInt(v) > 0n, "The amount must be positive");
const SetAsideOrRefill = z.enum(["set_aside", "refill"]);
const SetTargetSchema = z
  .discriminatedUnion("cadence", [
    z.object({
      cadence: z.literal("weekly"),
      behavior: SetAsideOrRefill,
      amount: Amount,
      dueDay: Weekday,
    }),
    z.object({
      cadence: z.literal("monthly"),
      behavior: SetAsideOrRefill,
      amount: Amount,
      dueDay: DueDay,
    }),
    z.object({
      cadence: z.literal("yearly"),
      behavior: SetAsideOrRefill,
      amount: Amount,
      dueDate: z.iso.date().describe("When the yearly amount is due; repeats every year"),
    }),
    z.object({
      cadence: z.literal("custom"),
      behavior: zTargetBehavior,
      amount: Amount,
      dueDate: z.iso
        .date()
        .nullable()
        .describe("Required unless behavior is balance (null: eventually; only its month counts)"),
      repeat: z
        .object({
          every: z.number().int().min(1).max(11),
          unit: RepeatUnit,
        })
        .nullable()
        .describe(
          "Every 1–11 months or 1–2 years; null for one-time. Balance targets can't repeat",
        ),
    }),
    // Credit card payment categories take only these two; other categories can't take them.
    z.object({
      cadence: z.literal("payment_monthly"),
      amount: Amount,
    }),
    z.object({
      cadence: z.literal("payoff_by_date"),
      dueMonth: zMonth.describe("Pay off the card's balance by the end of this month"),
    }),
    // A category paired with a loan takes only this.
    z.object({
      cadence: z.literal("debt_monthly"),
      amount: Amount,
      dueDay: DueDay,
    }),
  ])
  .and(
    z.object({
      month: zMonth.describe("The month the target is set from"),
      currency: zCurrencyCode
        .optional()
        .describe(
          "The target's currency (defaults to the budget's); `amount` is in its minor units. " +
            "payoff_by_date and debt_monthly targets stay in the budget's currency",
        ),
      today: z.iso
        .date()
        .optional()
        .describe(
          "The user's today (defaults to the server's UTC date): a target made weekly in this " +
            "month asks only for the weeks from today",
        ),
      goal: Goal.nullable().optional(),
      goalAmount: Amount.nullable()
        .optional()
        .describe(GoalAmount.description ?? ""),
    }),
  )
  .superRefine((v, ctx) => {
    // A pay-off target can't be saved with a month before today's.
    if (v.cadence === "payoff_by_date" && v.dueMonth < (v.today ?? serverToday()).slice(0, 7)) {
      ctx.addIssue({ code: "custom", path: ["dueMonth"], message: "Choose this month or later" });
    }
    goalIssues(v, ctx);
    if (v.cadence !== "custom") return;
    if (v.behavior !== "balance" && v.dueDate === null) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Choose when it's due" });
    }
    if (v.behavior === "balance" && v.repeat) {
      ctx.addIssue({ code: "custom", path: ["repeat"], message: "A balance target can't repeat" });
    }
    if (v.repeat?.unit === "year" && v.repeat.every > 2) {
      ctx.addIssue({ code: "custom", path: ["repeat", "every"], message: "Every 1 or 2 years" });
    }
  })
  .openapi("SetCategoryTarget");

/** The shapes each savings goal is saved on (see `Goal`). */
function goalIssues(
  v: {
    cadence: string;
    behavior?: string;
    amount?: string;
    dueDate?: string | null;
    repeat?: unknown;
    goal?: string | null;
    goalAmount?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  const issue = (message: string, path = "goal") =>
    ctx.addIssue({ code: "custom", path: [path], message });
  const goalAmount = v.goalAmount == null ? null : BigInt(v.goalAmount);
  const amount = v.amount === undefined ? null : BigInt(v.amount);
  switch (v.goal ?? null) {
    case null:
      if (goalAmount !== null) issue("Only savings goals have a goal amount", "goalAmount");
      return;
    case "keep_saving":
      if (v.cadence !== "monthly" || v.behavior !== "set_aside")
        issue("Keep saving is a monthly set aside");
      if (goalAmount !== null) issue("Keep saving has no goal amount", "goalAmount");
      return;
    case "safety_fund":
      if (v.cadence !== "monthly" || v.behavior !== "refill")
        issue("A safety fund is a monthly refill");
      if (goalAmount === null) issue("Enter the balance to keep", "goalAmount");
      else if (amount !== null && amount > goalAmount)
        issue("It can't ask for more a month than the balance to keep", "amount");
      return;
    case "save_up": {
      if (goalAmount === null) return issue("Enter how much to save", "goalAmount");
      const monthly = v.cadence === "monthly" && v.behavior === "set_aside";
      const dated =
        v.cadence === "custom" && v.behavior === "set_aside" && !v.repeat && Boolean(v.dueDate);
      if (!monthly && !dated)
        return issue("Save up is a monthly set aside, or a one-time set aside by a date");
      if (dated && amount !== goalAmount)
        issue("Saving up by a date sets aside the goal amount", "amount");
      if (monthly && amount !== null && amount > goalAmount)
        issue("It can't ask for more a month than the goal", "amount");
    }
  }
}

const Savings = z
  .boolean()
  .describe(
    "A savings category: money kept for a goal (an emergency fund, a holiday, retirement) rather " +
      "than spent this month. It's shown apart from spending money and left out of spending " +
      "pace, and its target can be a savings goal. Payment categories can't be savings.",
  );

export const CategorySchema = z
  .object({
    id: z.string(),
    groupId: z.string(),
    name: z.string(),
    note: z.string(),
    hidden: z.boolean(),
    linkedAccountId: z
      .string()
      .nullable()
      .describe("Set on a credit account's payment category, which is named after the account"),
    hasTransactions: z.boolean().describe("Deleting it requires reassignToCategoryId"),
    transactionCount: z
      .number()
      .int()
      .describe("Its transactions, split lines counted one by one (what a delete reassigns)"),
    hasAssignedMoney: z
      .boolean()
      .describe("Money assigned to it in some month (a delete returns it to Ready to Assign)"),
    savings: Savings,
    target: TargetSchema.nullable(),
  })
  .openapi("Category");

export const CategoryGroupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    hidden: z.boolean(),
    kind: z
      .enum(CATEGORY_GROUP_KINDS)
      .nullable()
      .describe("credit_card_payments: managed by the app, listed first"),
    categories: z.array(CategorySchema).describe("In display order, hidden ones included"),
  })
  .openapi("CategoryGroup");

export const CategoryListSchema = z
  .object({
    groups: z.array(CategoryGroupSchema).describe("In display order"),
    readyToAssignCategoryId: z
      .string()
      .describe("The internal 'Inflow: Ready to Assign' category, for categorizing income"),
    uncategorizedCategoryId: z
      .string()
      .describe("The internal Uncategorized category (reports filter and group by it)"),
  })
  .openapi("CategoryList");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});
const GroupParams = BudgetParams.extend({
  groupId: z.string().openapi({ param: { name: "groupId", in: "path" } }),
});
const CategoryParams = BudgetParams.extend({
  categoryId: z.string().openapi({ param: { name: "categoryId", in: "path" } }),
});

function json<T extends z.ZodType>(schema: T) {
  return { required: true, content: { "application/json": { schema } } } as const;
}

const ReassignQuery = z.object({
  reassignToCategoryId: z
    .string()
    .optional()
    .openapi({
      param: { name: "reassignToCategoryId", in: "query" },
      description: "Required when the category (or a category in the group) has transactions",
    }),
});
const managed = jsonError(
  "MANAGED_CATEGORY: not allowed on Credit Card Payments; CATEGORY_HAS_HISTORY: pass reassignToCategoryId",
);

const notFound = jsonError("No such budget, group or category, or the caller isn't a member");

export const listCategories = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/categories",
  operationId: "listCategories",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Category groups with their categories, in display order",
  request: { params: BudgetParams },
  responses: {
    200: {
      description: "The budget's categories (internal ones excluded)",
      content: { "application/json": { schema: CategoryListSchema } },
    },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const createCategoryGroup = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/category-groups",
  operationId: "createCategoryGroup",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Add a category group at the end of the list",
  request: {
    params: BudgetParams,
    body: json(z.object({ name: Name }).openapi("CreateCategoryGroup")),
  },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: CategoryGroupSchema } },
    },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: managed,
  },
});

export const updateCategoryGroup = createRoute({
  method: "patch",
  path: "/budgets/{budgetId}/category-groups/{groupId}",
  operationId: "updateCategoryGroup",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Rename, hide or unhide a category group",
  request: {
    params: GroupParams,
    body: json(
      z
        .strictObject({ name: Name.optional(), hidden: z.boolean().optional() })
        .openapi("UpdateCategoryGroup"),
    ),
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: CategoryGroupSchema } },
    },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: managed,
  },
});

export const deleteCategoryGroup = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}/category-groups/{groupId}",
  operationId: "deleteCategoryGroup",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Delete a category group and its categories",
  request: { params: GroupParams, query: ReassignQuery },
  responses: {
    204: { description: "Deleted" },
    400: jsonError("Invalid reassignment target"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: managed,
  },
});

export const moveCategoryGroup = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/category-groups/{groupId}/move",
  operationId: "moveCategoryGroup",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Move a category group before another one, or to the end",
  request: {
    params: GroupParams,
    body: json(
      z
        .object({
          beforeGroupId: z
            .string()
            .nullable()
            .describe("Place the group right before this one; null moves it to the end"),
        })
        .openapi("MoveCategoryGroup"),
    ),
  },
  responses: {
    200: {
      description: "The categories in their new order",
      content: { "application/json": { schema: CategoryListSchema } },
    },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: managed,
  },
});

export const createCategory = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/categories",
  operationId: "createCategory",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Add a category at the end of a group",
  request: {
    params: BudgetParams,
    body: json(
      z
        .object({ groupId: z.string(), name: Name, savings: Savings.optional() })
        .openapi("CreateCategory"),
    ),
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: CategorySchema } } },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: managed,
  },
});

export const updateCategory = createRoute({
  method: "patch",
  path: "/budgets/{budgetId}/categories/{categoryId}",
  operationId: "updateCategory",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Rename a category, change its note, or hide/unhide it",
  request: {
    params: CategoryParams,
    body: json(
      z
        .strictObject({
          name: Name.optional(),
          note: Note.optional(),
          hidden: z.boolean().optional(),
          savings: Savings.optional(),
        })
        .openapi("UpdateCategory"),
    ),
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: CategorySchema } } },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: managed,
  },
});

export const deleteCategory = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}/categories/{categoryId}",
  operationId: "deleteCategory",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Delete a category, moving its history to another category",
  request: { params: CategoryParams, query: ReassignQuery },
  responses: {
    204: { description: "Deleted" },
    400: jsonError("Invalid reassignment target"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: managed,
  },
});

export const moveCategory = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/categories/{categoryId}/move",
  operationId: "moveCategory",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Move a category within its group or into another group",
  request: {
    params: CategoryParams,
    body: json(
      z
        .object({
          groupId: z.string().describe("The group to move the category into"),
          beforeCategoryId: z
            .string()
            .nullable()
            .describe(
              "Place it right before this category in that group; null moves it to the end",
            ),
        })
        .openapi("MoveCategory"),
    ),
  },
  responses: {
    200: {
      description: "The categories in their new order",
      content: { "application/json": { schema: CategoryListSchema } },
    },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: managed,
  },
});

export const setCategoryTarget = createRoute({
  method: "put",
  path: "/budgets/{budgetId}/categories/{categoryId}/target",
  operationId: "setCategoryTarget",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Create or replace a category's target",
  description:
    "A category has one target at a time, the same in every month from its start. A new or changed " +
    "target starts in `month` (the month it's saved from), so earlier months show none; saving it " +
    "unchanged from an earlier month moves the start back. Credit card payment categories take " +
    "only payment_monthly and " +
    "payoff_by_date targets, and only they take them; a category paired with a loan takes only " +
    "debt_monthly (Monthly Debt Payment), and only it does.",
  request: {
    params: CategoryParams,
    body: json(SetTargetSchema),
  },
  responses: {
    200: { description: "Saved", content: { "application/json": { schema: CategorySchema } } },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: jsonError(
      "MANAGED_CATEGORY: payment categories take only payment targets, other categories none",
    ),
    422: jsonError(
      "TARGET_CURRENCY: a payoff_by_date or debt_monthly target in another currency than the " +
        "budget's",
    ),
  },
});

export const restoreCategoryTarget = createRoute({
  method: "put",
  path: "/budgets/{budgetId}/categories/{categoryId}/target/restore",
  operationId: "restoreCategoryTarget",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Put a category's target back as it was (undo and redo)",
  description:
    "Writes the target exactly as given, start month, start day and snooze included, or removes " +
    "it when `target` is null. For undoing and redoing target edits; the start-month rules of " +
    "setCategoryTarget don't apply.",
  request: {
    params: CategoryParams,
    body: json(z.object({ target: TargetSchema.nullable() })),
  },
  responses: {
    200: { description: "Restored", content: { "application/json": { schema: CategorySchema } } },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: jsonError(
      "MANAGED_CATEGORY: payment categories take only payment targets, other categories none",
    ),
  },
});

export const deleteCategoryTarget = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}/categories/{categoryId}/target",
  operationId: "deleteCategoryTarget",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Remove a category's target",
  request: { params: CategoryParams },
  responses: {
    200: { description: "Removed", content: { "application/json": { schema: CategorySchema } } },
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: notFound,
  },
});

export const snoozeCategoryTarget = createRoute({
  method: "put",
  path: "/budgets/{budgetId}/categories/{categoryId}/target/snooze",
  operationId: "snoozeCategoryTarget",
  tags: ["Categories"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Snooze a category's target for this month, or wake it",
  description:
    "A snoozed target asks for nothing more in the month it's snoozed for; the next month it asks " +
    "again. Only the user's current month can be snoozed, and never a credit card payment " +
    "target.",
  request: {
    params: CategoryParams,
    body: json(
      z
        .object({
          month: zMonth.describe("The month to snooze; must be the user's current month"),
          snoozed: z.boolean(),
          today: z.iso
            .date()
            .optional()
            .describe("The user's today. Defaults to the server's UTC date."),
        })
        .openapi("SnoozeTarget"),
    ),
  },
  responses: {
    200: { description: "Saved", content: { "application/json": { schema: CategorySchema } } },
    400: jsonError("Invalid input, or SNOOZE_CURRENT_MONTH: only the current month can be snoozed"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't edit categories, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such category or target, or the caller isn't a member"),
    409: jsonError("MANAGED_CATEGORY: credit card payment targets can't be snoozed"),
  },
});
