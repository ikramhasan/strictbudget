import { createRoute, z } from "@hono/zod-openapi";
import { CSV_DATE_FORMATS, zMinorUnits } from "@strictbudget/engine";
import { IsoDate } from "../../lib/dates";
import { jsonError } from "../../lib/errors";
import { authSecurity, requireAuth } from "../../middleware/require-auth";
import { PayeeRuleSnapshotSchema } from "../payees/routes";

const AccountParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
  accountId: z.string().openapi({ param: { name: "accountId", in: "path" } }),
});

const Column = z.number().int().min(0).max(200).nullable();

export const CsvImportSettingsSchema = z
  .object({
    columns: z
      .array(z.string().max(200))
      .max(200)
      .describe("The column names they were set for: the lowercased header, or A, B, C…"),
    mapping: z
      .object({ date: Column, payee: Column, memo: Column, outflow: Column, inflow: Column })
      .describe("The column (0-based) feeding each field; one column can be both amounts"),
    noHeaderRow: z.boolean(),
    swapInflowOutflow: z.boolean(),
    dateFormat: z.enum(CSV_DATE_FORMATS).nullable(),
  })
  .openapi("CsvImportSettings");

export const StatementImportSettingsSchema = z
  .object({ importMemos: z.boolean(), swapPayeeMemo: z.boolean(), swapInflowOutflow: z.boolean() })
  .openapi("StatementImportSettings");

const ImportContextSchema = z
  .object({
    startDate: IsoDate.nullable().describe("The account's oldest transaction"),
    reconciledThrough: IsoDate.nullable().describe("The newest reconciled transaction's date"),
    csvSettings: CsvImportSettingsSchema.nullable().describe(
      'What "Remember setting for this account" kept from the last CSV import',
    ),
    statementSettings: StatementImportSettingsSchema.nullable().describe(
      "The same for the last OFX/QFX or QIF import",
    ),
  })
  .openapi("ImportContext");

const ImportRowSchema = z.object({
  date: IsoDate,
  amount: zMinorUnits.describe("In the account's currency; negative is an outflow"),
  payee: z.string().max(500).describe("As the file names it (renaming rules apply)"),
  memo: z.string().max(2000),
});

const ImportBodySchema = z
  .object({
    transactions: z.array(ImportRowSchema).max(10000),
    csvSettings: CsvImportSettingsSchema.nullable()
      .optional()
      .describe("Saved for the account's next CSV import; null forgets them, left out keeps them"),
    statementSettings: StatementImportSettingsSchema.nullable()
      .optional()
      .describe("Saved for the account's next OFX/QFX or QIF import, like `csvSettings`"),
  })
  .openapi("ImportTransactions");

const ImportResultSchema = z
  .object({
    imported: z.number().int().describe("New transactions"),
    matched: z
      .number()
      .int()
      .describe("Rows matched to entered transactions (same amount, within 10 days)"),
    duplicates: z
      .number()
      .int()
      .describe("Rows skipped because the account already took them in (same import id)"),
    transactionIds: z.array(z.string()).describe("The new transactions, in the file's order"),
    matchedIds: z.array(z.string()).describe("The entered transactions that were matched"),
  })
  .openapi("ImportResult");

const notFound = jsonError("No such budget or account, or the caller isn't a member");

export const getImportContext = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/accounts/{accountId}/import-context",
  operationId: "getImportContext",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "What a file import into the account needs: its start date and remembered CSV settings",
  request: { params: AccountParams },
  responses: {
    200: {
      description: "Import context",
      content: { "application/json": { schema: ImportContextSchema } },
    },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: notFound,
  },
});

export const importTransactions = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/accounts/{accountId}/import",
  operationId: "importTransactions",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Import a bank file's transactions into the account (cleared, unapproved)",
  description:
    "The rows come already read from the file (CSV, OFX/QFX or QIF). Rows the account took in " +
    "before (same import id, even if since deleted) are skipped. Payees go through the plan's " +
    "renaming rules; categories follow the payee's.",
  request: {
    params: AccountParams,
    query: z.object({
      today: IsoDate.optional().describe(
        "The user's today: a row dated later is refused (`DATE_IN_FUTURE`)",
      ),
    }),
    body: { required: true, content: { "application/json": { schema: ImportBodySchema } } },
  },
  responses: {
    200: {
      description: "Imported",
      content: { "application/json": { schema: ImportResultSchema } },
    },
    400: jsonError("Invalid input, a closed account, or a row dated in the future"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't add transactions, or the account's email address isn't confirmed",
    ),
    404: notFound,
  },
});

const BudgetParams = z.object({
  budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
});

export const matchTransactions = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/transactions/match",
  operationId: "matchTransactions",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Match an imported transaction to an entered one",
  description:
    "The two become one: the entered transaction keeps its date, payee, memo and category, " +
    "takes the imported amount, and is cleared and approved. Unmatch splits them again.",
  request: {
    params: BudgetParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              transactionIds: z
                .tuple([z.string(), z.string()])
                .describe("One imported (not yet matched) and one entered transaction"),
            })
            .openapi("MatchTransactions"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Matched",
      content: {
        "application/json": {
          schema: z.object({ transactionId: z.string() }).openapi("MatchResult"),
        },
      },
    },
    400: jsonError(
      "Not one imported and one entered transaction in one account, either is reconciled, or " +
        "the imported one is a transfer or split",
    ),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change transactions, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});

export const unmatchTransaction = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/transactions/{transactionId}/unmatch",
  operationId: "unmatchTransaction",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Split a matched transaction back into the entered and the imported one",
  description:
    "The entered transaction gets back its amount, cleared state and approval from before the " +
    "match; a transfer or split keeps its current amount, so its other sides still add up.",
  request: {
    params: BudgetParams.extend({
      transactionId: z.string().openapi({ param: { name: "transactionId", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description: "Unmatched",
      content: {
        "application/json": {
          schema: z
            .object({
              transactionId: z.string().describe("The entered transaction, as before the match"),
              importedTransactionId: z
                .string()
                .describe("The imported one again: cleared, unapproved, Uncategorized"),
            })
            .openapi("UnmatchResult"),
        },
      },
    },
    400: jsonError("The transaction isn't matched, or its account is closed"),
    409: jsonError("The transaction is reconciled (`TRANSACTION_RECONCILED`)"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change transactions, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget or transaction, or the caller isn't a member"),
  },
});

export const dontRenameTransaction = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/transactions/{transactionId}/dont-rename",
  operationId: "dontRenameTransaction",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Don't Rename as <payee>: back to the imported payee, without the rule",
  description:
    "The transaction takes its imported payee name again (and is approved), and its payee loses " +
    'the renaming rule "Is <imported name>". `undoDontRenameTransaction` puts both back.',
  request: {
    params: BudgetParams.extend({
      transactionId: z.string().openapi({ param: { name: "transactionId", in: "path" } }),
    }),
    query: z.object({
      expectedVersion: z.coerce
        .number()
        .int()
        .optional()
        .describe("Refuse (409 STALE_VERSION) unless the transaction is still at this `version`"),
    }),
  },
  responses: {
    200: {
      description: "Renamed back",
      content: {
        "application/json": {
          schema: z
            .object({
              payeeId: z.string().describe("The payee named as imported"),
              removedRules: z
                .array(PayeeRuleSnapshotSchema)
                .describe('The old payee\'s "Is <imported name>" rules, as they were'),
              version: z.number().int().describe("The transaction's version now"),
              previousVersions: z
                .record(z.string(), z.number().int())
                .describe("The transaction's version just before this change"),
            })
            .openapi("DontRenameResult"),
        },
      },
    },
    400: jsonError("The transaction wasn't imported, is matched, or is a transfer"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change transactions, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget or transaction, or the caller isn't a member"),
    409: jsonError("The transaction changed since `expectedVersion` (`STALE_VERSION`)"),
  },
});

export const undoDontRenameTransaction = createRoute({
  method: "post",
  path: "/budgets/{budgetId}/transactions/{transactionId}/dont-rename/undo",
  operationId: "undoDontRenameTransaction",
  tags: ["Transactions"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Undo Don't Rename: the payee, approval and removed rules as they were",
  description:
    "Puts the transaction back on `payeeId` with its approval, and brings back the rules Don't " +
    "Rename removed with their ids, positions and ages, so the same rule wins the next import.",
  request: {
    params: BudgetParams.extend({
      transactionId: z.string().openapi({ param: { name: "transactionId", in: "path" } }),
    }),
    query: z.object({
      expectedVersion: z.coerce
        .number()
        .int()
        .optional()
        .describe("Refuse (409 STALE_VERSION) unless the transaction is still at this `version`"),
    }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              payeeId: z.string().describe("The payee the transaction had before Don't Rename"),
              approved: z.boolean().describe("Its approval before Don't Rename"),
              rules: z
                .array(PayeeRuleSnapshotSchema)
                .max(100)
                .describe("`removedRules` from Don't Rename"),
            })
            .openapi("UndoDontRename"),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Put back",
      content: {
        "application/json": {
          schema: z
            .object({
              version: z.number().int().describe("The transaction's version now"),
              previousVersions: z
                .record(z.string(), z.number().int())
                .describe("The transaction's version just before this change"),
            })
            .openapi("UndoDontRenameResult"),
        },
      },
    },
    400: jsonError(
      "The transaction wasn't imported, is matched or a transfer, or the payee or rules don't fit",
    ),
    401: jsonError("Not signed in"),
    403: jsonError(
      "The caller's role can't change transactions, or the account's email address isn't confirmed",
    ),
    404: jsonError("No such budget, transaction or rule, or the caller isn't a member"),
    409: jsonError("The transaction changed since `expectedVersion` (`STALE_VERSION`)"),
  },
});
