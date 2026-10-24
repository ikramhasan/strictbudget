import { createRoute, z } from "@hono/zod-openapi";
import { BUDGET_ROLES } from "@strictbudget/db/schema";
import {
  AUTO_ASSIGN_OPTIONS,
  BUDGET_MONTH_PATTERN,
  zCurrencyCode,
  zMinorUnits,
} from "@strictbudget/engine";
import { jsonError } from "../../lib/errors";
import { zAvatarColor, zPicture } from "../../lib/member-colors";
import { authSecurity, requireAuth } from "../../middleware/require-auth";

const zBudgetMonth = z
  .string()
  .regex(BUDGET_MONTH_PATTERN, "Expected a month as YYYY-MM")
  .describe("A month, YYYY-MM");

const Activity = {
  activity: zMinorUnits,
  cashActivity: zMinorUnits.describe(
    "The part of activity in cash accounts, refunds included (Cash Spending)",
  ),
  creditActivity: zMinorUnits.describe(
    "The part of activity in credit accounts, refunds included (Credit Spending)",
  ),
};

const Overspent = {
  cashOverspent: zMinorUnits.describe(
    "The cash part of a negative Available (taken from next month's Ready to Assign); 0 otherwise",
  ),
  creditOverspent: zMinorUnits.describe(
    "The rest of a negative Available: credit overspending, which becomes card debt; 0 otherwise",
  ),
};

const Totals = z
  .object({ assigned: zMinorUnits, ...Activity, available: zMinorUnits, ...Overspent })
  .openapi("MonthTotals");

const AutoAssignSchema = z
  .object(
    Object.fromEntries(AUTO_ASSIGN_OPTIONS.map((o) => [o, zMinorUnits])) as Record<
      (typeof AUTO_ASSIGN_OPTIONS)[number],
      typeof zMinorUnits
    >,
  )
  .describe(
    "What each Auto-Assign option would set the category's Assigned to this month: enough to meet " +
      "its target and cover overspending (underfunded, when there's enough Ready to Assign), " +
      "last month's assigned or spending, the average over up to the last 12 months (from the " +
      "first with money assigned or spent), less what's above its target (reduceOverfunding), " +
      "Available reset to zero, or zero",
  )
  .openapi("AutoAssignAmounts");

const PaymentSchema = z
  .object({
    balance: zMinorUnits.describe(
      "The card's working balance at the end of the month (up to today)",
    ),
    priorBalance: zMinorUnits.describe("The card's balance before the month began"),
    spendingAndOutflows: zMinorUnits.describe(
      "The month's outflows on the card (purchases, cash advances, adjustments), negative",
    ),
    paymentsAndInflows: zMinorUnits.describe(
      "The month's inflows on the card (payments, returns, statement credits), positive",
    ),
    underfunded: zMinorUnits.describe(
      "What's owed beyond what's set aside (Total Underfunded); 0 when Available covers it",
    ),
    overspentCategories: zMinorUnits.describe(
      "The part of underfunded that is this month's credit overspending on the card",
    ),
    creditOverspending: zMinorUnits.describe(
      "This month's credit overspending on the card, whatever is set aside (the card register's " +
        '"Overspending (Oct)"); positive',
    ),
    fundedSpending: zMinorUnits.describe(
      "Money moved in this month for funded card spending, less returns (Funded Spending)",
    ),
    paymentsMade: zMinorUnits.describe("This month's payments to the card, negative"),
    hasUncategorized: z
      .boolean()
      .describe("The card has uncategorized transactions this month (up to today)"),
  })
  .nullable()
  .describe("Set on a credit account's payment category")
  .openapi("PaymentDetails");

const FutureTargetsSchema = z
  .object({
    needed: zMinorUnits.describe("What the month's targets need, all together"),
    funded: zMinorUnits.describe("How much of that is funded (each target counts up to its need)"),
  })
  .nullable()
  .describe("A later month's targets for the pie or check; null when it has none");

const TargetNeedSchema = z
  .object({
    needed: zMinorUnits.describe(
      "What the target needs: this month's amount (weekly, monthly) or the total by its due date " +
        "(yearly, custom), or the balance to reach",
    ),
    funded: zMinorUnits.describe(
      "What counts toward it: Assigned (set aside: this month's, or the period's for dated " +
        "targets), or what was carried in plus this month's Assigned (refill, balance; carried " +
        "money counts from the user's month on), or Available (balance); can be negative",
    ),
    underfunded: zMinorUnits.describe(
      "What's still to assign this month to stay on track; 0 when this month's share is in",
    ),
    dueDate: z.iso
      .date()
      .nullable()
      .describe("Yearly and custom: the due date of the period this month is in"),
    pastDue: z
      .boolean()
      .describe(
        "A one-time target after its due month: still shown, asking for nothing (underfunded 0)",
      ),
    snoozed: z
      .boolean()
      .describe("Snoozed this month: it asks for nothing more (Underfunded leaves it out)"),
    beforeOpening: z
      .boolean()
      .describe(
        "Payment targets: a month before the card's account was opened; it asks for nothing " +
          "(underfunded 0)",
      ),
  })
  .nullable()
  .describe(
    "The category's target this month; null without one, before it starts, after a " +
      "balance target's month or a card's pay off month",
  )
  .openapi("TargetNeed");

const FundingPartSchema = z
  .object({
    amount: zMinorUnits,
    step: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe(
        "1 overspending, 2 due this month (by date; end of month is the last day), 3 due before " +
          "the budget started (its first month only), 4 due in a later month, 5 credit card payment",
      ),
    date: z.string().describe("YYYY-MM-DD it's due; empty when the step isn't ordered by date"),
  })
  .openapi("FundingPart");

const ProgressBarSchema = z
  .object({
    tone: z
      .enum(["funded", "underfunded"])
      .describe("underfunded (yellow) while the target asks for more this month; funded (green)"),
    sections: z.array(
      z.object({
        kind: z
          .enum(["rollover", "target", "extra"])
          .describe(
            "rollover: money carried into a set aside target; target: the month, target period or " +
              "a week; extra: a weekly target's money or spending beyond its weeks",
          ),
        size: zMinorUnits.describe("What the section stands for; drawn in proportion"),
        segments: z.array(
          z.object({ kind: z.enum(["spent", "available", "overspent"]), amount: zMinorUnits }),
        ),
      }),
    ),
  })
  .nullable()
  .describe("The progress bar under the category; null for payment categories")
  .openapi("ProgressBar");

const MonthCategorySchema = Totals.extend({
  categoryId: z.string(),
  payment: PaymentSchema,
  target: TargetNeedSchema,
  targetConversion: z
    .object({
      currency: zCurrencyCode.describe("The target's own currency"),
      amount: zMinorUnits.describe("The target's amount, in its own currency's minor units"),
      amountInBase: zMinorUnits.describe(
        "The amount in the budget's currency at `rate`, rounded up: what the target math uses",
      ),
      rate: z.string().describe("Today's rate: 1 target currency = rate budget currency"),
    })
    .nullable()
    .describe(
      "A target in another currency than the budget's, converted at the user's today's rate; " +
        "null for a target in the budget's currency (or none). `target` is in the budget's currency",
    ),
  targetRateMissing: z
    .boolean()
    .describe(
      "The category's target is in another currency and no rate to the budget's is known: its " +
        "need is unknown, so `target` is null and Underfunded leaves it out",
    ),
  autoAssign: AutoAssignSchema,
  bar: ProgressBarSchema,
  underfundedParts: z
    .array(FundingPartSchema)
    .describe(
      "What Underfunded adds, in the pieces it funds in order when Ready to Assign runs short " +
        "(they add up to `autoAssign.underfunded` less Assigned)",
    ),
  upcoming: z
    .object({
      amount: zMinorUnits.describe(
        "Their net amount for the category; negative when more goes out than comes in",
      ),
      transactions: z
        .array(
          z.object({
            scheduleId: z.string(),
            accountId: z.string(),
            accountName: z.string(),
            date: z.iso.date(),
            payeeName: z.string().nullable(),
            memo: z.string(),
            amount: zMinorUnits.describe("What it does to this category"),
          }),
        )
        .describe("Latest first"),
    })
    .nullable()
    .describe(
      'Scheduled transactions still to come in the month ("Upcoming Transactions"): ' +
        "after the user's today, none in past months; null when there are none",
    )
    .openapi("CategoryUpcoming"),
}).openapi("MonthCategory");
const MonthGroupSchema = Totals.extend({ groupId: z.string() }).openapi("MonthGroup");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
  month: zBudgetMonth.openapi({ param: { name: "month", in: "path" } }),
});
const Today = z.iso
  .date()
  .describe("The user's today; later transactions don't count. Defaults to the server's UTC date.");

const MonthSchema = z
  .object({
    month: zBudgetMonth,
    currency: zCurrencyCode,
    firstMonth: zBudgetMonth.describe("The oldest month the budget shows"),
    lastMonth: zBudgetMonth.describe("The newest month the budget shows"),
    readyToAssign: zMinorUnits.describe(
      "Money without a job in this month; negative when more was assigned than there is",
    ),
    overdraft: z
      .boolean()
      .describe(
        "A negative Ready to Assign that taking back every category's cash wouldn't cover " +
          '("Overdraft?"); false when categories could cover it ("You assigned more ' +
          "than you have\", Fix This) and when Ready to Assign isn't negative",
      ),
    assignedInFuture: zMinorUnits.describe("Money assigned in the months after this one"),
    readyToAssignBreakdown: z
      .object({
        leftOver: zMinorUnits.describe(
          "Ready to Assign left over from last month, before later months' assigning",
        ),
        inflows: zMinorUnits.describe(
          "Inflows to Ready to Assign this month, card inflows left out",
        ),
        debtInflows: zMinorUnits.describe(
          "What credit accounts' balances above zero added this month (Inflow from Debt Account)",
        ),
        cashOverspending: zMinorUnits.describe("Last month's cash overspending (negative)"),
        assigned: zMinorUnits.describe("This month's assigned money (negative)"),
        assignedInFuture: zMinorUnits.describe(
          "What later months' assigning takes from this month (negative, never below zero)",
        ),
        total: zMinorUnits.describe("The sum of the lines: Ready to Assign"),
      })
      .describe("The Ready to Assign Breakdown, line by line"),
    futureMonths: z
      .array(
        z.object({
          month: zBudgetMonth,
          assigned: zMinorUnits,
          targets: FutureTargetsSchema,
        }),
      )
      .describe("The later months with money assigned, in order"),
    nextMonthTargets: FutureTargetsSchema.describe(
      "Next month's targets, for the panel's row when nothing is assigned there yet",
    ),
    note: z.string().describe('The month\'s note ("Enter a note…"); empty for none'),
    futureShortfall: z
      .object({ month: zBudgetMonth, readyToAssign: zMinorUnits })
      .nullable()
      .describe("The first later month whose Ready to Assign is negative, if any"),
    categories: z
      .array(MonthCategorySchema)
      .describe("Every category of the category list, hidden ones included"),
    groups: z
      .array(MonthGroupSchema)
      .describe("Each group's totals over its categories that aren't hidden"),
    hidden: Totals.describe("Totals of hidden categories and of every category in hidden groups"),
    uncategorized: z
      .object({ ...Activity, available: zMinorUnits, ...Overspent })
      .nullable()
      .describe("Spending without a category; null in months without any"),
    targets: z
      .object({
        month: zMinorUnits.describe(
          "What the targets of the categories that aren't hidden ask of this month (" +
            "\"October's Targets\"): each month's amount, or this month's share of a dated target",
        ),
        nextMonth: zMinorUnits.describe("The same for the month after"),
        expectedIncome: zMinorUnits
          .nullable()
          .describe(
            'The budget\'s expected monthly income ("Expected Income" under Cost to Be ' +
              "Me), the same in every month; null until entered",
          ),
      })
      .openapi("MonthTargets"),
  })
  .openapi("BudgetMonth");

export const getBudgetMonth = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/months/{month}",
  operationId: "getBudgetMonth",
  tags: ["Budget months"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Assigned, activity and available for each category in a month",
  description:
    "Activity counts transactions (split lines one by one) dated in the month, up to the user's " +
    "today. Available rolls over from month to month; a negative balance doesn't, the category " +
    "starts the next month at zero.",
  request: {
    params: BudgetParams,
    query: z.object({ today: Today.optional() }),
  },
  responses: {
    200: {
      description: "The month's numbers",
      content: { "application/json": { schema: MonthSchema } },
    },
    400: jsonError("Invalid month or date"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const setMonthNote = createRoute({
  method: "put",
  path: "/budgets/{budgetId}/months/{month}/note",
  operationId: "setMonthNote",
  tags: ["Budget months"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Set the month's note",
  description:
    "The note under the month name: one per month, not carried to other months. An empty note " +
    "removes it.",
  request: {
    params: BudgetParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ note: z.string().max(10_000) }).openapi("SetMonthNote"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The month's note",
      content: {
        "application/json": {
          schema: z.object({ month: zBudgetMonth, note: z.string() }).openapi("MonthNote"),
        },
      },
    },
    400: jsonError("Invalid month or note"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change the plan, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const assignCategory = createRoute({
  method: "put",
  path: "/budgets/{budgetId}/months/{month}/categories/{categoryId}",
  operationId: "assignCategory",
  tags: ["Budget months"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Set the money assigned to a category in a month",
  description:
    "Replaces the category's Assigned amount for the month. The month must be one the budget " +
    "shows; assigning in the newest month opens the one after it.",
  request: {
    params: BudgetParams.extend({
      categoryId: z.string().openapi({ param: { name: "categoryId", in: "path" } }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              assigned: zMinorUnits.describe("The new Assigned amount; negative takes money out"),
              today: Today.optional(),
              expectedAssigned: zMinorUnits
                .optional()
                .describe(
                  "Refuse (409 STALE_VERSION) unless Assigned is still this: undo and redo " +
                    "send it so a partner's later change isn't overwritten",
                ),
            })
            .openapi("AssignCategory"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The month's numbers after the change",
      content: { "application/json": { schema: MonthSchema } },
    },
    400: jsonError("Invalid amount, or MONTH_OUT_OF_RANGE"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't assign money, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget or category, or the caller isn't a member"),
    409: jsonError("Assigned changed since `expectedAssigned` (STALE_VERSION)"),
  },
});

export const moveMoney = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/months/{month}/moves",
  operationId: "moveMoney",
  tags: ["Budget months"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Move assigned money between categories, or to and from Ready to Assign",
  description:
    "Takes `amount` off the first category's Assigned and adds it to the second's in `month`. " +
    "Ready to Assign's internal category stands for Ready to Assign itself (its id is " +
    "`readyToAssignCategoryId` in the category list). Covering overspending and un-assigning " +
    "money are moves too.",
  request: {
    params: BudgetParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              fromCategoryId: z.string(),
              toCategoryId: z.string(),
              amount: zMinorUnits.describe("Positive"),
              fromMonth: zBudgetMonth
                .optional()
                .describe(
                  "Take the money from the first category's Assigned in this month instead " +
                    "(covering overspending from a later month); defaults to `month`",
                ),
              today: Today.optional(),
            })
            .openapi("MoveMoney"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The month's numbers after the move",
      content: { "application/json": { schema: MonthSchema } },
    },
    400: jsonError("Invalid amount or categories, or MONTH_OUT_OF_RANGE"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't assign money, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget or category, or the caller isn't a member"),
  },
});

const ActivityRowSchema = z
  .object({
    id: z.string().describe("The transaction's id, or the split line's"),
    transactionId: z.string().describe("The transaction (the split, for a split line)"),
    accountId: z.string(),
    accountName: z.string(),
    date: z.iso.date(),
    payeeName: z.string().nullable(),
    categoryId: z.string().nullable(),
    categoryName: z
      .string()
      .nullable()
      .describe(
        '"Group: Category" (internal categories by their own name); a card\'s transfers show its payment category',
      ),
    memo: z.string(),
    amount: zMinorUnits.describe("In the budget's currency (the month's); negative is an outflow"),
    nativeAmount: zMinorUnits.describe("In the account's currency, `currency`"),
    currency: zCurrencyCode.describe("The account's currency"),
  })
  .openapi("ActivityTransaction");

export const listMonthActivity = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/months/{month}/activity",
  operationId: "listMonthActivity",
  tags: ["Budget months"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "The transactions behind a category's, a group's or Uncategorized's Activity",
  description:
    "Pass exactly one of `categoryId`, `groupId` (its categories that aren't hidden, as its " +
    "totals) or `uncategorized=true`. Lists the transactions dated in the month up to the " +
    "user's today, a split's lines one by one, newest first. A payment category lists its " +
    "card's transactions (all but the starting balance).",
  request: {
    params: BudgetParams,
    query: z.object({
      categoryId: z.string().optional(),
      groupId: z.string().optional(),
      uncategorized: z.stringbool().optional(),
      today: Today.optional(),
    }),
  },
  responses: {
    200: {
      description: "The month's transactions for it",
      content: {
        "application/json": {
          schema: z.object({ transactions: z.array(ActivityRowSchema) }).openapi("MonthActivity"),
        },
      },
    },
    400: jsonError("Invalid month, or not exactly one of categoryId, groupId, uncategorized"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, category or group, or the caller isn't a member"),
  },
});

export const autoAssign = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/months/{month}/auto-assign",
  operationId: "autoAssign",
  tags: ["Budget months"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Set categories' Assigned from one of the Auto-Assign options",
  description:
    "Sets each category's Assigned to the option's amount (`autoAssign` in the month). Without " +
    "`categoryIds` it covers every category that isn't hidden. Each change is a move in Recent " +
    "Moves. Underfunded funds selected categories in full; over the whole plan or a view " +
    "(`scope: view`) it funds `underfundedParts` in order and stops when Ready to Assign runs out.",
  request: {
    params: BudgetParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              option: z.enum(AUTO_ASSIGN_OPTIONS),
              categoryIds: z.array(z.string()).min(1).optional(),
              scope: z
                .enum(["selection", "view"])
                .optional()
                .describe(
                  "Whether `categoryIds` are the user's selection (the default) or the rows of a " +
                    "view; Underfunded stops at Ready to Assign only for a view or the whole plan",
                ),
              today: Today.optional(),
            })
            .openapi("AutoAssign"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The month's numbers after the change",
      content: { "application/json": { schema: MonthSchema } },
    },
    400: jsonError("Invalid input, or MONTH_OUT_OF_RANGE"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't assign money, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget or category, or the caller isn't a member"),
  },
});

const MoneyMoveSchema = z
  .object({
    id: z.string(),
    kind: z
      .enum(["assigned", "moved", "removed"])
      .describe(
        "assigned: from Ready to Assign; removed: back to it; moved: between categories (and, " +
          "for a deletion, from Ready to Assign to the deleted category)",
      ),
    fromCategoryId: z
      .string()
      .nullable()
      .describe("Null for Ready to Assign and for a deleted category"),
    toCategoryId: z
      .string()
      .nullable()
      .describe("Null for Ready to Assign and for a deleted category"),
    fromDeletedCategory: z
      .string()
      .nullable()
      .describe("The name of the deleted category the money came from; null otherwise"),
    toDeletedCategory: z
      .string()
      .nullable()
      .describe("The name of the deleted category the money went to; null otherwise"),
    deletion: z
      .boolean()
      .describe("Logged by deleting a category: its assigned money going to the category picked"),
    month: zBudgetMonth,
    amount: zMinorUnits.describe("Positive"),
    movedAt: z.iso.datetime(),
    autoAssign: z
      .object({
        batchId: z.string().describe("Shared by every move of one Auto-Assign"),
        method: z.enum(AUTO_ASSIGN_OPTIONS).describe("The Auto-Assign option used"),
      })
      .nullable()
      .describe("Set on the moves of an Auto-Assign, listed together as one entry; null otherwise"),
    userId: z.string().nullable().describe("Who moved it; null if their user was deleted"),
    userName: z.string().nullable().describe("Who moved it; null if their user was deleted"),
    memberRole: z
      .enum(BUDGET_ROLES)
      .nullable()
      .describe("The mover's role on the budget now; null once they've left it"),
    avatarColor: zAvatarColor
      .nullable()
      .describe(
        "The mover's avatar colour (1–6: the owner is 1, the others 2–6 by when they joined); null once they've left the budget",
      ),
    picture: zPicture.describe("The mover's profile picture URL; null without one"),
  })
  .openapi("MoneyMove");

const MoneyMoveList = z.object({ moves: z.array(MoneyMoveSchema) }).openapi("MoneyMoveList");

export const listMoves = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/moves",
  operationId: "listMoves",
  tags: ["Budget months"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Recent changes to assigned money, newest first",
  description:
    'Every change of the last 34 days, as Recent Moves ("Previous 34 days of assigning ' +
    'and moving money").',
  request: {
    params: z.object({
      budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description: "The last 34 days' moves",
      content: {
        "application/json": {
          schema: MoneyMoveList,
        },
      },
    },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const listMonthMoves = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/months/{month}/moves",
  operationId: "listMonthMoves",
  tags: ["Budget months"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Every change to assigned money in a month, newest first",
  description:
    'Behind the per-category history ("Changes to your assigned amount this month"): all of ' +
    "the month's moves, however old.",
  request: { params: BudgetParams },
  responses: {
    200: {
      description: "The month's moves",
      content: { "application/json": { schema: MoneyMoveList } },
    },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const setExpectedIncome = createRoute({
  method: "put",
  path: "/budgets/{budgetId}/expected-income",
  operationId: "setExpectedIncome",
  tags: ["Budget months"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Set the budget's expected monthly income",
  description:
    '"Enter your expected income" under Cost to Be Me: entered once, it stays from ' +
    "month to month. It must be positive; it can be changed but not cleared.",
  request: {
    params: z.object({
      budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              amount: zMinorUnits.refine((v) => BigInt(v) > 0n, "The amount must be positive"),
            })
            .openapi("SetExpectedIncome"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Saved",
      content: {
        "application/json": {
          schema: z.object({ expectedIncome: zMinorUnits }).openapi("ExpectedIncome"),
        },
      },
    },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't assign money in this budget, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});
