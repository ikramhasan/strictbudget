import { createRoute, z } from "@hono/zod-openapi";
import { FLAG_COLORS } from "@strictbudget/db/schema";
import { SCHEDULE_FREQUENCIES, zCurrencyCode, zMinorUnits } from "@strictbudget/engine";
import { jsonError } from "../../lib/errors";
import { authSecurity, requireAuth } from "../../middleware/require-auth";
import { TransactionSchema } from "../transactions/routes";

const IsoDate = z.iso.date().describe("Calendar date, YYYY-MM-DD");
const Today = IsoDate.describe(
  "The user's today: occurrences due by then are entered first. Defaults to the server's UTC date.",
);
const Frequency = z
  .enum(SCHEDULE_FREQUENCIES)
  .describe(
    'The "Repeat:" options; `never` is a one-off. Month-based repeats fall on the first ' +
      "date's day (or a shorter month's last day) and count from `dateFirst`; yearly ones step " +
      "from the previous date; twice a month pairs the day with the day 15 later.",
  );
const Flag = z.enum(FLAG_COLORS).nullable().describe("One of the six flag colors, or null");
const PayeeName = z.string().trim().min(1).max(200);
const Memo = z.string().max(500);

const ScheduledLineSchema = z
  .object({
    id: z.string(),
    amount: zMinorUnits.describe("Negative is an outflow"),
    payeeId: z.string().nullable(),
    payeeName: z.string().nullable(),
    categoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    memo: z.string(),
    transferAccountId: z.string().nullable().describe("Transfer lines: the other account"),
  })
  .openapi("ScheduledSubTransaction");

export const ScheduledTransactionSchema = z
  .object({
    id: z
      .string()
      .describe(
        "The row's id: the schedule's own, or for the other side of a transfer a derived one",
      ),
    scheduledTransactionId: z.string().describe("The schedule this row shows"),
    kind: z
      .enum(["schedule", "transfer", "splitTransfer"])
      .describe(
        "`schedule`: the schedule in its own account. `transfer`: a scheduled transfer as the " +
          "other account shows it (amount negated). `splitTransfer`: a scheduled split's transfer " +
          "line in that line's account; it's edited and deleted through the split",
      ),
    accountId: z.string(),
    accountName: z.string(),
    frequency: z.enum(SCHEDULE_FREQUENCIES),
    dateFirst: IsoDate.describe("Where the repeats are counted from"),
    dateNext: IsoDate.describe("The next occurrence (the date the register shows)"),
    amount: zMinorUnits.describe("Negative is an outflow, in this row's account"),
    currency: zCurrencyCode,
    payeeId: z.string().nullable(),
    payeeName: z.string().nullable(),
    categoryId: z
      .string()
      .nullable()
      .describe(
        "Null on splits. A transfer's one category belongs to its budget side: the `schedule` " +
          "row carries it even when that's the other account; a `transfer` row only on that side",
      ),
    categoryName: z.string().nullable(),
    memo: z.string(),
    flag: Flag,
    transferAccountId: z.string().nullable().describe("Transfers: the other account"),
    subtransactions: z
      .array(ScheduledLineSchema)
      .describe("A split's lines, in order (only on the `schedule` row)"),
  })
  .openapi("ScheduledTransaction");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});
const ScheduleParams = BudgetParams.extend({
  scheduledTransactionId: z
    .string()
    .openapi({ param: { name: "scheduledTransactionId", in: "path" } }),
});

function json<T extends z.ZodType>(schema: T) {
  return { required: true, content: { "application/json": { schema } } } as const;
}
function ok<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}
const notFound = jsonError("No such budget, account or scheduled transaction, or not a member");
const forbidden = jsonError(
  "The caller's role can't change transactions, or the account's email address isn't confirmed",
);
const crossCurrency = jsonError(
  "A transfer between accounts in different currencies (`CROSS_CURRENCY_TRANSFER`), or a move " +
    "into an account in another currency (`CROSS_CURRENCY_MOVE`); not supported yet",
);

const ScheduledLineInput = z
  .object({
    amount: zMinorUnits.describe("Negative is an outflow"),
    payeeName: PayeeName.nullable().default(null),
    transferAccountId: z.string().optional().describe("Make this line a transfer"),
    categoryId: z.string().nullable().default(null),
    memo: Memo.default(""),
  })
  .openapi("ScheduledSubTransactionInput");

const rules =
  "Same rules as transactions: on-budget accounts fall back to Uncategorized, tracking " +
  "accounts and transfers between budget accounts take no category, payment categories can't " +
  "be used, and a split's lines (two or more) add up to its amount. A transfer's one category " +
  "is its budget side's, even when that's the other account. A `date` on or before `today` is " +
  "entered right away (unapproved), and the schedule starts at its first date after today, " +
  "not before.";

const EnteredSchema = z
  .object({
    scheduledTransaction: ScheduledTransactionSchema.nullable().describe(
      "The schedule's row in its account; null when a past-dated one-off was entered and is done",
    ),
    enteredTransactionId: z
      .string()
      .nullable()
      .describe("The transaction entered because the date was on or before `today`"),
  })
  .openapi("ScheduledTransactionWrite");

export const listScheduledTransactions = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/scheduled-transactions",
  operationId: "listScheduledTransactions",
  tags: ["Scheduled transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "The register's Scheduled Transactions section, newest first",
  description:
    "One row per schedule (its next occurrence), plus the other account's view of scheduled " +
    "transfers and of scheduled splits' transfer lines. Due occurrences are entered first. The " +
    "search and dates work as in `listTransactions` (scheduled rows count as uncleared).",
  request: {
    params: BudgetParams,
    query: z.object({
      accountId: z.string().optional().describe("Leave out for all accounts"),
      q: z.string().max(500).optional().describe("The register's search (see `listTransactions`)"),
      from: IsoDate.optional().describe("Next occurrence on or after this date"),
      to: IsoDate.optional().describe("Next occurrence on or before this date"),
      today: Today.optional(),
    }),
  },
  responses: {
    200: ok(
      "Scheduled transactions",
      z
        .object({ scheduledTransactions: z.array(ScheduledTransactionSchema) })
        .openapi("ScheduledTransactionList"),
    ),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

const TransferAccountId = z
  .string()
  .describe("Make it a transfer to or from that account; leave `payeeName` out");

export const createScheduledTransaction = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/scheduled-transactions",
  operationId: "createScheduledTransaction",
  tags: ["Scheduled transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Schedule a transaction (a future one-off or a repeating one)",
  description:
    `${rules} \`fromTransactionId\` replaces that transaction (and its transfer's other side) ` +
    "with the schedule, as when a transaction's date is moved into the future.",
  request: {
    params: BudgetParams,
    body: json(
      z
        .strictObject({
          accountId: z.string(),
          frequency: Frequency.default("never"),
          date: IsoDate.describe("The first occurrence"),
          dateFirst: IsoDate.optional().describe(
            "Count repeats from this earlier date instead (restoring a schedule, as an undo does)",
          ),
          amount: zMinorUnits.describe("Negative is an outflow"),
          payeeName: PayeeName.nullable().default(null),
          transferAccountId: TransferAccountId.optional(),
          categoryId: z.string().nullable().default(null),
          memo: Memo.default(""),
          flag: Flag.default(null),
          subtransactions: z.array(ScheduledLineInput).min(2).optional(),
          fromTransactionId: z.string().optional(),
          today: Today.optional(),
          restore: z
            .boolean()
            .optional()
            .describe(
              "An undo putting a schedule back as it was: its accounts may have been closed " +
                "since, which Undo allows",
            ),
        })
        .openapi("CreateScheduledTransaction"),
    ),
  },
  responses: {
    201: ok("Scheduled", EnteredSchema),
    400: jsonError(
      "Invalid input, a closed account, a category the account can't use, or a transfer to the " +
        "same account",
    ),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    409: jsonError("`fromTransactionId` is a split's transfer side (`TRANSFER_IN_SPLIT`)"),
    422: crossCurrency,
  },
});

export const updateScheduledTransaction = createRoute({
  method: "patch",
  path: "/budgets/{budgetId}/scheduled-transactions/{scheduledTransactionId}",
  operationId: "updateScheduledTransaction",
  tags: ["Scheduled transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Edit a scheduled transaction (it and all of its future occurrences)",
  description:
    `${rules} A new \`date\` restarts the repeats there (the first date is reset); a new ` +
    "`frequency` counts from the date shown. Setting `payeeName` turns a transfer into a normal " +
    "one, `subtransactions` replace a split's lines and a `categoryId` un-splits it.",
  request: {
    params: ScheduleParams,
    body: json(
      z
        .strictObject({
          accountId: z.string().optional(),
          frequency: Frequency.optional(),
          date: IsoDate.optional(),
          dateFirst: IsoDate.optional(),
          amount: zMinorUnits.optional(),
          payeeName: PayeeName.nullable().optional(),
          transferAccountId: TransferAccountId.optional(),
          categoryId: z.string().nullable().optional(),
          memo: Memo.optional(),
          flag: Flag.optional(),
          subtransactions: z.array(ScheduledLineInput).min(2).optional(),
          today: Today.optional(),
          restore: z
            .boolean()
            .optional()
            .describe(
              "An undo putting a schedule back as it was: its accounts may have been closed " +
                "since, which Undo allows",
            ),
        })
        .openapi("UpdateScheduledTransaction"),
    ),
  },
  responses: {
    200: ok("Updated", EnteredSchema),
    400: jsonError(
      "Invalid input, a closed account, a category the account can't use, or a transfer to the " +
        "same account",
    ),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    422: crossCurrency,
  },
});

export const deleteScheduledTransaction = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}/scheduled-transactions/{scheduledTransactionId}",
  operationId: "deleteScheduledTransaction",
  tags: ["Scheduled transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Delete a scheduled transaction and all of its future occurrences",
  request: { params: ScheduleParams },
  responses: {
    204: { description: "Deleted" },
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
  },
});

export const enterScheduledTransaction = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/scheduled-transactions/{scheduledTransactionId}/enter",
  operationId: "enterScheduledTransaction",
  tags: ["Scheduled transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Enter Now: the next occurrence, dated today",
  description:
    "Enter Now: the transaction is dated `today` and approved (uncleared, or cleared " +
    "in a cash account), and the schedule moves to its following date; a one-off is done. Works " +
    "in a closed account too.",
  request: {
    params: ScheduleParams,
    body: json(z.object({ today: Today.optional() }).openapi("EnterScheduledTransaction")),
  },
  responses: {
    200: ok(
      "Entered",
      z
        .object({
          transaction: TransactionSchema.describe("The new transaction, in the schedule's account"),
          scheduledTransaction: ScheduledTransactionSchema.nullable().describe(
            "The schedule after moving on; null when it was a one-off",
          ),
        })
        .openapi("EnteredScheduledTransaction"),
    ),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
  },
});

const ScheduledBulkAction = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("enterNow") }),
    z.strictObject({ type: z.literal("duplicate") }),
    z.strictObject({ type: z.literal("flag"), flag: Flag }),
    z.strictObject({ type: z.literal("memo"), memo: Memo.min(1) }),
    z.strictObject({ type: z.literal("categorize"), categoryId: z.string() }),
    z.strictObject({ type: z.literal("move"), accountId: z.string() }),
    z.strictObject({ type: z.literal("delete") }),
  ])
  .openapi("ScheduledBulkAction");

export const bulkUpdateScheduledTransactions = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/scheduled-transactions/bulk",
  operationId: "bulkUpdateScheduledTransactions",
  tags: ["Scheduled transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Apply one action to every selected scheduled row it applies to",
  description:
    "The register's action bar on scheduled rows (by row `id`; a transfer's other side acts on " +
    "its schedule, once). `enterNow` enters each as Enter Now does (a split's transfer line " +
    "enters its split). `duplicate` copies each schedule, starting at its next date. `flag`, " +
    "`memo`, `categorize`, `move` and `delete` work as on transactions. A scheduled split's " +
    "transfer line in the other account is skipped by everything but `enterNow`. " +
    "One database transaction.",
  request: {
    params: BudgetParams,
    body: json(
      z
        .object({
          ids: z.array(z.string()).min(1).max(1000),
          action: ScheduledBulkAction,
          today: Today.optional(),
        })
        .openapi("ScheduledBulkUpdate"),
    ),
  },
  responses: {
    200: ok(
      "Updated",
      z
        .object({
          updated: z.number().int().describe("Schedules the action applied to"),
          before: z
            .array(ScheduledTransactionSchema)
            .describe("Those schedules before, as their own account shows them (for undo)"),
          entered: z.array(z.string()).describe("`enterNow`: the new transactions' ids"),
          created: z.array(z.string()).describe("`duplicate`: the new schedules' ids"),
        })
        .openapi("ScheduledBulkResult"),
    ),
    400: jsonError("Invalid input, a category schedules can't use, or a closed account"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
  },
});
