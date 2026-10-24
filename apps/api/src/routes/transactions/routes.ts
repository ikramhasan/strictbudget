import { createRoute, z } from "@hono/zod-openapi";
import { CLEARED_STATES, FLAG_COLORS } from "@strictbudget/db/schema";
import { zCurrencyCode, zMinorUnits } from "@strictbudget/engine";
import { IsoDate } from "../../lib/dates";
import { jsonError } from "../../lib/errors";
import { zFxRate } from "../../lib/fx/rate-schema";
import { zMemberRef } from "../../lib/member-colors";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "../../lib/storage/file-type";
import { authSecurity, requireAuth } from "../../middleware/require-auth";
import { attachmentBodyLimit } from "./attachments";
import { SORT_COLUMNS, SORT_PATTERN } from "./register-query";

const DateLimitQuery = z.object({
  today: IsoDate.optional().describe(
    "The user's today: a later date is refused (`DATE_IN_FUTURE`; future transactions are " +
      "scheduled transactions). Without it, dates after the server's UTC date plus a day are refused.",
  ),
});
const SearchText = z
  .string()
  .max(500)
  .describe(
    "Search: comma-separated terms that must all match, each free text (payee, " +
      "category, memo or account name, or an exact amount) or one of `Payee:`, `Category:` " +
      "(`Category: Split` for splits), `Memo:`, `Account:`, `Flag:` (a color, its name or " +
      "None), `Is:` (Uncleared, Cleared, Reconciled, Unreconciled, Cleared or Reconciled, Approved, Unapproved, Needs Category, Unapproved or Needs Category), " +
      "`Outflow:`/`Inflow:` (`25`, `>=25`, `<=25`), `On:`/`Before:`/`After:` (a date in the " +
      "budget's format, or part of one completed from today: `5` is May 1st in MM/DD/YYYY; " +
      "before and after include the day), `Income:` (a month name, full or " +
      "three letters, with an optional year, e.g. `Income: October 2026`: what's in Ready to " +
      "Assign that month, including Starting Balances of budget accounts; no year means this " +
      "year). Split lines are matched one by one. Amounts are read in each row's own account's " +
      "currency (with all accounts, a row in euros matches `12` as €12.00 and one in yen as ¥12).",
  );
const PayeeName = z.string().trim().min(1).max(200);
const Memo = z.string().max(500);
/** People toggle between these two; reconciling is its own flow. */
const SettableCleared = z.enum(["uncleared", "cleared"]);
/** A new transaction can start reconciled (restoring a deleted one, as an undo does). */
const NewCleared = z.enum(CLEARED_STATES);
const Flag = z.enum(FLAG_COLORS).nullable().describe("One of the six flag colors; null clears it");

const TransferSideSchema = z
  .object({
    id: z.string(),
    version: z
      .number()
      .int()
      .describe("The other side's `version`: an edit of this side can change it (memo, approval)"),
    memo: z.string(),
    cleared: z.enum(CLEARED_STATES),
    flag: Flag,
    approved: z.boolean(),
    categoryId: z.string().nullable(),
    amount: zMinorUnits.describe(
      "Its own amount, in its account's currency: the opposite amount in one currency, its own " +
        "between currencies",
    ),
    currency: zCurrencyCode.describe("The other account's currency"),
  })
  .describe(
    "Transfers: the other side's own state, which `createTransaction` takes back as " +
      "`transferSide` when an undo restores the transfer",
  )
  .openapi("TransferSide");

const SubTransactionSchema = z
  .object({
    id: z.string(),
    amount: zMinorUnits.describe("Negative is an outflow"),
    baseAmount: zMinorUnits.describe(
      "In the budget's currency at the split's rate; the lines' add up to the split's",
    ),
    payeeId: z.string().nullable(),
    payeeName: z.string().nullable(),
    categoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    needsCategory: z
      .boolean()
      .describe(
        'Left Uncategorized ("This needs a category" on the line); the split then ' +
          "counts as needing a category in the review banner and search",
      ),
    memo: z.string(),
    transferAccountId: z.string().nullable().describe("Transfer lines: the other account"),
    transferTransactionId: z
      .string()
      .nullable()
      .describe("Transfer lines: the transaction they keep in the other account"),
    transferReconciled: z.boolean().describe("Transfer lines: the other side is reconciled"),
    transferSide: TransferSideSchema.nullable(),
  })
  .openapi("SubTransaction");

export const AttachmentSchema = z
  .object({
    id: z.string(),
    transactionId: z
      .string()
      .describe("The transaction it was added on: a transfer's two sides share one attachment"),
    fileName: z.string().describe("As uploaded"),
    contentType: z.enum(ATTACHMENT_TYPES).describe("Read from the file's contents"),
    byteSize: z.number().int(),
    createdAt: z.iso.datetime(),
  })
  .openapi("Attachment");

export const TransactionSchema = z
  .object({
    id: z.string(),
    accountId: z.string(),
    accountName: z.string(),
    date: IsoDate,
    amount: zMinorUnits.describe("Negative is an outflow"),
    currency: zCurrencyCode.describe("The account's currency, which `amount` is in"),
    baseAmount: zMinorUnits.describe(
      "The amount in the budget's currency, what the plan counts: `amount` itself in an account " +
        "in the budget's currency, otherwise converted once at `fxRate` and kept",
    ),
    fxRate: zFxRate
      .nullable()
      .describe(
        "1 `currency` = fxRate budget currency; null in an account in the budget's currency",
      ),
    fxRateManual: z
      .boolean()
      .describe(
        "The rate was typed in; otherwise it's the date's rate, looked up again when the date changes",
      ),
    payeeId: z.string().nullable(),
    payeeName: z.string().nullable(),
    categoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    memo: z.string(),
    cleared: z.enum(CLEARED_STATES),
    flag: Flag,
    approved: z
      .boolean()
      .describe(
        "False until it's approved (e.g. a scheduled transaction entered on its date); it " +
          "counts in balances and the plan either way",
      ),
    needsCategory: z
      .boolean()
      .describe(
        'Left Uncategorized ("This needs a category" icon); transfers within the ' +
          "budget, tracking accounts and splits have no category (a split's lines have their " +
          "own `needsCategory`)",
      ),
    imported: z.boolean().describe("From a file import (or matched to one)"),
    importedPayee: z
      .string()
      .nullable()
      .describe("Imported: the payee as the file named it, before renaming rules"),
    matched: z
      .object({
        date: z.string(),
        amount: zMinorUnits,
        payee: z.string(),
        memo: z.string(),
      })
      .nullable()
      .describe("Matched to an import (Matched Transactions): the imported side"),
    transferAccountId: z
      .string()
      .nullable()
      .describe('Transfers: the other account (the payee is "Transfer : <account>")'),
    transferTransactionId: z
      .string()
      .nullable()
      .describe(
        "Transfers: the matching transaction in the other account (the split, for a split's " +
          "transfer line)",
      ),
    transferFromSplit: z
      .boolean()
      .describe(
        "The other side is a line of a split, which owns this transfer's date, amount and " +
          "account; only memo, cleared and category change here",
      ),
    transferReconciled: z
      .boolean()
      .describe(
        "Transfers: the other side is reconciled (it follows changes to date, amount and " +
          "account, and stays reconciled; the app warns before an amount or account change)",
      ),
    transferSide: TransferSideSchema.nullable().describe(
      "Transfers: the other side's own state (null when the other side is a split's line, or " +
        "for other transactions)",
    ),
    attachment: AttachmentSchema.nullable().describe(
      "Its photo or PDF, shared by a transfer's two sides; a split " +
        "has one for the whole split",
    ),
    subtransactions: z
      .array(SubTransactionSchema)
      .describe("A split's lines, in order (empty when not split); the split has no category"),
    runningBalance: zMinorUnits.describe(
      "The account's balance after this transaction, in date order (all of its transactions; " +
        "within a day, inflows first, then outflows from smallest to largest)",
    ),
    matchingLineIds: z
      .array(z.string())
      .nullable()
      .describe(
        "Under a search: the split lines that match it (the register shows only those). Null " +
          "without a search",
      ),
    enteredBy: zMemberRef
      .nullable()
      .describe(
        "Who entered it; null when nobody did (a scheduled occurrence entered on " +
          "its date) or for transactions from before this was recorded",
      ),
    changedBy: zMemberRef
      .nullable()
      .describe("Who changed it last; null if it hasn't changed since it was entered"),
    version: z
      .number()
      .int()
      .describe(
        "Goes up with every change; send it back as `expectedVersion` to refuse a stale edit",
      ),
  })
  .openapi("Transaction");

/**
 * The versions rows had just before a write (a transfer's other side too). With the versions
 * after it, a client knows which version steps were its own.
 */
const PreviousVersions = z
  .record(z.string(), z.number().int())
  .describe("Transaction id → `version` just before this write, transfer sides included");

const UpdatedTransactionSchema = TransactionSchema.extend({
  previousVersions: PreviousVersions,
}).openapi("UpdatedTransaction");

const TransactionListSchema = z
  .object({
    transactions: z.array(TransactionSchema).describe("One page, in the requested order"),
    nextCursor: z
      .string()
      .nullable()
      .describe("Pass as `cursor` for the next page; null on the last page"),
    someHidden: z
      .boolean()
      .nullable()
      .describe(
        "Whether the search, dates or hidden reconciled transactions leave any of the register " +
          "out (first page only; null on later pages)",
      ),
  })
  .openapi("TransactionList");

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});
const TransactionParams = BudgetParams.extend({
  transactionId: z.string().openapi({ param: { name: "transactionId", in: "path" } }),
});

function json<T extends z.ZodType>(schema: T) {
  return { required: true, content: { "application/json": { schema } } } as const;
}
function ok<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}
const notFound = jsonError("No such budget, account or transaction, or the caller isn't a member");
const forbidden = jsonError(
  "The caller's role can't change transactions, or the account's email address isn't confirmed",
);
const crossCurrency = jsonError(
  "A move into an account in another currency (`CROSS_CURRENCY_MOVE`); not supported yet. Or " +
    "no rate for a foreign-currency amount's date (`FX_RATE_UNAVAILABLE`): type one in `fxRate`",
);
const locked = jsonError(
  "A split's transfer side, edited from the split (`TRANSFER_IN_SPLIT`); a new cleared state " +
    "for a reconciled transaction, which stays reconciled (`TRANSACTION_RECONCILED`); a " +
    "change to an FX revaluation's amount, date, account, payee or rate (`REVALUATION_LOCKED`); " +
    "or the transaction changed since `expectedVersion` (`STALE_VERSION`)",
);

const categoryRules =
  "On-budget accounts: a null category means Uncategorized; credit-card payment categories " +
  "can't be used. Tracking accounts never have a category. The payee is matched by name " +
  "(ignoring case) and created if new; null leaves it empty.";

const transferRules =
  "`transferAccountId` (instead of `payeeName`) makes it a transfer: a matching transaction " +
  "with the opposite amount is kept in that account. Only a transfer from a budget account to " +
  "a tracking account has a category (on the budget side), as money leaves the budget. New " +
  "transfers need both accounts open. Between accounts in different currencies each side has " +
  "its own amount (`transferAmount`, in the other account's currency) and the two always have " +
  "opposite base amounts: a side in the budget's currency sets it, otherwise the entered side " +
  "at its rate; the other side's `fxRate` is the rate its amounts imply.";

const splitRules =
  "`subtransactions` (two or more lines, adding up to the amount) splits it across categories; " +
  "its own `categoryId` is then null. Lines follow the same category and transfer rules. Only " +
  "budget accounts have splits, and a transfer can't be split (its lines can be transfers).";

const TransferSideInput = z
  .object({
    memo: Memo,
    cleared: NewCleared,
    flag: Flag,
    approved: z.boolean(),
    categoryId: z.string().nullable(),
    amount: zMinorUnits
      .optional()
      .describe("Its own amount (a transfer between currencies; `transferAmount` wins)"),
  })
  .describe(
    "Restoring a deleted transfer (an undo): its other side's own state, from the deleted " +
      "transaction's `transferSide`. Left out, the other side starts uncleared, approved, " +
      "unflagged and with this side's memo",
  )
  .openapi("TransferSideInput");

const SubTransactionInput = z
  .object({
    id: z.string().optional().describe("An existing line of this split; leave out for new ones"),
    amount: zMinorUnits.describe("Negative is an outflow"),
    payeeName: PayeeName.nullable().default(null),
    transferAccountId: z.string().optional().describe("Make this line a transfer"),
    transferAmount: zMinorUnits
      .nullable()
      .optional()
      .describe(
        "A transfer line to an account in another currency (not the budget's: that one gets " +
          "the line's base amount): the other side's amount in its currency, opposite in sign. " +
          "Left out, the line's base amount at the date's rate, or on an edit the amount it had; " +
          "null to go back to the date's rate",
      ),
    categoryId: z.string().nullable().default(null),
    memo: Memo.default(""),
    transferSide: TransferSideInput.optional(),
  })
  .openapi("SubTransactionInput");
const SubTransactions = z.array(SubTransactionInput).min(2);

const Fee = z
  .object({
    amount: zMinorUnits.describe("Positive: what the fee costs, in the sending account's currency"),
    categoryId: z.string().nullable().describe("Null: Uncategorized"),
  })
  .describe(
    "A transfer's fee: a separate outflow in the sending account (the one the money leaves), " +
      'same date, payee and memo "Transfer fee", converted like any transaction. It isn\'t ' +
      "linked to the transfer",
  )
  .openapi("TransferFee");

const TransferAccountId = z
  .string()
  .describe("Make this a transfer to or from that account; leave `payeeName` out");

export const listTransactions = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/transactions",
  operationId: "listTransactions",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "One account's register, or every account's, a page at a time",
  description:
    "Filters and search narrow the rows but not the running balance: each row keeps the " +
    "account's real balance at that point, computed over all of its transactions. Pages are " +
    "keyset-paged: pass the previous page's `nextCursor` (with the same filters and sort).",
  request: {
    params: BudgetParams,
    query: z.object({
      accountId: z.string().optional().describe("Leave out for all accounts"),
      q: SearchText.optional(),
      from: IsoDate.optional().describe("On or after this date"),
      to: IsoDate.optional().describe("On or before this date"),
      hideReconciled: z
        .stringbool()
        .optional()
        .describe('The View menu\'s "Show Reconciled Transactions" turned off'),
      sort: z
        .string()
        .regex(SORT_PATTERN)
        .default("date:desc")
        .describe(
          "Stacked sort: comma-separated `column:asc|desc` fields, first field first " +
            "(e.g. `payee:desc,date:asc`). Columns: " +
            SORT_COLUMNS.join(", ") +
            ". Outflow and inflow each count the other side's rows as zero; flag ascending is " +
            "none, red, orange, yellow, green, blue, purple; cleared ascending is reconciled, " +
            "cleared, uncleared. Ties end by date, newest first, a day's largest outflow on top.",
        ),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      cursor: z.string().optional(),
      today: IsoDate.optional().describe(
        "The user's today: scheduled transactions due by then are entered first",
      ),
    }),
  },
  responses: {
    200: ok("Transactions", TransactionListSchema),
    400: jsonError("Invalid input, or a cursor from another register or sort (INVALID_CURSOR)"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const createTransaction = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/transactions",
  operationId: "createTransaction",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Add a transaction, a transfer or a split",
  description: `${categoryRules} ${transferRules} ${splitRules}`,
  request: {
    params: BudgetParams,
    query: DateLimitQuery,
    body: json(
      z
        .object({
          accountId: z.string(),
          date: IsoDate,
          amount: zMinorUnits.describe("Negative is an outflow"),
          fxRate: zFxRate
            .nullable()
            .optional()
            .describe(
              "In an account in another currency than the budget's: the rate to convert at " +
                "(1 account currency = fxRate budget currency). Left out, the date's rate",
            ),
          payeeName: PayeeName.nullable().default(null),
          transferAccountId: TransferAccountId.optional(),
          transferAmount: zMinorUnits
            .optional()
            .describe(
              "A transfer to an account in another currency: the other side's amount in its " +
                "currency, opposite in sign. Left out, this side's base amount at the date's rate",
            ),
          fee: Fee.optional(),
          categoryId: z.string().nullable(),
          memo: Memo.default(""),
          subtransactions: SubTransactions.optional(),
          cleared: NewCleared.optional().describe(
            "Left out: cleared in a cash account, otherwise uncleared (each side of a transfer by its own account)",
          ),
          flag: Flag.default(null),
          approved: z
            .boolean()
            .optional()
            .describe("False brings back an unapproved transaction (an undo); true if left out"),
          transferSide: TransferSideInput.optional(),
          restore: z
            .boolean()
            .optional()
            .describe(
              "An undo bringing back a deleted transaction: its accounts (and its transfers' " +
                "accounts) may have been closed since, which Undo allows",
            ),
          baseAmount: zMinorUnits
            .optional()
            .describe(
              "With `restore`, for a deleted FX Revaluation only (amount 0): its booked amount in " +
                "the budget's currency, with its rate in `fxRate`",
            ),
        })
        .openapi("CreateTransaction"),
    ),
  },
  responses: {
    201: ok(
      "Created",
      TransactionSchema.extend({
        feeTransactionId: z
          .string()
          .nullable()
          .describe(
            "The transfer's fee, a transaction of its own (deleting the transfer keeps it)",
          ),
      })
        .describe("The side in `accountId`")
        .openapi("CreatedTransaction"),
    ),
    400: jsonError(
      "Invalid input, a closed account, a category the account can't use, a transfer to the " +
        "same account, or a date after today (DATE_IN_FUTURE)",
    ),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    422: crossCurrency,
  },
});

export const updateTransaction = createRoute({
  method: "patch",
  path: "/budgets/{budgetId}/transactions/{transactionId}",
  operationId: "updateTransaction",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Edit a transaction, move it to another account, or toggle cleared",
  description:
    `${categoryRules} ${transferRules} On a transfer, date, amount and memo changes apply to ` +
    "both sides; cleared, flag and category are per side. Setting `payeeName` turns a transfer back " +
    "into a normal transaction and deletes the other side. A reconciled other side follows " +
    "and stays reconciled. A reconciled transaction can be edited but stays reconciled, so " +
    "`cleared` can't be set on it. Moving it to an account that can't use its category resets " +
    "the category. " +
    `${splitRules} Sending \`subtransactions\` replaces a split's lines (matched by \`id\`); ` +
    "changing a split's amount needs new lines too. Giving a split a `categoryId` (or making " +
    "it a transfer) un-splits it. A split's transfer side only takes memo, cleared, flag and " +
    "category; its memo is the split line's too.",
  request: {
    params: TransactionParams,
    query: DateLimitQuery,
    body: json(
      z
        .strictObject({
          accountId: z.string().optional(),
          date: IsoDate.optional(),
          amount: zMinorUnits.optional(),
          fxRate: zFxRate
            .nullable()
            .optional()
            .describe(
              "In an account in another currency: a rate typed by hand, or null to go back to " +
                "the date's. Left out, the rate stays (a typed one, or the date's unless the " +
                "date changes)",
            ),
          payeeName: PayeeName.nullable().optional(),
          transferAccountId: TransferAccountId.optional(),
          transferAmount: zMinorUnits
            .nullable()
            .optional()
            .describe(
              "A transfer between currencies: the other side's amount in its currency, or null " +
                "for this side's base amount at the date's rate. Left out, the other side keeps " +
                "its own amount",
            ),
          categoryId: z.string().nullable().optional(),
          memo: Memo.optional(),
          cleared: SettableCleared.optional(),
          flag: Flag.optional(),
          subtransactions: SubTransactions.optional(),
          expectedVersion: z
            .number()
            .int()
            .optional()
            .describe(
              "Refuse (409 STALE_VERSION) unless the transaction is still at this `version`: " +
                "undo and redo send it so a partner's later change isn't overwritten",
            ),
          approved: z
            .boolean()
            .optional()
            .describe(
              "Approve it (or un-approve it, as an undo does); a transfer's other side follows. " +
                "Left out, any change but a flag approves an unapproved transaction, as saving " +
                "it or clicking its cleared state does",
            ),
        })
        .openapi("UpdateTransaction"),
    ),
  },
  responses: {
    200: ok("Updated", UpdatedTransactionSchema),
    400: jsonError(
      "Invalid input, a closed account, a category the account can't use, a transfer to the " +
        "same account, or a date after today (DATE_IN_FUTURE)",
    ),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    409: locked,
    422: crossCurrency,
  },
});

export const deleteTransaction = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}/transactions/{transactionId}",
  operationId: "deleteTransaction",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Delete a transaction",
  description:
    "Deleting either side of a transfer deletes both, reconciled or not. Deleting a split " +
    "deletes its transfer lines' other sides; those can't be deleted on their own " +
    "(`TRANSFER_IN_SPLIT`).",
  request: {
    params: TransactionParams,
    query: z.object({
      expectedVersion: z.coerce
        .number()
        .int()
        .optional()
        .describe("Refuse (409 STALE_VERSION) unless the transaction is still at this `version`"),
    }),
  },
  responses: {
    204: { description: "Deleted" },
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    409: jsonError(
      "A split's transfer side, deleted with its split (`TRANSFER_IN_SPLIT`), or the " +
        "transaction changed since `expectedVersion` (STALE_VERSION)",
    ),
  },
});

const attachmentsOff = jsonError(
  "Attachments are turned off on this server: it has no object storage (`ATTACHMENTS_DISABLED`)",
);

export const uploadAttachment = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/transactions/{transactionId}/attachment",
  operationId: "uploadAttachment",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth, attachmentBodyLimit] as const,
  summary: "Attach a photo or PDF to a transaction",
  description:
    "One per transaction: delete it before adding another " +
    "(`ATTACHMENT_EXISTS`). A transfer's two sides share it. The type is read from the file " +
    `(${ATTACHMENT_TYPES.join(", ")}); at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`,
  request: {
    params: TransactionParams,
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z
              .custom<File>((v) => v instanceof File, { message: "Expected a file" })
              .openapi({ type: "string", format: "binary" }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Attached",
      content: { "application/json": { schema: AttachmentSchema } },
    },
    400: jsonError("No file, or an empty one"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    409: jsonError(
      "It already has an attachment, or its transfer's other side has (`ATTACHMENT_EXISTS`)",
    ),
    413: jsonError(`Bigger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB (\`FILE_TOO_LARGE\`)`),
    415: jsonError("Not an image or PDF an attachment can be (`UNSUPPORTED_FILE_TYPE`)"),
    503: attachmentsOff,
  },
});

export const getAttachment = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/transactions/{transactionId}/attachment",
  operationId: "getAttachment",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Open or download a transaction's attachment",
  description:
    "Redirects to a short-lived link to the file in object storage, or (storage on the API's " +
    "own disk) sends the file. Either side of a transfer gives the shared attachment.",
  request: {
    params: TransactionParams,
    query: z.object({
      download: z
        .enum(["true", "false"])
        .optional()
        .describe("`true`: saved as a download (its file name) rather than shown"),
      v: z
        .string()
        .max(100)
        .optional()
        .describe("Any value, such as the attachment's id, to tell its versions apart in a cache"),
    }),
  },
  responses: {
    200: {
      description: "The file",
      content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
    },
    302: { description: "Where to fetch the file (valid for a few minutes)" },
    401: jsonError("Not signed in"),
    404: jsonError("No such transaction, it has no attachment, or the caller isn't a member"),
    503: attachmentsOff,
  },
});

export const deleteAttachment = createRoute({
  method: "delete",
  path: "/budgets/{budgetId}/transactions/{transactionId}/attachment",
  operationId: "deleteAttachment",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Delete a transaction's attachment",
  description: "From both sides of a transfer. Its file is deleted from storage soon after.",
  request: { params: TransactionParams },
  responses: {
    204: { description: "Deleted" },
    401: jsonError("Not signed in"),
    403: forbidden,
    404: jsonError("No such transaction, it has no attachment, or the caller isn't a member"),
  },
});

const RegisterFilterSchema = z
  .object({
    accountId: z.string().optional(),
    q: SearchText.optional(),
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    hideReconciled: z.boolean().optional(),
    today: IsoDate.optional().describe(
      "The user's today, as sent with the register list: a year-less `Income:` term means its year",
    ),
  })
  .describe("The same filter as the register's query parameters")
  .openapi("RegisterFilter");

export const SelectionSchema = z
  .union([
    z.strictObject({
      ids: z.array(z.string()).min(1).max(1000).describe("Transactions ticked one by one"),
    }),
    z.strictObject({
      filter: RegisterFilterSchema.describe("Select all: every transaction this filter matches"),
      exclude: z.array(z.string()).max(1000).default([]).describe("Unticked after selecting all"),
    }),
  ])
  .openapi("TransactionSelection");

const BulkActionSchema = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("cleared"), cleared: SettableCleared }),
    z.strictObject({ type: z.literal("flag"), flag: Flag }),
    z.strictObject({ type: z.literal("categorize"), categoryId: z.string() }),
    z.strictObject({ type: z.literal("memo"), memo: Memo.min(1) }),
    z.strictObject({ type: z.literal("move"), accountId: z.string() }),
    z.strictObject({ type: z.literal("delete") }),
    z.strictObject({ type: z.literal("duplicate") }),
    z.strictObject({ type: z.literal("approve") }),
    z.strictObject({ type: z.literal("reject") }),
  ])
  .openapi("BulkAction");

export const summarizeSelection = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/transactions/selection",
  operationId: "summarizeSelection",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "How many transactions a selection holds and their total",
  request: { params: BudgetParams, body: json(z.object({ selection: SelectionSchema })) },
  responses: {
    200: ok(
      "Selection",
      z
        .object({
          count: z.number().int(),
          total: zMinorUnits.describe(
            "Sum of the amounts, in `currency`'s minor units; 0 when `currency` is null",
          ),
          currency: zCurrencyCode
            .nullable()
            .describe(
              "The selected transactions' currency (their accounts'); null when they're in " +
                "different currencies, or none are selected",
            ),
          uncleared: z.number().int(),
          cleared: z.number().int(),
          reconciled: z.number().int(),
          reconciledTransfers: z
            .number()
            .int()
            .describe(
              "Transactions whose transfer's other side (or a split line's) is reconciled; " +
                "deleting them changes another account's reconciliation",
            ),
          categorizable: z
            .number()
            .int()
            .describe(
              "Transactions that take a category (not transfers within the budget, nor tracking accounts)",
            ),
          unapproved: z
            .number()
            .int()
            .describe("Unapproved transactions (the action bar then offers Approve and Reject)"),
          splits: z.number().int(),
          splitsWithTransfers: z
            .number()
            .int()
            .describe("Splits with a transfer line, which categorize keeps split"),
          deletable: z
            .number()
            .int()
            .describe("All but the other sides of splits' transfer lines (deleted with the split)"),
        })
        .openapi("SelectionSummary"),
    ),
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const bulkUpdateTransactions = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/transactions/bulk",
  operationId: "bulkUpdateTransactions",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Apply one action to every selected transaction it applies to",
  description:
    "Follows the action bar: rows an action doesn't apply to are skipped, and `updated` " +
    "counts the rest. `cleared` skips reconciled rows. `categorize` skips transfers within " +
    "the budget and tracking-account rows; it un-splits splits, except splits with a transfer " +
    "line, which stay split with every other line given the category. `memo` replaces the " +
    "memo (a split's own, not its lines'; on the selected side of a transfer only, as " +
    "Edit Memo does). `move` moves rows to another account like a " +
    "single edit (a transfer keeps its other side, which then points at the new account) and " +
    "skips rows already there, transfers into their own other account and splits with a " +
    "transfer line to it. `delete` deletes transfers' other sides too and skips the other " +
    "sides of splits' transfer lines (they go with the split). `approve` approves the " +
    "unapproved rows (and their transfers' other sides); `reject` deletes the unapproved rows " +
    "(as `delete` does) and skips the rest; `cleared` and `categorize` approve the rows they " +
    "change. `duplicate` copies each row with the " +
    "same date and fields, cleared state kept (reconciled becomes cleared), approved, " +
    "a transfer with a new other side; a split's transfer side copies its whole split, and a " +
    "transfer selected from both sides is copied once. Rows in (or transferring to) closed " +
    "accounts are skipped. All of it happens in one database transaction.",
  request: {
    params: BudgetParams,
    body: json(
      z.object({
        selection: SelectionSchema,
        action: BulkActionSchema,
        expectedVersions: z
          .record(z.string(), z.number().int())
          .optional()
          .describe(
            "Transaction id → `version`: refuse (409 STALE_VERSION) if any changed since " +
              "(redo sends it)",
          ),
      }),
    ),
  },
  responses: {
    200: ok(
      "Updated",
      z
        .object({
          updated: z.number().int(),
          before: z
            .array(TransactionSchema)
            .describe("Pre-edit rows for the caller's local undo history"),
          created: z
            .array(z.string())
            .describe("`duplicate`: the new transactions' ids (empty for other actions)"),
          copies: z
            .array(z.string())
            .describe(
              "`duplicate`: every row of the copies whose original row was selected, so a " +
                "transfer selected from both sides has both sides of its copy here (empty for " +
                "other actions)",
            ),
          previousVersions: PreviousVersions,
          versions: z
            .record(z.string(), z.number().int())
            .describe(
              "The changed transactions' `version` now (their transfers' other sides too), for " +
                "undo's `expectedVersion`",
            ),
        })
        .openapi("BulkUpdateResult"),
    ),
    400: jsonError("Invalid input, a category transactions can't use, or a closed account"),
    401: jsonError("Not signed in"),
    403: forbidden,
    404: notFound,
    422: crossCurrency,
  },
});
