import { createRoute, z } from "@hono/zod-openapi";
import {
  LOAN_CHARGE_KINDS,
  LOAN_LINE_KINDS,
  zAccountType,
  zBudgetMonth,
  zCurrencyCode,
  zMinorUnits,
} from "@strictbudget/engine";
import { IsoDate, TodayQuery } from "../../lib/dates";
import { jsonError } from "../../lib/errors";
import { zFxRate } from "../../lib/fx/rate-schema";
import { authSecurity, requireAuth } from "../../middleware/require-auth";

const Name = z.string().trim().min(1).max(100);
const InterestRate = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,3})?$/, "Expected a percentage like 6.125")
  .describe("Annual interest rate in percent (loan accounts)");

const BalancesSchema = z
  .object({ cleared: zMinorUnits, uncleared: zMinorUnits, working: zMinorUnits })
  .openapi("AccountBalances", {
    description:
      "Future-dated transactions don't count until their date: responses take the user's " +
      "`today` (or a request's `date` that is the user's today), else the server's UTC date.",
  });

export const AccountSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    logo: z
      .string()
      .nullable()
      .describe("Its logo's URL (an API path), shown before its name; null without one"),
    type: zAccountType,
    note: z.string(),
    closed: z.boolean(),
    starredOrder: z
      .number()
      .int()
      .nullable()
      .describe(
        "Position in the sidebar's Starred group (ascending); null when not starred. Shared " +
          "by everyone on the budget. Closing an account unstars it.",
      ),
    currency: zCurrencyCode,
    interestRate: z.string().nullable(),
    minimumPayment: zMinorUnits.nullable(),
    escrowAmount: zMinorUnits.nullable(),
    paymentCategoryId: z.string().nullable().describe("Credit accounts: their payment category"),
    hasHistory: z
      .boolean()
      .describe("Has transactions besides its starting balance (so it can be closed, not deleted)"),
    balances: BalancesSchema,
    lastReconciledAt: z.iso
      .datetime()
      .nullable()
      .describe("When the account was last reconciled; null if never"),
    pairedCategoryId: z
      .string()
      .nullable()
      .describe("Loan accounts: the plan category paired with it (its payments' category)"),
    lastPaymentDate: IsoDate.nullable().describe(
      "Loan accounts: the date of the latest payment up to today",
    ),
    lastPaymentFromAccountId: z
      .string()
      .nullable()
      .describe(
        "Record Payment's source: for a loan, the cash or credit account of the payment into " +
          "it entered last; for a credit card, the cash account it was last paid from",
      ),
    migratedToAccountId: z
      .string()
      .nullable()
      .describe("A tracking liability updated to a loan account: the new loan"),
    migratedFromAccountId: z
      .string()
      .nullable()
      .describe("A loan made by updating a tracking liability: the original (closed) account"),
    toReview: z
      .number()
      .int()
      .describe(
        "Transactions that are unapproved or need a category (the review banner's count and the " +
          "dot by the account in the sidebar)",
      ),
    unrealizedGain: zMinorUnits
      .nullable()
      .describe(
        "Accounts in another currency than the budget's: unrealized FX gain (positive) or loss, " +
          "in the budget's minor units: the working balance at today's known rate (`rate`, " +
          "converted half-even) less what its transactions were booked at in the budget's " +
          "currency. Null in the budget's currency, or when no rate is known yet (no provider " +
          "is asked for it).",
      ),
    rate: zFxRate
      .nullable()
      .describe("The rate `unrealizedGain` uses: 1 `currency` = rate budget currency"),
    rateDate: IsoDate.nullable().describe(
      "The date `rate` is from (an earlier one when today's isn't known)",
    ),
  })
  .openapi("Account");

const PairedCategoryId = z
  .string()
  .describe(
    "Pair this plan category with the loan (one loan per category: pairing a category moves it " +
      "from any other loan). Not an internal or credit card payment category.",
  );

const ConvertedBalancesSchema = z
  .object({
    currency: zCurrencyCode,
    cleared: zMinorUnits,
    uncleared: zMinorUnits,
    working: zMinorUnits,
  })
  .openapi("ConvertedBalances", {
    description:
      "An account's balances in the display currency at today's known rate (converted " +
      "half-even): today's value, not what the plan booked",
  });

const AccountTotalSchema = z
  .object({
    currency: zCurrencyCode.describe("The display currency"),
    amount: zMinorUnits.describe("Sum of the converted working balances"),
    converted: z
      .boolean()
      .describe("Some account in it is in another currency and was converted at today's rate"),
    missing: z
      .array(z.string())
      .describe("Accounts left out: no rate to the display currency is known yet"),
  })
  .openapi("AccountTotal");

const AccountListSchema = z
  .object({
    accounts: z
      .array(
        AccountSchema.extend({
          converted: ConvertedBalancesSchema.nullable().describe(
            "Its balances in the display currency; null when no rate is known yet",
          ),
        }).openapi("ListedAccount"),
      )
      .describe("In sidebar order, closed ones included"),
    totals: z
      .object({
        starred: AccountTotalSchema,
        budget: AccountTotalSchema.describe("Open cash and credit accounts"),
        loans: AccountTotalSchema,
        tracking: AccountTotalSchema,
        closed: AccountTotalSchema,
        netWorth: AccountTotalSchema.describe("Every open account"),
      })
      .describe(
        "The sidebar's group totals and net worth in the display currency (the caller's " +
          "preference, else the budget's), at today's known rates; no provider is asked",
      ),
    missingRates: z
      .number()
      .int()
      .describe("How many accounts have no known rate to the display currency (left out)"),
  })
  .openapi("AccountList");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});
const AccountParams = BudgetParams.extend({
  accountId: z.string().openapi({ param: { name: "accountId", in: "path" } }),
});

function json<T extends z.ZodType>(schema: T) {
  return { required: true, content: { "application/json": { schema } } } as const;
}
function ok<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}
const notFound = jsonError("No such budget or account, or the caller isn't a member");

export const listAccounts = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/accounts",
  operationId: "listAccounts",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "The budget's accounts with their balances",
  request: {
    params: BudgetParams,
    query: TodayQuery.extend({
      displayCurrency: zCurrencyCode
        .optional()
        .describe(
          "Totals and converted balances in this currency for this request, instead of the " +
            "caller's display currency preference",
        ),
    }),
  },
  responses: {
    200: ok("Accounts in sidebar order", AccountListSchema),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const createAccount = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/accounts",
  operationId: "createAccount",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Add an account with its starting balance",
  description:
    "Creates a Starting Balance transaction dated `date`. Credit accounts also get a payment " +
    "category. Debt balances are negative.",
  request: {
    params: BudgetParams,
    body: json(
      z
        .object({
          name: Name,
          type: zAccountType,
          currency: zCurrencyCode
            .optional()
            .describe(
              "Defaults to the budget's currency. Loans stay in the budget's currency; any other " +
                "type can be in another one (its activity is converted into the budget's). Amounts " +
                "are in this currency's minor units.",
            ),
          balance: zMinorUnits.describe("Today's balance; negative for money owed"),
          date: IsoDate.describe("Date of the starting balance (the user's today)"),
          interestRate: InterestRate.optional(),
          minimumPayment: zMinorUnits.optional(),
          escrowAmount: zMinorUnits.optional(),
          pairedCategoryId: PairedCategoryId.optional(),
        })
        .openapi("CreateAccount"),
    ),
  },
  responses: {
    201: ok("Created", AccountSchema),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't manage accounts, or the account's email address isn't confirmed",
    ),
    404: notFound,
    422: jsonError(
      "LOAN_CURRENCY: a loan in another currency than the budget's; FX_RATE_UNAVAILABLE: no " +
        "rate to convert a foreign-currency starting balance",
    ),
  },
});

export const updateAccount = createRoute({
  method: "patch",
  path: "/budgets/{budgetId}/accounts/{accountId}",
  operationId: "updateAccount",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Rename an account, edit its note, type or loan details, or set its working balance",
  description:
    "A `workingBalance` different from the account's adds a Manual Balance Adjustment for the " +
    "difference, dated `date` and cleared (budget accounts take it " +
    "from Ready to Assign). Not for closed accounts. A loan's interest rate, minimum payment and " +
    "escrow apply from `date`'s month on.",
  request: {
    params: AccountParams,
    query: TodayQuery,
    body: json(
      z
        .strictObject({
          name: Name.optional(),
          note: z.string().max(10_000).optional(),
          type: zAccountType
            .optional()
            .describe("Only within the same family (cash, credit, loan, tracking)"),
          interestRate: InterestRate.nullable().optional(),
          minimumPayment: zMinorUnits.nullable().optional(),
          escrowAmount: zMinorUnits.nullable().optional(),
          pairedCategoryId: PairedCategoryId.nullable().optional().describe("Null unpairs"),
          starred: z
            .boolean()
            .optional()
            .describe(
              "Star or unstar the account. Only open cash and credit accounts can be starred; " +
                "a new star goes to the end of the Starred group.",
            ),
          workingBalance: zMinorUnits
            .optional()
            .describe("The balance the account should have; negative for money owed"),
          date: IsoDate.optional().describe(
            "The user's today: the adjustment's date, the day the working balance is read at, " +
              "and the month new loan terms start in. Defaults to `today`, then the server's UTC date.",
          ),
        })
        .openapi("UpdateAccount"),
    ),
  },
  responses: {
    200: ok("Updated", AccountSchema),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't manage accounts, or the account's email address isn't confirmed",
    ),
    404: notFound,
  },
});

const LoanTermsCheck = z
  .object({
    interestRate: z
      .object({
        rate: InterestRate.nullable(),
        keepGoingForward: z
          .boolean()
          .describe('Unchecked, next month goes back to the old rate ("… for October.")'),
      })
      .optional(),
    escrowAmount: z
      .object({
        amount: zMinorUnits.nullable(),
        keepGoingForward: z.boolean().describe("Unchecked, next month goes back to the old escrow"),
      })
      .optional()
      .describe("Mortgages only"),
  })
  .openapi("LoanTermsCheck", {
    description: "Update Balance's check step: the loan's interest rate and monthly escrow",
  });

const ReconcileAccountBody = z
  .object({
    balance: zMinorUnits.describe(
      "The bank's current cleared balance (a loan's: what's owed), signed like the account's " +
        "(negative for money owed)",
    ),
    date: IsoDate.describe("The user's today"),
    loanTerms: LoanTermsCheck.optional().describe("Loans only"),
  })
  .openapi("ReconcileAccount");

export const previewReconcileAccount = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/accounts/{accountId}/reconcile/preview",
  operationId: "previewReconcileAccount",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Work out a reconcile's balance adjustment without saving",
  description:
    "The Reconciliation Balance Adjustment `reconcileAccount` would add for the same body (zero " +
    "for none): Update Balance's Changes step after its interest rate / escrow check.",
  request: {
    params: AccountParams,
    body: json(ReconcileAccountBody),
  },
  responses: {
    200: ok(
      "The adjustment",
      z
        .object({
          adjustment: zMinorUnits.describe("Signed like the account; zero when it matches"),
        })
        .openapi("ReconcilePreview"),
    ),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    404: notFound,
  },
});

export const reconcileAccount = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/accounts/{accountId}/reconcile",
  operationId: "reconcileAccount",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Reconcile an account against the bank's balance",
  description:
    "Locks every cleared transaction dated up to `date` (they become reconciled, for good) and " +
    "records when. If `balance` differs from the cleared balance, a Reconciliation Balance " +
    "Adjustment for the difference comes first, dated `date` (budget accounts take it from " +
    "Ready to Assign; tracking accounts have no category). A loan (Update Balance) is " +
    "compared with its working balance, every transaction up to `date` is reconciled, and each " +
    "month's interest and escrow are fixed at what's applied. A loan's `loanTerms` (Update " +
    "Balance's interest rate / escrow check) change its terms from `date`'s month first; the " +
    "adjustment then makes up the difference to the balance with this month re-estimated on the " +
    "new terms, while the months are fixed at what they had.",
  request: {
    params: AccountParams,
    body: json(ReconcileAccountBody),
  },
  responses: {
    200: ok("Reconciled", AccountSchema),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change transactions, or the account's email address isn't confirmed",
    ),
    404: notFound,
  },
});

export const moveAccount = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/accounts/{accountId}/move",
  operationId: "moveAccount",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Move an account before another one, or to the end",
  request: {
    params: AccountParams,
    query: TodayQuery,
    body: json(
      z
        .object({
          beforeAccountId: z
            .string()
            .nullable()
            .describe("Place it right before this account; null moves it to the end"),
          starred: z
            .boolean()
            .optional()
            .describe("Reorder within the Starred group instead (both accounts must be starred)"),
        })
        .openapi("MoveAccount"),
    ),
  },
  responses: {
    200: ok("Accounts in their new order", AccountListSchema),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't manage accounts, or the account's email address isn't confirmed",
    ),
    404: notFound,
  },
});

export const closeAccount = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/accounts/{accountId}/close",
  operationId: "closeAccount",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Close an account",
  description:
    "A non-zero balance is zeroed with a Manual Balance Adjustment dated `date` (for budget " +
    "accounts it comes out of Ready to Assign). A credit account's payment category is hidden.",
  request: {
    params: AccountParams,
    body: json(z.object({ date: IsoDate }).openapi("CloseAccount")),
  },
  responses: {
    200: ok("Closed", AccountSchema),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't manage accounts, or the account's email address isn't confirmed",
    ),
    404: notFound,
  },
});

export const revalueAccount = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/accounts/{accountId}/revalue",
  operationId: "revalueAccount",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Book a foreign-currency account's unrealized FX gain or loss",
  description:
    "Brings what an account in another currency is booked at in the budget's currency up to " +
    "date: its working balance at `date`'s rate (converted half-even) less the sum of its base " +
    "amounts. The difference is posted as a cleared FX Revaluation dated `date`, with a native " +
    "amount of zero and that base amount, into Ready to Assign for a budget account (none for " +
    "a tracking account). Nothing is posted when there's no difference (a second revaluation " +
    "on the same date and rate), and `transaction` is null. A revaluation's amount, date, " +
    "account and payee can't be edited later (`REVALUATION_LOCKED`); it can be deleted.",
  request: {
    params: AccountParams,
    body: json(
      z
        .object({
          date: IsoDate.describe("The revaluation's date; its rate is the one used"),
          today: IsoDate.describe("The user's today (`date` can't be after it)"),
        })
        .openapi("RevalueAccount"),
    ),
  },
  responses: {
    200: ok(
      "The revaluation (null when there was nothing to post) and the account after it",
      z
        .object({
          transaction: z
            .object({
              id: z.string(),
              date: IsoDate,
              baseAmount: zMinorUnits.describe(
                "The gain (positive) or loss booked, in the budget's minor units; its native " +
                  "amount is zero",
              ),
              fxRate: zFxRate.describe("The rate it was worked out at"),
            })
            .nullable()
            .describe("The FX Revaluation posted; null when there was no difference"),
          account: AccountSchema,
        })
        .openapi("RevalueAccountResult"),
    ),
    400: jsonError(
      "The account is in the budget's currency (NOT_FOREIGN_CURRENCY), is closed " +
        "(ACCOUNT_CLOSED), or `date` is after today (DATE_IN_FUTURE)",
    ),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't add transactions, or the account's email address isn't confirmed",
    ),
    404: notFound,
    422: jsonError("FX_RATE_UNAVAILABLE: no rate for `date`"),
  },
});

export const reopenAccount = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/accounts/{accountId}/reopen",
  operationId: "reopenAccount",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Reopen a closed account (and show its payment category again)",
  description:
    "Reopening a tracking account that was updated to a loan account erases the link: the " +
    "loan no longer shows its history, and the account can be updated to a loan " +
    "again.",
  request: { params: AccountParams, query: TodayQuery },
  responses: {
    200: ok("Reopened", AccountSchema),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't manage accounts, or the account's email address isn't confirmed",
    ),
    404: notFound,
  },
});

export const deleteAccount = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}/accounts/{accountId}",
  operationId: "deleteAccount",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Delete an account that has no history beyond its starting balance",
  request: { params: AccountParams },
  responses: {
    204: { description: "Deleted" },
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't manage accounts, or the account's email address isn't confirmed",
    ),
    404: notFound,
    409: jsonError("ACCOUNT_HAS_HISTORY: close the account instead"),
  },
});

export const updateToLoanAccount = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/accounts/{accountId}/update-to-loan",
  operationId: "updateToLoanAccount",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Update a tracking liability to a new loan account",
  description:
    "Adds a loan account with a Starting Balance of `balance` dated `date` (cleared), its terms " +
    "and the paired category. The original account keeps its transactions and is closed: a " +
    'cleared Manual Balance Adjustment (memo "Closed Account") zeroes its working balance, ' +
    '" (Original)" is added to its name, and its scheduled transactions (and those transferring ' +
    "to it) are deleted. Only open tracking liabilities that weren't updated before.",
  request: {
    params: AccountParams,
    body: json(
      z
        .strictObject({
          name: Name.describe("The loan's nickname"),
          type: zAccountType.describe("A loan type (mortgage, auto_loan, …)"),
          balance: zMinorUnits.describe("Today's balance; negative for money owed"),
          date: IsoDate.describe("The user's today"),
          interestRate: InterestRate.optional(),
          minimumPayment: zMinorUnits.optional(),
          escrowAmount: zMinorUnits.optional().describe("Mortgages only"),
          pairedCategoryId: PairedCategoryId,
        })
        .openapi("UpdateToLoanAccount"),
    ),
  },
  responses: {
    201: ok(
      "The new loan and the closed original",
      z
        .object({ loan: AccountSchema, original: AccountSchema })
        .openapi("UpdateToLoanAccountResult"),
    ),
    400: jsonError(
      "Not an open tracking liability, already updated, not a loan type, or invalid input",
    ),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't manage accounts, or the account's email address isn't confirmed",
    ),
    404: notFound,
    422: jsonError("LOAN_CURRENCY: the liability is in another currency than the budget's"),
  },
});

const LoanChargeSchema = z
  .object({
    total: zMinorUnits.describe("The month's full charge: the estimate, or what was set"),
    applied: zMinorUnits.describe("The part the month's payments covered (all of a set amount)"),
    status: z.enum(["estimated", "edited", "reconciled"]),
    editedAt: z.iso.datetime().nullable().describe("When it was set (edited or reconciled)"),
  })
  .openapi("LoanCharge");

const LoanBannersSchema = z
  .object({
    simulatorDismissed: z
      .boolean()
      .describe("The payoff simulator banner was dismissed; one dismissal covers every loan"),
    paidOffDismissed: z
      .boolean()
      .describe('This loan\'s "Another debt bites the dust" banner was dismissed'),
  })
  .describe("Kept as budget settings, so they follow the budget to every device and member")
  .openapi("LoanBanners");

const LoanActivitySchema = z
  .object({
    months: z
      .array(
        z.object({
          month: zBudgetMonth,
          startBalance: zMinorUnits.describe("Balance at the end of the previous month"),
          endBalance: zMinorUnits,
          payments: zMinorUnits.describe("Total of the month's payments"),
          interest: LoanChargeSchema,
          escrow: LoanChargeSchema,
          transactions: z.array(
            z.object({
              id: z.string(),
              date: IsoDate,
              amount: zMinorUnits,
              memo: z.string(),
              kind: z.enum(LOAN_LINE_KINDS),
              payeeKind: z
                .string()
                .nullable()
                .describe("Internal payee kind (e.g. a balance adjustment), if any"),
              fromAccountId: z.string().nullable().describe("Payments: the paying account"),
              otherSideId: z.string().nullable().describe("Payments: the paying side's id"),
            }),
          ),
        }),
      )
      .describe("From the loan's first month through today's, oldest first"),
    upcoming: z
      .array(
        z.object({
          scheduleId: z.string(),
          date: IsoDate.describe("The occurrence's date, after today and in today's month"),
          accountId: z.string().describe("The account the schedule was entered in"),
          accountName: z.string(),
          payeeName: z.string().describe('The schedule\'s own payee ("Transfer : <account>")'),
          memo: z.string(),
          amount: zMinorUnits.describe("What the loan receives (positive)"),
          payingAccountId: z.string().describe("The account the payment comes from"),
          payingRowId: z
            .string()
            .describe("The schedule's row in the paying account's register (to jump to it)"),
        }),
      )
      .describe(
        "This month's scheduled payments still to come, every occurrence of a repeating one, " +
          "newest first; not in the balances",
      ),
    terms: z
      .array(
        z.object({
          month: zBudgetMonth,
          interestRate: z.string().nullable().describe("Annual rate in percent"),
          minimumPayment: zMinorUnits.nullable(),
          escrowAmount: zMinorUnits.nullable(),
        }),
      )
      .describe(
        "The loan's interest rate, minimum payment and escrow from each month on, oldest first " +
          "(months before the first entry use it), for the payoff planner",
      ),
    banners: LoanBannersSchema,
    originalHistory: z
      .object({
        accountId: z.string(),
        months: z
          .array(z.object({ month: zBudgetMonth, endBalance: zMinorUnits }))
          .describe("Each month's ending balance, newest first"),
      })
      .nullable()
      .describe(
        "A loan made by updating a tracking liability: the original account's month-end " +
          "balances",
      ),
  })
  .openapi("LoanActivity");

export const getLoanActivity = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/accounts/{accountId}/loan",
  operationId: "getLoanActivity",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "A loan's month-by-month activity: payments, interest, escrow and balances",
  description:
    "Interest is estimated each month that has payments as the previous month's balance × rate " +
    "÷ 12 (rounded half up); escrow comes first, then interest, both capped by the month's " +
    "payments. Amounts set by hand or fixed by Update Balance apply in full.",
  request: {
    params: AccountParams,
    query: z.object({ today: IsoDate.optional().describe("The user's today") }),
  },
  responses: {
    200: ok("The loan's months", LoanActivitySchema),
    400: jsonError("Not a loan account"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const setLoanCharge = createRoute({
  method: "put",
  path: "/budgets/{budgetId}/accounts/{accountId}/loan/charges",
  operationId: "setLoanCharge",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Set a loan month's total interest or escrow",
  description:
    "Replaces the month's estimate (or earlier amount) and applies in full, payments or not, as " +
    "Edit Interest, Edit Escrow and Add Interest do; zero is Delete Interest. " +
    "Months run from the loan's first through today's.",
  request: {
    params: AccountParams,
    body: json(
      z
        .object({
          month: zBudgetMonth,
          kind: z.enum(LOAN_CHARGE_KINDS),
          amount: zMinorUnits.describe("Minor units added to the debt; not negative"),
          today: IsoDate.describe("The user's today"),
        })
        .openapi("SetLoanCharge"),
    ),
  },
  responses: {
    200: ok("The loan's months", LoanActivitySchema),
    400: jsonError("Not a loan, a negative amount, or a month outside the loan's"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change transactions, or the account's email address isn't confirmed",
    ),
    404: notFound,
  },
});

export const recordLoanPayment = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/accounts/{accountId}/loan/payments",
  operationId: "recordLoanPayment",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Record a loan payment",
  description:
    "A transfer from `fromAccountId` into the loan: the paying side is uncleared and comes out " +
    "of the loan's paired category (Uncategorized when it has none); the loan's side is cleared. " +
    "A date after the user's `today` makes a one-time scheduled transfer instead.",
  request: {
    params: AccountParams,
    query: TodayQuery,
    body: json(
      z
        .object({
          fromAccountId: z.string().describe("A budget (cash or credit) account"),
          amount: zMinorUnits.describe("What's paid; positive"),
          date: IsoDate,
          memo: z.string().max(500).default(""),
        })
        .openapi("RecordLoanPayment"),
    ),
  },
  responses: {
    201: ok("Recorded", AccountSchema),
    400: jsonError("Not a loan, not a budget account to pay from, or not a positive amount"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change transactions, or the account's email address isn't confirmed",
    ),
    404: notFound,
  },
});

export const dismissLoanBanner = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/accounts/{accountId}/loan/banners/dismiss",
  operationId: "dismissLoanBanner",
  tags: ["Accounts"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Dismiss a loan page banner for the whole plan",
  description:
    "`simulator` hides the payoff simulator banner on every loan; `paidOff` hides this loan's " +
    '"Another debt bites the dust". Kept on the budget.',
  request: {
    params: AccountParams,
    body: json(z.object({ banner: z.enum(["simulator", "paidOff"]) }).openapi("DismissLoanBanner")),
  },
  responses: {
    200: ok("The loan's banners", LoanBannersSchema),
    400: jsonError("Not a loan account"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});
