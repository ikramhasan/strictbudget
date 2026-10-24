import type { RouteHandler } from "@hono/zod-openapi";
import { sql } from "@strictbudget/db";
import {
  budgetAccount,
  category,
  payee,
  subTransaction,
  transaction,
} from "@strictbudget/db/schema";
import { usesCategory } from "@strictbudget/engine";
import { and, eq, exists, inArray, isNull, notInArray, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FxDeps } from "../../lib/base-amount";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import { type Db, transferPayeeId } from "../../lib/ledger";
import { notePayeeCategorizations } from "../../lib/payee-categories";
import { isRevaluationPayee } from "../../lib/revaluation";
import { setApproval } from "../../lib/review";
import { assertTransactionVersions, transactionVersions } from "../../lib/versions";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { applyUpdate, deleteWithTransfers, insertNewTransaction, searchSettings } from "./handlers";
import {
  matchingTransactions,
  queryRegisterRows,
  type RegisterFilter,
  type SearchSettings,
} from "./register-query";
import type { bulkUpdateTransactions, summarizeSelection } from "./routes";
import {
  type AccountRow,
  usesCategory as accountUsesCategory,
  assertOpen,
  assertSameCurrency,
  findAccount,
  lockTransaction,
  resolveCategory,
} from "./rules";

type Env = AppEnv & AuthedEnv;

export type Selection = { ids: string[] } | { filter: RegisterFilter; exclude: string[] };

export function selectedWhere(
  db: Db,
  budgetId: string,
  selection: Selection,
  settings: SearchSettings,
): SQL {
  if ("ids" in selection) {
    return and(eq(transaction.budgetId, budgetId), inArray(transaction.id, selection.ids)) as SQL;
  }
  const matching = matchingTransactions(db, budgetId, selection.filter, settings);
  return and(
    eq(transaction.budgetId, budgetId),
    inArray(transaction.id, db.select({ id: matching.id }).from(matching)),
    selection.exclude.length > 0 ? notInArray(transaction.id, selection.exclude) : undefined,
  ) as SQL;
}

/** The filtered register's account (checked to be the budget's), or null for all accounts. */
export async function checkFilterAccount(db: Db, budgetId: string, selection: Selection) {
  if ("filter" in selection && selection.filter.accountId) {
    return findAccount(db, budgetId, selection.filter.accountId);
  }
  return null;
}

function selectedRows(db: Db, where: SQL) {
  const transferAccount = alias(budgetAccount, "transfer_account");
  const linePayee = alias(payee, "line_payee");
  return db
    .select({
      id: transaction.id,
      amount: transaction.amount,
      currency: transaction.currency,
      cleared: transaction.cleared,
      approved: transaction.approved,
      transferTransactionId: transaction.transferTransactionId,
      accountType: budgetAccount.type,
      transferAccountType: transferAccount.type,
      fromSplit: sql<boolean>`${transaction.transferSubTransactionId} is not null`,
      // The other side of its transfer, or of one of its split lines' transfers, is reconciled.
      reconciledTransfer: sql<boolean>`exists (
        select 1 from ${transaction} other_side
        where other_side.cleared = 'reconciled' and (
          other_side.id = ${transaction.transferTransactionId}
          or other_side.transfer_sub_transaction_id in (
            select ${subTransaction.id} from ${subTransaction}
            where ${subTransaction.transactionId} = ${transaction.id}
          )
        )
      )`,
      isSplit: sql<boolean>`${exists(
        db
          .select({ one: sql`1` })
          .from(subTransaction)
          .where(eq(subTransaction.transactionId, transaction.id)),
      )}`,
      hasTransferLine: sql<boolean>`${exists(
        db
          .select({ one: sql`1` })
          .from(subTransaction)
          .innerJoin(linePayee, eq(linePayee.id, subTransaction.payeeId))
          .where(
            and(
              eq(subTransaction.transactionId, transaction.id),
              sql`${linePayee.transferAccountId} is not null`,
            ),
          ),
      )}`,
    })
    .from(transaction)
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .leftJoin(payee, eq(payee.id, transaction.payeeId))
    .leftJoin(transferAccount, eq(transferAccount.id, payee.transferAccountId))
    .where(where);
}

type SelectedRow = Awaited<ReturnType<typeof selectedRows>>[number];

/** Transfers within the budget and tracking-account rows have no category. */
function categorizable(row: SelectedRow) {
  return row.isSplit || usesCategory(row.accountType, row.transferAccountType);
}

export const summarizeSelectionHandler: RouteHandler<typeof summarizeSelection, Env> = async (
  c,
) => {
  const { budgetId } = c.req.valid("param");
  const { selection } = c.req.valid("json");
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  const settings = await searchSettings(
    db,
    budgetId,
    budget,
    await checkFilterAccount(db, budgetId, selection),
  );
  const rows = await selectedRows(db, selectedWhere(db, budgetId, selection, settings));
  const count = (test: (row: SelectedRow) => boolean) => rows.filter(test).length;
  // Amounts in different currencies don't add up.
  const currency = new Set(rows.map((r) => r.currency)).size === 1 ? rows[0]?.currency : null;
  return c.json(
    {
      count: rows.length,
      total: currency ? rows.reduce((sum, r) => sum + r.amount, 0n).toString() : "0",
      currency: currency ?? null,
      uncleared: count((r) => r.cleared === "uncleared"),
      cleared: count((r) => r.cleared === "cleared"),
      reconciled: count((r) => r.cleared === "reconciled"),
      reconciledTransfers: count((r) => r.reconciledTransfer && !r.fromSplit),
      categorizable: count(categorizable),
      unapproved: count((r) => !r.approved),
      splits: count((r) => r.isSplit),
      splitsWithTransfers: count((r) => r.isSplit && r.hasTransferLine),
      deletable: count((r) => !r.fromSplit),
    },
    200,
  );
};

export const bulkUpdateTransactionsHandler: RouteHandler<
  typeof bulkUpdateTransactions,
  Env
> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { selection, action, expectedVersions } = c.req.valid("json");
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(
    c,
    budgetId,
    action.type === "delete" || action.type === "reject"
      ? { transaction: ["delete"] }
      : action.type === "duplicate"
        ? { transaction: ["create"] }
        : { transaction: ["update"] },
  );
  const settings = await searchSettings(
    db,
    budgetId,
    budget,
    await checkFilterAccount(db, budgetId, selection),
  );

  const result = await db.transaction(async (tx) => {
    // Lock the selection before reading what the actions below check.
    const where = selectedWhere(tx, budgetId, selection, settings);
    const locked = await tx
      .select({ id: transaction.id })
      .from(transaction)
      .where(where)
      .orderBy(transaction.id)
      .for("update");
    await assertTransactionVersions(tx, budgetId, expectedVersions, c.var.user.id);
    if (locked.length === 0) {
      return {
        updated: 0,
        before: [],
        created: [],
        copies: [],
        previousVersions: {},
        versions: {},
      };
    }
    const lockedIds = locked.map((r) => r.id);
    const beforeRows = await queryRegisterRows(tx, budgetId, lockedIds);
    const beforeById = new Map(beforeRows.map((row) => [row.id, row]));
    const previousVersions = await transactionVersions(tx, lockedIds);
    const rows = await selectedRows(tx, selectedIds(lockedIds));

    let updatedIds: string[];
    switch (action.type) {
      case "cleared": {
        const ids = rows.filter((r) => r.cleared !== "reconciled").map((r) => r.id);
        if (ids.length > 0) {
          await tx.update(transaction).set({ cleared: action.cleared }).where(selectedIds(ids));
        }
        await approve(tx, rows, ids);
        updatedIds = ids;
        break;
      }
      case "approve":
        updatedIds = await approve(
          tx,
          rows,
          rows.map((r) => r.id),
        );
        break;
      case "reject":
        // Reject deletes the unapproved rows; on a mixed selection the approved rows stay.
        updatedIds = await remove(
          tx,
          budgetId,
          rows.filter((r) => !r.approved).map((r) => r.id),
        );
        break;
      case "flag":
        await tx.update(transaction).set({ flag: action.flag }).where(selectedIds(lockedIds));
        updatedIds = lockedIds;
        break;
      case "memo":
        await tx.update(transaction).set({ memo: action.memo }).where(selectedIds(lockedIds));
        updatedIds = lockedIds;
        break;
      case "categorize":
        updatedIds = await categorize(tx, budgetId, rows, action.categoryId);
        await approve(tx, rows, updatedIds);
        break;
      case "move":
        updatedIds = await move(tx, c.var.deps, budgetId, lockedIds, action.accountId);
        break;
      case "delete":
        updatedIds = await remove(tx, budgetId, lockedIds);
        break;
      case "duplicate": {
        const { created, copies } = await duplicate(tx, c.var.deps, budgetId, lockedIds);
        return {
          updated: created.length,
          before: [],
          created,
          copies,
          previousVersions: {},
          versions: {},
        };
      }
    }
    return {
      updated: updatedIds.length,
      before: updatedIds.flatMap((id) => {
        const row = beforeById.get(id);
        return row ? [row] : [];
      }),
      created: [],
      copies: [],
      previousVersions,
      versions: await transactionVersions(tx, updatedIds),
    };
  });
  return c.json(result, 200);
};

/**
 * Splits are un-split, unless they have a transfer line; those stay split and every other line
 * takes the category. Rows without a category are skipped.
 */
async function categorize(tx: Db, budgetId: string, rows: SelectedRow[], categoryId: string) {
  const [target] = await tx
    .select({ linkedAccountId: category.linkedAccountId })
    .from(category)
    .where(and(eq(category.id, categoryId), eq(category.budgetId, budgetId)));
  if (!target) throw new AppError(400, "BAD_REQUEST", "No such category in this budget");
  if (target.linkedAccountId) {
    throw new AppError(
      400,
      "CATEGORY_NOT_ALLOWED",
      "Credit card payment categories can't be used on transactions",
    );
  }
  const keepSplit = rows.filter((r) => r.isSplit && r.hasTransferLine).map((r) => r.id);
  const unsplit = rows.filter((r) => r.isSplit && !r.hasTransferLine).map((r) => r.id);
  const plain = rows.filter((r) => !r.isSplit && categorizable(r)).map((r) => r.id);
  if (keepSplit.length > 0) {
    const transferPayees = tx
      .select({ id: payee.id })
      .from(payee)
      .where(sql`${payee.transferAccountId} is not null`);
    await tx
      .update(subTransaction)
      .set({ categoryId })
      .where(
        and(
          sql`${subTransaction.transactionId} = any(${sql.param(keepSplit)}::text[])`,
          or(isNull(subTransaction.payeeId), notInArray(subTransaction.payeeId, transferPayees)),
        ),
      );
  }
  if (unsplit.length > 0) {
    await tx
      .delete(subTransaction)
      .where(sql`${subTransaction.transactionId} = any(${sql.param(unsplit)}::text[])`);
  }
  const categorized = [...unsplit, ...plain];
  if (categorized.length > 0) {
    await tx.update(transaction).set({ categoryId }).where(selectedIds(categorized));
    // Categorizing is an edit: it updates the payees' auto-categorization defaults.
    await notePayeeCategorizations(tx, budgetId, categorized);
  }
  return [...keepSplit, ...categorized];
}

/**
 * Approves the unapproved rows among `ids`, with their transfers' other sides, split transfer
 * lines' included (approving one side approves both). Returns the rows it approved.
 */
async function approve(tx: Db, rows: readonly SelectedRow[], ids: readonly string[]) {
  const wanted = new Set(ids);
  const unapproved = rows.filter((r) => wanted.has(r.id) && !r.approved);
  if (unapproved.length === 0) return [];
  const approved = unapproved.map((r) => r.id);
  await setApproval(tx, approved, true);
  return approved;
}

/**
 * Moves each row as a single edit would. Skipped: rows already in the account,
 * transfers into their own other account, and splits with a transfer line to it.
 */
async function move(
  tx: Db,
  fx: FxDeps,
  budgetId: string,
  ids: readonly string[],
  accountId: string,
) {
  const target = await findAccount(tx, budgetId, accountId);
  assertOpen(target);
  const moved: string[] = [];
  for (const id of ids) {
    // Read afresh: an earlier move in this loop may have changed it (both sides of a transfer).
    const row = await lockTransaction(tx, budgetId, id);
    if (!row || row.accountId === target.id) continue;
    if (row.transferSubTransactionId) {
      if (await moveSplitTransferSide(tx, budgetId, row, target)) moved.push(id);
      continue;
    }
    if (row.transferTransactionId) {
      const other = await lockTransaction(tx, budgetId, row.transferTransactionId);
      if (other?.accountId === target.id) continue;
    }
    if (await hasTransferLineTo(tx, row.id, target.id)) continue;
    await applyUpdate(tx, fx, budgetId, row.id, { accountId: target.id });
    moved.push(id);
  }
  return moved;
}

async function hasTransferLineTo(tx: Db, splitId: string, accountId: string) {
  const [line] = await tx
    .select({ id: subTransaction.id })
    .from(subTransaction)
    .innerJoin(payee, eq(payee.id, subTransaction.payeeId))
    .where(and(eq(subTransaction.transactionId, splitId), eq(payee.transferAccountId, accountId)))
    .limit(1);
  return Boolean(line);
}

/**
 * Moves the other side of a split's transfer line: the line then transfers to `target`. Not
 * into the split's own account (it would transfer to itself).
 */
async function moveSplitTransferSide(
  tx: Db,
  budgetId: string,
  side: typeof transaction.$inferSelect,
  target: AccountRow,
) {
  const [line] = await tx
    .select({
      id: subTransaction.id,
      categoryId: subTransaction.categoryId,
      splitAccountId: transaction.accountId,
    })
    .from(subTransaction)
    .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
    .where(eq(subTransaction.id, side.transferSubTransactionId ?? ""));
  if (!line || line.splitAccountId === target.id) return false;
  const splitAccount = await findAccount(tx, budgetId, line.splitAccountId);
  // Its amount is in its own account's currency.
  assertSameCurrency(await findAccount(tx, budgetId, side.accountId), target, "move");
  const keepLine = accountUsesCategory(splitAccount, target) ? line.categoryId : null;
  await tx
    .update(subTransaction)
    .set({
      payeeId: await transferPayeeId(tx, target),
      categoryId: await resolveCategory(tx, budgetId, splitAccount, target, keepLine),
    })
    .where(eq(subTransaction.id, line.id));
  const keepSide = accountUsesCategory(target, splitAccount) ? side.categoryId : null;
  await tx
    .update(transaction)
    .set({
      accountId: target.id,
      currency: target.currency,
      categoryId: await resolveCategory(tx, budgetId, target, splitAccount, keepSide),
    })
    .where(eq(transaction.id, side.id));
  return true;
}

/**
 * Deletes each row with its transfer's other side (or a split's lines' ones). The other sides of
 * splits' transfer lines are skipped: they go with their split.
 */
async function remove(tx: Db, budgetId: string, ids: readonly string[]) {
  const deleted: string[] = [];
  for (const id of ids) {
    // Gone already when it was the other side of a transfer deleted earlier in this loop.
    const row = await lockTransaction(tx, budgetId, id);
    if (!row || row.transferSubTransactionId) continue;
    await deleteWithTransfers(tx, row);
    deleted.push(id);
  }
  return deleted;
}

/**
 * A copy of each row, same date and fields, cleared state kept (a reconciled
 * one comes back cleared) and approved; a transfer gets a new other side. A split's transfer side
 * copies its split; a transfer picked from both sides is copied once. Rows that would add a
 * transaction to a closed account are skipped. Returns the copies' ids (`created`; deleting one
 * takes its other sides along) and, in `copies`, each copy row whose original row was selected,
 * so both sides of a transfer's copy are selected when both sides were.
 */
async function duplicate(tx: Db, fx: FxDeps, budgetId: string, ids: readonly string[]) {
  const created: string[] = [];
  const copies: string[] = [];
  const made: [Awaited<ReturnType<typeof queryRegisterRows>>[number], string][] = [];
  const selected = new Set(ids);
  const done = new Set<string>();
  for (const id of ids) {
    const row = await lockTransaction(tx, budgetId, id);
    if (!row) continue;
    let sourceId = row.id;
    if (row.transferSubTransactionId) {
      const [line] = await tx
        .select({ splitId: subTransaction.transactionId })
        .from(subTransaction)
        .where(eq(subTransaction.id, row.transferSubTransactionId));
      if (!line) continue;
      sourceId = line.splitId;
    }
    if (done.has(sourceId) || (row.transferTransactionId && done.has(row.transferTransactionId))) {
      continue;
    }
    done.add(sourceId);
    const [source] = await queryRegisterRows(tx, budgetId, [sourceId]);
    if (!source) continue;
    // A revaluation's copy would book nothing (amount 0): revalue the account instead.
    if (await isRevaluationPayee(tx, source.payeeId)) continue;
    const accountIds = [
      source.accountId,
      source.transferAccountId,
      ...source.subtransactions.map((l) => l.transferAccountId),
    ].filter((a): a is string => a !== null);
    const accounts = await tx
      .select({ closed: budgetAccount.closed })
      .from(budgetAccount)
      .where(inArray(budgetAccount.id, accountIds));
    if (accounts.some((a) => a.closed)) continue;
    const split = source.subtransactions.length > 0;
    const copyId = await insertNewTransaction(tx, fx, budgetId, {
      accountId: source.accountId,
      date: source.date,
      // A typed rate is copied; otherwise the copy takes the date's rate, as the original did.
      fxRate: source.fxRateManual ? source.fxRate : undefined,
      amount: source.amount,
      ...(source.transferAccountId
        ? {
            payeeName: null,
            transferAccountId: source.transferAccountId,
            // Between currencies the other side's own amount is copied too.
            transferAmount: crossAmount(source.currency, source.transferSide),
          }
        : { payeeName: source.payeeName }),
      categoryId: split ? null : source.categoryId,
      memo: source.memo,
      cleared: source.cleared === "reconciled" ? "cleared" : source.cleared,
      flag: source.flag,
      ...(split
        ? {
            subtransactions: source.subtransactions.map((l) => ({
              amount: l.amount,
              ...(l.transferAccountId
                ? {
                    payeeName: null,
                    transferAccountId: l.transferAccountId,
                    transferAmount: crossAmount(source.currency, l.transferSide),
                  }
                : { payeeName: l.payeeName }),
              categoryId: l.categoryId,
              memo: l.memo,
            })),
          }
        : {}),
    });
    created.push(copyId);
    made.push([source, copyId]);
  }
  // Every copy read in one query, after the loop.
  const copyRows = new Map(
    (await queryRegisterRows(tx, budgetId, created)).map((r) => [r.id, r] as const),
  );
  for (const [source, copyId] of made) {
    const copy = copyRows.get(copyId);
    if (!copy) continue;
    // Each row of the original against the same row of its copy: the transaction, its transfer's
    // other side and its lines' other sides (lines keep their order).
    const pairs: [string | null, string | null][] = [
      [source.id, copy.id],
      [source.transferTransactionId, copy.transferTransactionId],
      ...source.subtransactions.map((l, i): [string | null, string | null] => [
        l.transferTransactionId,
        copy.subtransactions[i]?.transferTransactionId ?? null,
      ]),
    ];
    for (const [original, row] of pairs) {
      if (original && row && selected.has(original)) copies.push(row);
    }
  }
  return { created, copies };
}

/** A transfer's other side's amount when it's in another currency (otherwise it follows). */
function crossAmount(
  currency: string,
  side: { amount: string; currency: string } | null,
): string | undefined {
  return side && side.currency !== currency ? side.amount : undefined;
}

/** One array parameter rather than one per id, so big selections stay one statement. */
function selectedIds(ids: readonly string[]) {
  return sql`${transaction.id} = any(${sql.param(ids)}::text[])`;
}
