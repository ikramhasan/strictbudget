import type { RouteHandler } from "@hono/zod-openapi";
import { budgetAccount } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { loadBudgetAccess } from "../../lib/budget-access";
import { assertNotFuture, latestTransactionDate } from "../../lib/dates";
import {
  dontRename,
  importCutoff,
  importTransactions as importRows,
  matchTransactions as matchRows,
  undoDontRename,
  unmatchTransaction as unmatchRow,
} from "../../lib/file-import";
import type { Tx } from "../../lib/ledger";
import { assertTransactionVersions, transactionVersions } from "../../lib/versions";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { assertOpen, findAccount } from "../transactions/rules";
import type {
  dontRenameTransaction,
  getImportContext,
  importTransactions,
  matchTransactions,
  undoDontRenameTransaction,
  unmatchTransaction,
} from "./routes";

type Env = AppEnv & AuthedEnv;

export const getImportContextHandler: RouteHandler<typeof getImportContext, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  const account = await findAccount(db, budgetId, accountId);
  const cutoff = await importCutoff(db, account.id);
  return c.json(
    {
      ...cutoff,
      csvSettings: account.csvImportSettings ?? null,
      statementSettings: account.statementImportSettings ?? null,
    },
    200,
  );
};

export const importTransactionsHandler: RouteHandler<typeof importTransactions, Env> = async (
  c,
) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { today } = c.req.valid("query");
  const body = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { transaction: ["create"] });
  const latest = latestTransactionDate(c.var.deps, today);
  for (const row of body.transactions) assertNotFuture(row.date, latest);
  const result = await db.transaction(async (tx) => {
    const account = await findAccount(tx, budgetId, accountId);
    assertOpen(account);
    if (body.csvSettings !== undefined || body.statementSettings !== undefined) {
      await tx
        .update(budgetAccount)
        .set({
          ...(body.csvSettings !== undefined ? { csvImportSettings: body.csvSettings } : {}),
          ...(body.statementSettings !== undefined
            ? { statementImportSettings: body.statementSettings }
            : {}),
        })
        .where(eq(budgetAccount.id, account.id));
    }
    return importRows(
      tx,
      c.var.deps,
      budgetId,
      account,
      body.transactions.map((row) => ({ ...row, amount: BigInt(row.amount) })),
    );
  });
  return c.json(
    {
      imported: result.transactionIds.length,
      matched: result.matchedIds.length,
      duplicates: result.duplicates,
      transactionIds: result.transactionIds,
      matchedIds: result.matchedIds,
    },
    200,
  );
};

export const matchTransactionsHandler: RouteHandler<typeof matchTransactions, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { transactionIds } = c.req.valid("json");
  await loadBudgetAccess(c, budgetId, { transaction: ["update"] });
  const transactionId = await c.var.deps.db.transaction((tx) =>
    matchRows(tx, budgetId, transactionIds),
  );
  return c.json({ transactionId }, 200);
};

export const unmatchTransactionHandler: RouteHandler<typeof unmatchTransaction, Env> = async (
  c,
) => {
  const { budgetId, transactionId } = c.req.valid("param");
  await loadBudgetAccess(c, budgetId, { transaction: ["update"] });
  const result = await c.var.deps.db.transaction((tx) => unmatchRow(tx, budgetId, transactionId));
  return c.json(result, 200);
};

/** Runs a Don't Rename step, checking `expectedVersion` and reporting the row's versions. */
async function versioned<T>(
  c: Context<Env>,
  budgetId: string,
  transactionId: string,
  expectedVersion: number | undefined,
  write: (tx: Tx) => Promise<T>,
) {
  return c.var.deps.db.transaction(async (tx) => {
    // Undo and redo send the version they expect, as other edits do.
    if (expectedVersion !== undefined) {
      const expected = { [transactionId]: expectedVersion };
      await assertTransactionVersions(tx, budgetId, expected, c.var.user.id);
    }
    const previousVersions = await transactionVersions(tx, [transactionId]);
    const result = await write(tx);
    const versions = await transactionVersions(tx, [transactionId]);
    return { result, previousVersions, version: versions[transactionId] as number };
  });
}

export const dontRenameHandler: RouteHandler<typeof dontRenameTransaction, Env> = async (c) => {
  const { budgetId, transactionId } = c.req.valid("param");
  const { expectedVersion } = c.req.valid("query");
  await loadBudgetAccess(c, budgetId, { transaction: ["update"] });
  const { result, ...versions } = await versioned(
    c,
    budgetId,
    transactionId,
    expectedVersion,
    (tx) => dontRename(tx, budgetId, transactionId),
  );
  return c.json({ ...result, ...versions }, 200);
};

export const undoDontRenameHandler: RouteHandler<typeof undoDontRenameTransaction, Env> = async (
  c,
) => {
  const { budgetId, transactionId } = c.req.valid("param");
  const { expectedVersion } = c.req.valid("query");
  const body = c.req.valid("json");
  await loadBudgetAccess(c, budgetId, { transaction: ["update"] });
  const { previousVersions, version } = await versioned(
    c,
    budgetId,
    transactionId,
    expectedVersion,
    (tx) => undoDontRename(tx, budgetId, transactionId, body),
  );
  return c.json({ previousVersions, version }, 200);
};
