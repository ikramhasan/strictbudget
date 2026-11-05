import type { components } from "@strictbudget/api-client";
import type { Transaction } from "./transactions";

export type CreateTransactionBody = components["schemas"]["CreateTransaction"];
export type UpdateTransactionBody = components["schemas"]["UpdateTransaction"];

/**
 * A complete transaction representation accepted by the create endpoint, to bring a deleted one
 * back (undo) or create it again (redo). It comes back as the same record: its own id and its
 * transfers' other sides' ids, so it keeps its place in its day and later commands in the undo
 * history still find it. A transfer's other side comes back with its own memo, cleared state,
 * flag and approval, and a transfer to an account closed since still comes back (`restore`).
 */
export function createBodyFromTransaction(transaction: Transaction): CreateTransactionBody {
  return {
    id: transaction.id,
    accountId: transaction.accountId,
    date: transaction.date,
    amount: transaction.amount,
    ...(transaction.transferAccountId
      ? { payeeName: null, transferAccountId: transaction.transferAccountId }
      : { payeeName: transaction.payeeName }),
    categoryId: transaction.subtransactions.length > 0 ? null : transaction.categoryId,
    memo: transaction.memo,
    // Restoring a deleted reconciled transaction brings it back reconciled.
    cleared: transaction.cleared,
    flag: transaction.flag,
    approved: transaction.approved,
    ...(transaction.transferAccountId && transaction.transferSide
      ? { transferSide: sideInput(transaction.transferSide) }
      : {}),
    ...(transaction.subtransactions.length > 0
      ? {
          subtransactions: transaction.subtransactions.map((line) => ({
            amount: line.amount,
            ...(line.transferAccountId
              ? {
                  payeeName: null,
                  transferAccountId: line.transferAccountId,
                  ...(line.transferSide ? { transferSide: sideInput(line.transferSide) } : {}),
                }
              : { payeeName: line.payeeName }),
            categoryId: line.categoryId,
            memo: line.memo,
          })),
        }
      : {}),
    // A typed rate comes back typed; otherwise the date's rate is the one it had. An FX
    // Revaluation (amount 0) comes back with its booked base amount and rate.
    ...(transaction.amount === "0" && transaction.baseAmount !== "0"
      ? { baseAmount: transaction.baseAmount, fxRate: transaction.fxRate }
      : transaction.fxRateManual && transaction.fxRate
        ? { fxRate: transaction.fxRate }
        : {}),
    restore: true,
  };
}

/**
 * The API refused to bring a transaction back with its ids: it's back already (`liveIds`), or its
 * change log doesn't show it deleted, when it can still come back as a new record.
 */
export function isIdUnavailable(error: unknown): boolean {
  return (error as { error?: { code?: unknown } } | null)?.error?.code === "ID_UNAVAILABLE";
}

/** The ids an `ID_UNAVAILABLE` refusal names as back already. */
export function liveIds(error: unknown): string[] {
  const live = (error as { error?: { details?: { live?: unknown } } } | null)?.error?.details?.live;
  return Array.isArray(live) ? live.filter((id): id is string => typeof id === "string") : [];
}

/** `createBodyFromTransaction`'s body without its ids: the transaction comes back as a new one. */
export function withoutIds(body: CreateTransactionBody): CreateTransactionBody {
  const { id: _, ...rest } = body;
  return {
    ...sideWithoutId(rest),
    ...(rest.subtransactions ? { subtransactions: rest.subtransactions.map(sideWithoutId) } : {}),
  };
}

function sideWithoutId<T extends { transferSide?: CreateTransactionBody["transferSide"] }>(row: T) {
  if (!row.transferSide) return row;
  const { id: _, ...side } = row.transferSide;
  return { ...row, transferSide: side };
}

type Side = NonNullable<Transaction["transferSide"]>;

/** A transfer's other side as the create endpoint takes it back, its own amount included. */
function sideInput(side: Side): NonNullable<CreateTransactionBody["transferSide"]> {
  const { currency: _, version: __, ...input } = side;
  return input;
}

/** The other side's own amount when it's in another currency. */
function crossAmount(currency: string, side: Side | null) {
  return side && side.currency !== currency ? { transferAmount: side.amount } : {};
}

/** Every mutable field, used to restore a transaction after an edit. */
export function updateBodyFromTransaction(transaction: Transaction): UpdateTransactionBody {
  return {
    accountId: transaction.accountId,
    date: transaction.date,
    amount: transaction.amount,
    ...(transaction.transferAccountId
      ? {
          transferAccountId: transaction.transferAccountId,
          ...crossAmount(transaction.currency, transaction.transferSide),
        }
      : { payeeName: transaction.payeeName }),
    categoryId: transaction.subtransactions.length > 0 ? undefined : transaction.categoryId,
    memo: transaction.memo,
    // A reconciled transaction stays reconciled; its cleared state can't be set.
    ...(transaction.cleared === "reconciled" ? {} : { cleared: transaction.cleared }),
    flag: transaction.flag,
    // Edits approve an unapproved transaction, so an undo puts its approval back.
    approved: transaction.approved,
    // The rate as it was: typed, or the date's (null), which the restored date gives back.
    ...(transaction.currency !== undefined && transaction.fxRate !== null
      ? { fxRate: transaction.fxRateManual ? transaction.fxRate : null }
      : {}),
    ...(transaction.subtransactions.length > 0
      ? {
          subtransactions: transaction.subtransactions.map((line) => ({
            id: line.id,
            amount: line.amount,
            ...(line.transferAccountId
              ? {
                  payeeName: null,
                  transferAccountId: line.transferAccountId,
                  ...crossAmount(transaction.currency, line.transferSide),
                }
              : { payeeName: line.payeeName }),
            categoryId: line.categoryId,
            memo: line.memo,
          })),
        }
      : {}),
  };
}
