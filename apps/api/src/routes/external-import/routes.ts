import { createRoute, z } from "@hono/zod-openapi";
import {
  zAccountType,
  zCurrencyCode,
  zCurrencySymbolPosition,
  zDateFormat,
  zNumberFormat,
} from "@strictbudget/engine";
import { jsonError } from "../../lib/errors";
import { requireSession, sessionSecurity } from "../../middleware/require-auth";
import { BudgetSchema } from "../budgets/routes";

const Token = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .describe(
    "A YNAB personal access token (YNAB → Account Settings → Developer Settings). Used for this " +
      "request only; never stored.",
  );
const Name = z.string().trim().min(1).max(100);

const ImportReportSchema = z
  .object({
    budget: BudgetSchema,
    reused: z
      .boolean()
      .describe(
        "The same plan (or files) was imported before: this is that budget, nothing new was made",
      ),
    counts: z
      .record(z.string(), z.number().int())
      .nullable()
      .describe("How many rows of each kind came over; null when reused"),
    warnings: z
      .array(z.string())
      .describe("What couldn't come over as it was in YNAB, in plain words"),
  })
  .openapi("ExternalImportReport");

const externalErrors = {
  400: jsonError(
    "Invalid input, or YNAB refused the token (EXTERNAL_TOKEN_INVALID) or the files aren't YNAB's " +
      "(EXTERNAL_FILE_INVALID)",
  ),
  401: jsonError("Not signed in"),
  403: jsonError("The account's email address isn't confirmed"),
  404: jsonError("YNAB has no such plan (EXTERNAL_PLAN_NOT_FOUND)"),
  422: jsonError(
    "The plan can't be converted exactly: a currency strictbudget doesn't have " +
      "(EXTERNAL_CURRENCY_UNSUPPORTED) or a fraction of the currency's smallest unit (EXTERNAL_AMOUNT_INEXACT)",
  ),
  429: jsonError("YNAB's hourly request limit was reached (EXTERNAL_RATE_LIMITED)"),
  502: jsonError(
    "YNAB couldn't be reached or answered unexpectedly (EXTERNAL_UNAVAILABLE, EXTERNAL_UNEXPECTED)",
  ),
};

export const listExternalPlans = createRoute({
  method: "post",
  path: "/budgets/import/external/plans",
  operationId: "listExternalPlans",
  tags: ["Budgets"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "The YNAB plans a personal access token can read",
  description: "A POST so the token travels in the body, never in a URL.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ token: Token }).openapi("ExternalToken") },
      },
    },
  },
  responses: {
    200: {
      description: "The plans",
      content: {
        "application/json": {
          schema: z
            .object({
              plans: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  lastModifiedOn: z.string().nullable(),
                }),
              ),
            })
            .openapi("ExternalPlanList"),
        },
      },
    },
    ...externalErrors,
  },
});

export const importExternalPlan = createRoute({
  method: "post",
  path: "/budgets/import/external",
  operationId: "importExternalPlan",
  tags: ["Budgets"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Import a YNAB plan through YNAB's API, as a new budget",
  description:
    "Reads the whole plan with the caller's personal access " +
    "token and makes a new budget of it: accounts (with loan rates, minimum payments and " +
    "escrow), category groups and categories (hidden ones, notes, targets), credit card payment " +
    "categories, payees, every month's assigned amounts and notes, transactions (transfers, " +
    "splits, flags, cleared, reconciled and approved states) and scheduled transactions. " +
    "Milliunits convert exactly to the currency's minor units. Importing the same plan again " +
    "returns the budget the first import made (`reused`); `replace` imports it afresh and " +
    "deletes that one.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              token: Token,
              planId: z.string().min(1).max(100),
              name: Name.optional().describe("The new budget's name; the plan's by default"),
              replace: z.boolean().optional(),
            })
            .openapi("ImportExternalPlan"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Imported before: the earlier import's budget",
      content: { "application/json": { schema: ImportReportSchema } },
    },
    201: {
      description: "The new budget and the import report",
      content: { "application/json": { schema: ImportReportSchema } },
    },
    ...externalErrors,
  },
});

const CsvSchema = z
  .object({
    plan: z.string().min(1).describe('The text of YNAB\'s "… - Plan.csv" (or .tsv) file'),
    register: z.string().min(1).describe('The text of YNAB\'s "… - Register.csv" (or .tsv) file'),
    name: Name,
    currency: zCurrencyCode,
    numberFormat: zNumberFormat,
    currencySymbolPosition: zCurrencySymbolPosition,
    dateFormat: zDateFormat,
    accountTypes: z
      .record(z.string(), zAccountType)
      .optional()
      .describe("Each account's type by name; the files don't say, so ones left out are guessed"),
    dryRun: z
      .boolean()
      .optional()
      .describe("Only read the files: return the accounts and their (guessed) types"),
    replace: z.boolean().optional(),
  })
  .openapi("ImportExternalFiles");

export const importExternalFiles = createRoute({
  method: "post",
  path: "/budgets/import/external-files",
  operationId: "importExternalFiles",
  tags: ["Budgets"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Import YNAB's Export Plan files as a new budget (the fallback to the API)",
  description:
    "The plan and register files from YNAB's Export Plan, in the plan's currency, number and " +
    "date format. They hold categories, assigned amounts and transactions, but not account " +
    "types (give them in `accountTypes`, or take the guesses `dryRun` returns), targets, " +
    "scheduled transactions, approvals or transfer links (transfers are paired by account, " +
    'date and amount; splits are rebuilt from their "Split (i/n)" memos). The same files ' +
    "imported again return the first import's budget (`reused`).",
  request: {
    body: { required: true, content: { "application/json": { schema: CsvSchema } } },
  },
  responses: {
    200: {
      description: "A dry run's accounts, or the budget an earlier import of the same files made",
      content: {
        "application/json": {
          schema: z.union([
            z
              .object({
                accounts: z.array(
                  z.object({ name: z.string(), type: zAccountType, guessed: z.boolean() }),
                ),
              })
              .openapi("ExternalFilesPreview"),
            ImportReportSchema,
          ]),
        },
      },
    },
    201: {
      description: "The new budget and the import report",
      content: { "application/json": { schema: ImportReportSchema } },
    },
    ...externalErrors,
  },
});
