import type { RouteHandler } from "@hono/zod-openapi";
import {
  budgetAccount,
  type ClearedState,
  type FlagColor,
  payee,
  subTransaction,
  transaction,
} from "@strictbudget/db/schema";
import { normalizeRate } from "@strictbudget/engine";
import { and, eq, inArray } from "drizzle-orm";
import { type FxDeps, oppositeSides, rebase, syncBases } from "../../lib/base-amount";
import { loadBudgetAccess } from "../../lib/budget-access";
import { assertNotFuture, latestTransactionDate } from "../../lib/dates";
import { AppError } from "../../lib/errors";
import { rememberRename } from "../../lib/file-import";
import { prefetchRates } from "../../lib/fx";
import { type Db, findOrCreatePayee, insertTransaction, transferPayeeId } from "../../lib/ledger";
import { notePayeeCategorizations } from "../../lib/payee-categories";
import { assertRevaluationEditable, isRevaluationPayee } from "../../lib/revaluation";
import { setApproval } from "../../lib/review";
import { enterDueScheduled, entryDate } from "../../lib/scheduled";
import { assertTransactionVersions, transactionVersions } from "../../lib/versions";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { keepAttachment } from "./attachments";
import { parseSort, queryRegister, queryRegisterRow } from "./register-query";
import type {
  createTransaction,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from "./routes";
import {
  type AccountRow,
  assertOnePayee,
  assertOpen,
  assertSameCurrency,
  assertTransferPair,
  checkTransferAmount,
  clearedOnEntry,
  defaultOtherAmount,
  findAccount,
  insertOtherSide,
  lockTransaction,
  reconciledStays,
  resolveCategory,
  type TransferSideInput,
  transferInSplit,
  usesCategory,
} from "./rules";
import {
  assertLinesAddUp,
  assertSplitAllowed,
  deleteLineTransfers,
  type LineInput,
  splitLines,
  syncLines,
} from "./splits";

type Env = AppEnv & AuthedEnv;
/**
 * How a register's search reads amounts: in its account's currency, or for all accounts each
 * row's in its own account's (`currencies`: every currency the budget's accounts use).
 */
export async function searchSettings<S extends { currency: AccountRow["currency"] }>(
  db: Db,
  budgetId: string,
  budget: S,
  account: Pick<AccountRow, "currency"> | null,
): Promise<S & { currencies?: AccountRow["currency"][] }> {
  if (account) return { ...budget, currency: account.currency };
  const rows = await db
    .selectDistinct({ currency: budgetAccount.currency })
    .from(budgetAccount)
    .where(eq(budgetAccount.budgetId, budgetId));
  return { ...budget, currencies: rows.map((r) => r.currency) };
}

async function transactionJson(db: Db, budgetId: string, accountId: string, id: string) {
  const row = await queryRegisterRow(db, budgetId, accountId, id);
  if (!row) throw new AppError(404, "NOT_FOUND", "Transaction not found");
  return row;
}

export const listTransactionsHandler: RouteHandler<typeof listTransactions, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { sort, limit, cursor, today, ...filter } = c.req.valid("query");
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId);
  // The first page enters what's come due, so the register is current.
  if (today && !cursor)
    await enterDueScheduled(db, c.var.deps, budgetId, entryDate(c.var.deps, today));
  const account = filter.accountId ? await findAccount(db, budgetId, filter.accountId) : null;
  const page = await queryRegister(
    db,
    budgetId,
    { ...filter, today },
    { sort: parseSort(sort), limit, cursor },
    await searchSettings(db, budgetId, budget, account),
  );
  return c.json(page, 200);
};

export const createTransactionHandler: RouteHandler<typeof createTransaction, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const body = c.req.valid("json");
  const { today } = c.req.valid("query");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { transaction: ["create"] });
  // Future-dated entries are scheduled transactions. An undo restore brings a row
  // back as it was, so one dated ahead (older data, or the server's UTC + 1) isn't refused, as an
  // edit that keeps its date isn't.
  if (!body.restore) assertNotFuture(body.date, latestTransactionDate(c.var.deps, today));
  const { id, feeId } = await db.transaction((tx) => insertWithFee(tx, c.var.deps, budgetId, body));
  const row = await transactionJson(db, budgetId, body.accountId, id);
  return c.json({ ...row, feeTransactionId: feeId }, 201);
};

export interface CreateBody {
  accountId: string;
  date: string;
  amount: string;
  payeeName: string | null;
  transferAccountId?: string;
  categoryId: string | null;
  memo: string;
  subtransactions?: LineInput[];
  /** Left out: by the account (`clearedOnEntry`). */
  cleared?: ClearedState;
  flag: FlagColor | null;
  approved?: boolean;
  /** A restored transfer's other side, as it was. */
  transferSide?: TransferSideInput;
  /**
   * An undo bringing back a deleted transaction: its accounts may have been closed since. A
   * transfer into an account closed from elsewhere is restored too.
   */
  restore?: boolean;
  /** In a foreign-currency account: the rate typed by hand (otherwise the date's). */
  fxRate?: string | null;
  /** An undo restoring a deleted FX Revaluation: its booked base amount (with its `fxRate`). */
  baseAmount?: string;
  /**
   * A transfer between currencies: the other side's amount, in its account's currency
   * (otherwise this side's base amount at the date's rate).
   */
  transferAmount?: string | null;
  /** A transfer's fee: an outflow in the sending account, in its currency (positive). */
  fee?: { amount: string; categoryId: string | null };
}

/** A new transaction (with its transfer's other side and its split's lines); returns its id. */
export async function insertNewTransaction(tx: Db, fx: FxDeps, budgetId: string, body: CreateBody) {
  const { id } = await insertWithFee(tx, fx, budgetId, body);
  return id;
}

/** `insertNewTransaction`, plus a transfer's fee (`body.fee`); returns both ids. */
export async function insertWithFee(tx: Db, fx: FxDeps, budgetId: string, body: CreateBody) {
  assertOnePayee(body);
  const account = await findAccount(tx, budgetId, body.accountId);
  if (!body.restore) assertOpen(account);
  let transferTo: AccountRow | null = null;
  if (body.transferAccountId !== undefined) {
    transferTo = await findAccount(tx, budgetId, body.transferAccountId);
    assertTransferPair(account, transferTo);
    if (!body.restore) assertOpen(transferTo);
  } else if (body.transferSide) {
    throw new AppError(400, "BAD_REQUEST", "`transferSide` needs `transferAccountId`");
  }
  const amount = BigInt(body.amount);
  const transferAmount = checkTransferAmount(
    amount,
    body.transferAmount ?? body.transferSide?.amount,
    account,
    transferTo,
  );
  if (body.fee && !transferTo) {
    throw new AppError(400, "BAD_REQUEST", "A `fee` goes with a transfer");
  }
  const split = body.subtransactions;
  if (split) {
    if (transferTo) notSplittable();
    if (body.categoryId !== null) categoryOnSplit();
    assertSplitAllowed(account);
    assertLinesAddUp(split, amount);
  }
  // Rates are looked up before anything is written; zero converts without a rate.
  await prefetchRates(tx, fx, {
    budgetId,
    currencies: amount !== 0n || split ? [account.currency] : [],
    accountIds: [transferTo?.id, ...(split ?? []).map((l) => l.transferAccountId)],
    dates: [body.date],
  });
  const payeeId = transferTo
    ? await transferPayeeId(tx, transferTo)
    : body.payeeName
      ? await findOrCreatePayee(tx, budgetId, body.payeeName)
      : null;
  // An undo bringing back an FX Revaluation: its amount is 0, so only its booked base amount
  // says what it did.
  if (body.baseAmount !== undefined) {
    if (!body.restore || amount !== 0n || !(await isRevaluationPayee(tx, payeeId))) {
      throw new AppError(
        400,
        "BAD_REQUEST",
        "`baseAmount` only restores a deleted FX Revaluation (with `restore`)",
      );
    }
  }
  const id = await insertTransaction(tx, {
    budgetId,
    accountId: account.id,
    date: body.date,
    amount,
    currency: account.currency,
    ...(body.baseAmount !== undefined
      ? {
          baseAmount: BigInt(body.baseAmount),
          fxRate: body.fxRate ? normalizeRate(body.fxRate) : null,
        }
      : { fx, rate: body.fxRate, split: split !== undefined }),
    payeeId,
    categoryId: split
      ? null
      : await resolveCategory(tx, budgetId, account, transferTo, body.categoryId),
    memo: body.memo,
    cleared: body.cleared ?? clearedOnEntry(account),
    flag: body.flag,
    approved: body.approved,
  });
  if (split) {
    await syncLines(
      tx,
      {
        budgetId,
        parentId: id,
        date: body.date,
        account,
        moved: false,
        restore: body.restore,
        fx,
      },
      split,
    );
  }
  let feeId: string | null = null;
  if (transferTo) {
    await insertOtherSide(
      tx,
      { id, budgetId, date: body.date, amount, memo: body.memo },
      account,
      transferTo,
      { ...body.transferSide, transferAmount, fx },
    );
    if (body.fee) {
      feeId = await insertFee(tx, fx, budgetId, body.date, body.fee, amount, account, transferTo);
    }
  }
  await syncBases(tx, id);
  return { id, feeId };
}

/**
 * A transfer's fee: its own outflow in the sending account (the one the money
 * leaves; this one at zero), same date, in that account's currency and converted like any
 * transaction, payee and memo "Transfer fee", in the given category. It isn't linked to the
 * transfer.
 */
async function insertFee(
  tx: Db,
  fx: FxDeps,
  budgetId: string,
  date: string,
  fee: NonNullable<CreateBody["fee"]>,
  amount: bigint,
  account: AccountRow,
  transferTo: AccountRow,
) {
  const value = BigInt(fee.amount);
  if (value <= 0n) throw new AppError(400, "BAD_REQUEST", "Enter the fee as an amount above zero");
  const from = amount > 0n ? transferTo : account;
  return insertTransaction(tx, {
    budgetId,
    accountId: from.id,
    date,
    amount: -value,
    currency: from.currency,
    fx,
    payeeId: await findOrCreatePayee(tx, budgetId, FEE_TEXT),
    categoryId: await resolveCategory(tx, budgetId, from, null, fee.categoryId),
    memo: FEE_TEXT,
    cleared: clearedOnEntry(from),
  });
}

const FEE_TEXT = "Transfer fee";

export const updateTransactionHandler: RouteHandler<typeof updateTransaction, Env> = async (c) => {
  const { budgetId, transactionId } = c.req.valid("param");
  const body = c.req.valid("json");
  const { today } = c.req.valid("query");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { transaction: ["update"] });
  assertOnePayee(body);
  const latest = latestTransactionDate(c.var.deps, today);
  const { expectedVersion, ...changes } = body;
  let previousVersions: Record<string, number> = {};
  await prefetchUpdateRates(db, c.var.deps, budgetId, transactionId, changes);
  const accountId = await db.transaction(async (tx) => {
    if (expectedVersion !== undefined) {
      const expected = { [transactionId]: expectedVersion };
      await assertTransactionVersions(tx, budgetId, expected, c.var.user.id);
    }
    previousVersions = await transactionVersions(tx, [transactionId]);
    return applyUpdate(tx, c.var.deps, budgetId, transactionId, withApproval(changes), latest);
  });
  const row = await transactionJson(db, budgetId, accountId, transactionId);
  return c.json({ ...row, previousVersions }, 200);
};

/**
 * Saving an unapproved transaction's editor or clicking its cleared state approves it; setting
 * its flag doesn't. So any change but a flag approves, unless `approved` is given (an undo
 * restoring it unapproved).
 */
function withApproval(body: UpdateBody): UpdateBody {
  if (body.approved !== undefined) return body;
  const edits = Object.entries(body).some(([key, value]) => key !== "flag" && value !== undefined);
  return edits ? { ...body, approved: true } : body;
}

export interface UpdateBody {
  accountId?: string;
  date?: string;
  amount?: string;
  payeeName?: string | null;
  transferAccountId?: string;
  categoryId?: string | null;
  memo?: string;
  cleared?: "uncleared" | "cleared";
  flag?: FlagColor | null;
  subtransactions?: LineInput[];
  /** A transfer's other side follows a change (both sides are approved together). */
  approved?: boolean;
  /**
   * In a foreign-currency account: a rate typed by hand, or null to go back to the date's rate.
   * Left out, the rate stays (see `rebase`).
   */
  fxRate?: string | null;
  /**
   * A transfer between currencies: the other side's amount in its account's currency, or null
   * for this side's base amount at the date's rate. Left out, the other side keeps its amount.
   */
  transferAmount?: string | null;
}

/**
 * Looks up the rates an edit that converts again may need, before `applyUpdate` locks the row:
 * the accounts it touches, at its date. A memo, flag or cleared edit needs none.
 */
export async function prefetchUpdateRates(
  db: Db,
  fx: FxDeps,
  budgetId: string,
  transactionId: string,
  body: UpdateBody,
) {
  const { accountId, date, amount, transferAccountId, subtransactions, fxRate } = body;
  const converts = [accountId, date, amount, transferAccountId, subtransactions, fxRate];
  if (converts.every((v) => v === undefined) && !body.transferAmount) return;
  const [existing] = await db
    .select({
      accountId: transaction.accountId,
      date: transaction.date,
      transferTransactionId: transaction.transferTransactionId,
    })
    .from(transaction)
    .where(and(eq(transaction.id, transactionId), eq(transaction.budgetId, budgetId)));
  if (!existing) return;
  const [other] = existing.transferTransactionId
    ? await db
        .select({ accountId: transaction.accountId })
        .from(transaction)
        .where(eq(transaction.id, existing.transferTransactionId))
    : [];
  // A split edited without new lines converts its current ones again.
  const currentLines = subtransactions
    ? []
    : await db
        .select({ accountId: payee.transferAccountId })
        .from(subTransaction)
        .innerJoin(payee, eq(payee.id, subTransaction.payeeId))
        .where(eq(subTransaction.transactionId, transactionId));
  await prefetchRates(db, fx, {
    budgetId,
    accountIds: [
      accountId ?? existing.accountId,
      transferAccountId,
      other?.accountId,
      ...(subtransactions ?? []).map((l) => l.transferAccountId),
      ...currentLines.map((l) => l.accountId),
    ],
    dates: [date ?? existing.date],
  });
}

/** One transaction's edit (as `updateTransaction` describes it); returns its account. */
export async function applyUpdate(
  tx: Db,
  fx: FxDeps,
  budgetId: string,
  transactionId: string,
  body: UpdateBody,
  /** The latest date it may be moved to (see `latestTransactionDate`); null for no limit. */
  latestDate: string | null = null,
) {
  const existing = await lockTransaction(tx, budgetId, transactionId);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Transaction not found");
  // Only a new date is checked, so a row already dated ahead (older data) can still be edited.
  if (body.date !== undefined && body.date !== existing.date)
    assertNotFuture(body.date, latestDate);
  if (existing.cleared === "reconciled" && body.cleared !== undefined) reconciledStays();
  // A revaluation keeps its base amount: converting its zero amount again would erase it.
  const revaluation = await assertRevaluationEditable(tx, existing, body);
  if (existing.transferSubTransactionId) {
    return updateSplitTransferSide(tx, budgetId, existing, body);
  }
  const other = existing.transferTransactionId
    ? await lockTransaction(tx, budgetId, existing.transferTransactionId)
    : undefined;

  const moved = body.accountId !== undefined && body.accountId !== existing.accountId;
  const account = await findAccount(tx, budgetId, body.accountId ?? existing.accountId);
  if (moved) {
    assertOpen(account);
    assertSameCurrency(await findAccount(tx, budgetId, existing.accountId), account, "move");
  }

  // The account the other side belongs in: unchanged unless the payee changes.
  const targetId =
    body.transferAccountId ?? (body.payeeName !== undefined ? null : (other?.accountId ?? null));
  const retargeted = targetId !== (other?.accountId ?? null);
  let transferTo: AccountRow | null = null;
  if (targetId !== null) {
    transferTo = await findAccount(tx, budgetId, targetId);
    assertTransferPair(account, transferTo);
    if (retargeted) {
      assertOpen(account);
      assertOpen(transferTo);
    }
  }

  const amount = body.amount === undefined ? existing.amount : BigInt(body.amount);
  const transferAmount = checkTransferAmount(amount, body.transferAmount, account, transferTo);
  if (body.transferAmount === null && !transferTo) {
    throw new AppError(400, "BAD_REQUEST", "`transferAmount` is for transfers only");
  }
  // A reconciled other side follows the edit and stays reconciled: the warning before saving is
  // the client's.

  // A split stays one until it gets a category (or becomes a transfer); see `syncLines`.
  const existingLines = await splitLines(tx, transactionId);
  const wasSplit = existingLines.length > 0;
  const lines = body.subtransactions;
  if (lines && body.categoryId !== undefined) categoryOnSplit();
  const unsplit = wasSplit && !lines && (body.categoryId !== undefined || transferTo !== null);
  const split = lines !== undefined || (wasSplit && !unsplit);
  if (split) {
    if (transferTo) notSplittable();
    assertSplitAllowed(account);
    if (lines) assertLinesAddUp(lines, amount);
    else
      assertLinesAddUp(
        existingLines.map((l) => ({ amount: l.amount.toString() })),
        amount,
      );
  }

  let categoryId = existing.categoryId;
  if (split) {
    categoryId = null;
  } else if (body.categoryId !== undefined) {
    categoryId = await resolveCategory(tx, budgetId, account, transferTo, body.categoryId);
  } else if (moved || retargeted) {
    // Keep the category if it can still be used, otherwise fall back.
    const keep = usesCategory(account, transferTo) ? existing.categoryId : null;
    categoryId = await resolveCategory(tx, budgetId, account, transferTo, keep);
  }

  // Only what the base amount depends on converts it again; a memo, flag or cleared edit keeps
  // the booked amount (an implied or looked-up rate would round it differently).
  const rebased =
    amount !== existing.amount ||
    (body.date ?? existing.date) !== existing.date ||
    account.id !== existing.accountId ||
    body.fxRate !== undefined;
  const base =
    revaluation || !rebased
      ? {}
      : await rebase(tx, fx, existing, {
          currency: account.currency,
          date: body.date ?? existing.date,
          amount,
          rate: body.fxRate,
        });
  const payeeId = transferTo
    ? await transferPayeeId(tx, transferTo)
    : body.payeeName === undefined
      ? undefined
      : body.payeeName === null
        ? null
        : await findOrCreatePayee(tx, budgetId, body.payeeName);
  await tx
    .update(transaction)
    .set({
      accountId: account.id,
      currency: account.currency,
      date: body.date,
      amount,
      ...base,
      payeeId,
      categoryId,
      memo: body.memo,
      cleared: body.cleared,
      flag: body.flag,
      approved: body.approved,
      transferTransactionId: transferTo ? undefined : null,
    })
    .where(eq(transaction.id, transactionId));
  // Moving an imported transaction to another payee makes a renaming rule, so the next import of
  // that name lands on it.
  if (
    payeeId &&
    !transferTo &&
    payeeId !== existing.payeeId &&
    existing.importedPayee &&
    !existing.matchedImport
  ) {
    await rememberRename(tx, budgetId, payeeId, existing.importedPayee);
  }
  if (body.approved !== undefined && body.approved !== existing.approved) {
    // The other sides follow, a split's transfer lines' counterparts included.
    await setApproval(tx, [transactionId], body.approved);
  }

  if (split || wasSplit) {
    await syncLines(
      tx,
      { budgetId, parentId: transactionId, date: body.date ?? existing.date, account, moved, fx },
      unsplit ? [] : lines,
    );
  }

  if (other && !transferTo) {
    // The transfer's attachment stays with this side.
    await keepAttachment(tx, other.id, transactionId);
    await tx.delete(transaction).where(eq(transaction.id, other.id));
  } else if (other && transferTo) {
    // Between currencies the other side keeps its own amount unless it's given,
    // cleared (null: the date's rate), or no longer fits (another currency, or the same way).
    let otherAmount = -amount;
    if (account.currency !== transferTo.currency) {
      const keep =
        body.transferAmount !== null &&
        other.currency === transferTo.currency &&
        oppositeSides(amount, other.amount);
      otherAmount =
        transferAmount ??
        (keep
          ? other.amount
          : amount === 0n
            ? 0n
            : await defaultOtherAmount(tx, fx, transactionId, transferTo.currency));
    }
    // Date, amount and memo are shared; cleared, flag and category stay per side. A memo edit on
    // either side is copied to the other; only a changed memo is copied, so saving a row leaves a
    // memo set apart by the bulk Memo action alone.
    const keep = usesCategory(transferTo, account) ? other.categoryId : null;
    await tx
      .update(transaction)
      .set({
        accountId: transferTo.id,
        currency: transferTo.currency,
        date: body.date,
        amount: otherAmount,
        payeeId: moved ? await transferPayeeId(tx, account) : undefined,
        categoryId:
          moved || retargeted
            ? await resolveCategory(tx, budgetId, transferTo, account, keep)
            : undefined,
        memo: body.memo !== undefined && body.memo !== existing.memo ? body.memo : undefined,
        // Approving one side approves the other; an undo takes both back.
        approved:
          body.approved !== undefined && body.approved !== existing.approved
            ? body.approved
            : undefined,
      })
      .where(eq(transaction.id, other.id));
  } else if (transferTo) {
    await insertOtherSide(
      tx,
      {
        id: transactionId,
        budgetId,
        date: body.date ?? existing.date,
        amount,
        memo: body.memo ?? existing.memo,
      },
      account,
      transferTo,
      { transferAmount, fx },
    );
  }
  await syncBases(tx, transactionId);
  // An edit updates the payee's auto-categorization default.
  await notePayeeCategorizations(tx, budgetId, [transactionId]);
  return account.id;
}

export const deleteTransactionHandler: RouteHandler<typeof deleteTransaction, Env> = async (c) => {
  const { budgetId, transactionId } = c.req.valid("param");
  const { expectedVersion } = c.req.valid("query");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { transaction: ["delete"] });
  await db.transaction(async (tx) => {
    if (expectedVersion !== undefined) {
      const expected = { [transactionId]: expectedVersion };
      await assertTransactionVersions(tx, budgetId, expected, c.var.user.id);
    }
    const existing = await lockTransaction(tx, budgetId, transactionId);
    if (!existing) throw new AppError(404, "NOT_FOUND", "Transaction not found");
    if (existing.transferSubTransactionId) transferInSplit();
    await deleteWithTransfers(tx, existing);
  });
  return c.body(null, 204);
};

/** Deletes a transaction with its transfer's other side, or a split with its lines' ones. */
export async function deleteWithTransfers(tx: Db, existing: typeof transaction.$inferSelect) {
  await deleteLineTransfers(tx, existing.id);
  const ids = [existing.id];
  if (existing.transferTransactionId) ids.push(existing.transferTransactionId);
  await tx.delete(transaction).where(inArray(transaction.id, ids));
}

function notSplittable(): never {
  throw new AppError(
    400,
    "SPLIT_NOT_ALLOWED",
    "A transfer can't be split. Make the split's lines transfers instead.",
  );
}

function categoryOnSplit(): never {
  throw new AppError(
    400,
    "BAD_REQUEST",
    "A split's categories go on its lines; give either `categoryId` or `subtransactions`",
  );
}

/**
 * The other side of a split's transfer line: the split owns its date, amount, account and payee,
 * so only memo, cleared and (where one applies) the category change here. The memo is shared
 * with the line.
 */
async function updateSplitTransferSide(
  tx: Db,
  budgetId: string,
  existing: typeof transaction.$inferSelect,
  body: UpdateBody,
) {
  const locked =
    (body.accountId !== undefined && body.accountId !== existing.accountId) ||
    (body.date !== undefined && body.date !== existing.date) ||
    (body.amount !== undefined && BigInt(body.amount) !== existing.amount) ||
    body.payeeName !== undefined ||
    body.transferAccountId !== undefined ||
    body.subtransactions !== undefined;
  if (locked) transferInSplit();
  const account = await findAccount(tx, budgetId, existing.accountId);
  const [line] = await tx
    .select({ accountId: transaction.accountId })
    .from(subTransaction)
    .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
    .where(eq(subTransaction.id, existing.transferSubTransactionId ?? ""));
  const splitAccount = line ? await findAccount(tx, budgetId, line.accountId) : null;
  await tx
    .update(transaction)
    .set({
      categoryId:
        body.categoryId === undefined
          ? undefined
          : await resolveCategory(tx, budgetId, account, splitAccount, body.categoryId),
      memo: body.memo,
      cleared: body.cleared,
      flag: body.flag,
      approved: body.approved,
    })
    .where(eq(transaction.id, existing.id));
  if (body.approved !== undefined && body.approved !== existing.approved) {
    // Approving a split's transfer side approves the split (and its other transfer lines).
    await setApproval(tx, [existing.id], body.approved);
  }
  if (body.memo !== undefined && body.memo !== existing.memo && existing.transferSubTransactionId) {
    await tx
      .update(subTransaction)
      .set({ memo: body.memo })
      .where(eq(subTransaction.id, existing.transferSubTransactionId));
  }
  return account.id;
}
