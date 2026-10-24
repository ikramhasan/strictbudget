import {
  budgetAccount,
  type ClearedState,
  category,
  type FlagColor,
  transaction,
} from "@strictbudget/db/schema";
import { isOnBudget, usesCategory as usesAccountCategory } from "@strictbudget/engine";
import { and, eq } from "drizzle-orm";
import { budgetCurrencyOf, type FxDeps, otherSideAmount, syncBases } from "../../lib/base-amount";
import { AppError } from "../../lib/errors";
import { type Db, insertTransaction, internalCategoryId, transferPayeeId } from "../../lib/ledger";

export type AccountRow = typeof budgetAccount.$inferSelect;

export async function findAccount(db: Db, budgetId: string, accountId: string) {
  const [row] = await db
    .select()
    .from(budgetAccount)
    .where(and(eq(budgetAccount.id, accountId), eq(budgetAccount.budgetId, budgetId)));
  if (!row) throw new AppError(404, "NOT_FOUND", "Account not found");
  return row;
}

export function assertOpen(account: AccountRow) {
  if (account.closed) {
    throw new AppError(
      400,
      "ACCOUNT_CLOSED",
      `Reopen ${account.name} to add transactions or transfers to it`,
    );
  }
}

export function usesCategory(account: AccountRow, transferTo: AccountRow | null) {
  return usesAccountCategory(account.type, transferTo?.type);
}

/**
 * The category a transaction in `account` (a transfer if `transferTo` is set) is stored with:
 * budget accounts fall back to Uncategorized, and payment categories only receive money by
 * assigning, never from a transaction.
 */
export async function resolveCategory(
  db: Db,
  budgetId: string,
  account: AccountRow,
  transferTo: AccountRow | null,
  categoryId: string | null,
) {
  if (!usesCategory(account, transferTo)) {
    if (categoryId !== null) {
      throw new AppError(
        400,
        "CATEGORY_NOT_ALLOWED",
        isOnBudget(account.type)
          ? "Transfers between budget accounts don't use categories"
          : "Tracking accounts don't use categories",
      );
    }
    return null;
  }
  if (categoryId === null) return internalCategoryId(db, budgetId, "uncategorized");
  const [row] = await db
    .select({ linkedAccountId: category.linkedAccountId })
    .from(category)
    .where(and(eq(category.id, categoryId), eq(category.budgetId, budgetId)));
  if (!row) throw new AppError(400, "BAD_REQUEST", "No such category in this budget");
  if (row.linkedAccountId) {
    throw new AppError(
      400,
      "CATEGORY_NOT_ALLOWED",
      "Credit card payment categories can't be used on transactions",
    );
  }
  return categoryId;
}

/**
 * Whether `account` may transfer to `transferTo`: not itself. Transfers between currencies are
 * fine, except where `sameCurrency` asks (scheduled transfers).
 */
export function assertTransferPair(
  account: AccountRow,
  transferTo: AccountRow,
  sameCurrency = false,
) {
  if (transferTo.id === account.id) {
    throw new AppError(400, "TRANSFER_SAME_ACCOUNT", "An account can't transfer to itself");
  }
  if (sameCurrency) assertSameCurrency(account, transferTo, "transfer");
}

/**
 * Moving a transaction into an account in another currency (its amount would change meaning)
 * isn't supported; nor are scheduled transfers and loan payments between currencies.
 */
export function assertSameCurrency(
  from: Pick<AccountRow, "name" | "currency">,
  to: Pick<AccountRow, "name" | "currency">,
  action: "transfer" | "move",
) {
  if (from.currency === to.currency) return;
  throw new AppError(
    422,
    action === "transfer" ? "CROSS_CURRENCY_TRANSFER" : "CROSS_CURRENCY_MOVE",
    `${from.name} (${from.currency}) and ${to.name} (${to.currency}) use different currencies; ` +
      (action === "transfer"
        ? "scheduled transfers and loan payments between currencies aren't supported yet"
        : "transactions can't be moved between currencies yet"),
  );
}

export function assertOnePayee(body: { payeeName?: string | null; transferAccountId?: string }) {
  if (body.transferAccountId !== undefined && body.payeeName != null) {
    throw new AppError(400, "BAD_REQUEST", "Give a payee name or a transfer account, not both");
  }
}

/**
 * How a new transaction starts out in `account`: uncleared, except in cash accounts, where it's
 * cleared. Each side of a transfer follows its own account, whichever side it was entered from.
 */
export function clearedOnEntry(account: Pick<AccountRow, "type">): ClearedState {
  return account.type === "cash" ? "cleared" : "uncleared";
}

/** How the other side of a new transfer starts out (by default by its account, and approved). */
export interface OtherSideOptions {
  /** The other side's category, when the transfer's category belongs on that side. */
  categoryId?: string | null;
  cleared?: ClearedState;
  approved?: boolean;
  flag?: FlagColor | null;
  /** Its own memo (by default the new side's). */
  memo?: string;
  /**
   * Between currencies: its amount in its account's currency (see `checkTransferAmount`); left
   * out, this side's base amount at the date's rate, which needs `fx`.
   */
  transferAmount?: bigint;
  fx?: FxDeps;
}

/**
 * A deleted transfer's other side as it was, so an undo brings it back exactly (both sides keep
 * their own cleared state and flag).
 */
export interface TransferSideInput {
  memo: string;
  cleared: ClearedState;
  flag: FlagColor | null;
  approved: boolean;
  categoryId: string | null;
  /** Its own amount in its account's currency (a transfer between currencies). */
  amount?: string;
}

/**
 * The other side's amount given for a transfer (`transferAmount`), checked: only between
 * currencies matters (in one currency it's always the opposite amount, so it must be that), and
 * it never goes the same way as `amount`. Returns what to use, or undefined for the default.
 */
export function checkTransferAmount(
  amount: bigint,
  given: string | null | undefined,
  account: Pick<AccountRow, "currency">,
  transferTo: Pick<AccountRow, "currency"> | null,
) {
  if (given === undefined || given === null) return undefined;
  const value = BigInt(given);
  if (!transferTo) {
    throw new AppError(400, "BAD_REQUEST", "`transferAmount` is for transfers only");
  }
  if (account.currency === transferTo.currency) {
    if (value !== -amount) {
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Between accounts in one currency the other side's amount is the opposite amount",
      );
    }
    return undefined;
  }
  if ((amount < 0n && value < 0n) || (amount > 0n && value > 0n)) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "`transferAmount` goes the other way: what one account sends, the other receives",
    );
  }
  return value;
}

export async function insertOtherSide(
  tx: Db,
  side: { id: string; budgetId: string; date: string; amount: bigint; memo: string },
  account: AccountRow,
  transferTo: AccountRow,
  options: OtherSideOptions = {},
) {
  const otherId = await insertTransaction(tx, {
    budgetId: side.budgetId,
    accountId: transferTo.id,
    date: side.date,
    amount: await newOtherAmount(tx, side, account, transferTo, options),
    currency: transferTo.currency,
    // Set from this side's by `syncBases` below.
    baseAmount: 0n,
    payeeId: await transferPayeeId(tx, account),
    categoryId: await resolveCategory(
      tx,
      side.budgetId,
      transferTo,
      account,
      options.categoryId ?? null,
    ),
    memo: options.memo ?? side.memo,
    cleared: options.cleared ?? clearedOnEntry(transferTo),
    approved: options.approved,
    flag: options.flag,
    transferTransactionId: side.id,
  });
  await tx
    .update(transaction)
    .set({ transferTransactionId: otherId })
    .where(eq(transaction.id, side.id));
  await syncBases(tx, side.id);
}

/** A new transfer's other side's amount (see `OtherSideOptions.transferAmount`). */
async function newOtherAmount(
  tx: Db,
  side: { id: string; budgetId: string; date: string; amount: bigint },
  account: AccountRow,
  transferTo: AccountRow,
  options: OtherSideOptions,
) {
  if (account.currency === transferTo.currency) return -side.amount;
  if (options.transferAmount !== undefined) return options.transferAmount;
  if (!options.fx) throw new Error("A transfer between currencies needs `fx` or its amount");
  return defaultOtherAmount(tx, options.fx, side.id, transferTo.currency);
}

/**
 * The other side's amount in `currency` when none is given: transaction `id`'s base amount,
 * negated, at its date's rate (`otherSideAmount`).
 */
export async function defaultOtherAmount(
  tx: Db,
  fx: FxDeps,
  id: string,
  currency: AccountRow["currency"],
) {
  const [row] = await tx
    .select({
      budgetId: transaction.budgetId,
      baseAmount: transaction.baseAmount,
      date: transaction.date,
    })
    .from(transaction)
    .where(eq(transaction.id, id));
  if (!row) throw new Error(`Transaction ${id} missing`);
  return otherSideAmount(tx, fx, {
    budgetId: row.budgetId,
    budgetCurrency: await budgetCurrencyOf(tx, row.budgetId),
    base: row.baseAmount,
    currency,
    date: row.date,
  });
}

export async function lockTransaction(tx: Db, budgetId: string, id: string) {
  const [row] = await tx
    .select()
    .from(transaction)
    .where(and(eq(transaction.id, id), eq(transaction.budgetId, budgetId)))
    .for("update");
  return row;
}

/** A transaction's cleared state is fixed once reconciled. */
export function reconciledStays(): never {
  throw new AppError(
    409,
    "TRANSACTION_RECONCILED",
    "This transaction is reconciled, and reconciled transactions stay reconciled.",
  );
}

export function transferInSplit(): never {
  throw new AppError(
    409,
    "TRANSFER_IN_SPLIT",
    "This transfer comes from a split. Change its date, amount or account from the split.",
  );
}
