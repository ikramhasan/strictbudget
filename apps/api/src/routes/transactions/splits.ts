import { newId } from "@strictbudget/db";
import { budget, type ClearedState, subTransaction, transaction } from "@strictbudget/db/schema";
import { normalizeRate } from "@strictbudget/engine";
import { asc, eq, inArray } from "drizzle-orm";
import {
  type FxDeps,
  linesToBase,
  oppositeSides,
  otherSideAmount,
  syncBases,
} from "../../lib/base-amount";
import { AppError } from "../../lib/errors";
import { type Db, findOrCreatePayee, insertTransaction, transferPayeeId } from "../../lib/ledger";
import {
  type AccountRow,
  assertOpen,
  assertTransferPair,
  checkTransferAmount,
  clearedOnEntry,
  findAccount,
  resolveCategory,
  type TransferSideInput,
  usesCategory,
} from "./rules";

export interface LineInput {
  /** An existing line of this split, to keep its transfer's other side. New lines leave it out. */
  id?: string;
  amount: string;
  payeeName: string | null;
  /** Instead of `payeeName`: a payee by id (entering a scheduled split). */
  payeeId?: string | null;
  transferAccountId?: string;
  categoryId: string | null;
  memo: string;
  /** A restored transfer line's other side, as it was. */
  transferSide?: TransferSideInput;
  /**
   * A transfer line between currencies: the other side's amount, in its account's currency
   * (otherwise the line's base amount at the date's rate; kept on an edit unless given).
   */
  transferAmount?: string | null;
}

/** A line to write: from the request, or kept as it is (`payeeName`/`memo` undefined). */
interface LineSpec {
  id?: string;
  amount: bigint;
  payeeName?: string | null;
  payeeId?: string | null;
  transferAccountId: string | null;
  categoryId: string | null;
  /** The category was asked for, so it's checked strictly rather than adjusted. */
  explicitCategory: boolean;
  memo?: string;
  transferSide?: TransferSideInput;
  transferAmount?: string | null;
}

export function assertSplitAllowed(account: AccountRow) {
  if (!usesCategory(account, null)) {
    throw new AppError(
      400,
      "SPLIT_NOT_ALLOWED",
      "Only transactions in budget accounts can be split",
    );
  }
}

export function assertLinesAddUp(lines: readonly { amount: string }[], total: bigint) {
  const sum = lines.reduce((acc, l) => acc + BigInt(l.amount), 0n);
  if (sum !== total) {
    throw new AppError(
      400,
      "SPLIT_TOTAL_MISMATCH",
      "The split lines must add up to the transaction's amount",
    );
  }
}

export async function splitLines(db: Db, transactionId: string) {
  return db
    .select()
    .from(subTransaction)
    .where(eq(subTransaction.transactionId, transactionId))
    .orderBy(asc(subTransaction.sortOrder), asc(subTransaction.id));
}

/** The transactions in other accounts that transfer lines of these split lines created. */
async function lockCounterparts(db: Db, lineIds: readonly string[]) {
  if (lineIds.length === 0) return [];
  return db
    .select()
    .from(transaction)
    .where(inArray(transaction.transferSubTransactionId, [...lineIds]))
    .for("update");
}

/**
 * Brings a split's lines in line with `input` (matched by id; missing ones are removed, so `[]`
 * un-splits), or, without `input`, keeps them and re-syncs their transfers after the parent's
 * date or account changed. Transfer lines keep a transaction in the other account with the
 * opposite amount and the parent's date.
 */
export async function syncLines(
  tx: Db,
  ctx: {
    budgetId: string;
    parentId: string;
    date: string;
    account: AccountRow;
    /** The parent moved to `account` from another one. */
    moved: boolean;
    /** How new transfer lines' other sides start out (by default by their account, approved). */
    counterpart?: { cleared: (account: AccountRow) => ClearedState; approved: boolean };
    /** An undo bringing back a deleted split: its transfer lines may reach closed accounts. */
    restore?: boolean;
    fx?: FxDeps;
  },
  input?: readonly LineInput[],
) {
  const { budgetId, parentId, date, account, moved } = ctx;
  const existing = await splitLines(tx, parentId);
  const counterparts = await lockCounterparts(
    tx,
    existing.map((l) => l.id),
  );
  const otherOf = new Map(counterparts.map((c) => [c.transferSubTransactionId, c]));
  const byId = new Map(existing.map((l) => [l.id, l]));

  const specs: LineSpec[] = input
    ? input.map((l) => ({
        id: l.id,
        amount: BigInt(l.amount),
        payeeName: l.payeeName,
        payeeId: l.payeeId,
        transferAccountId: l.transferAccountId ?? null,
        categoryId: l.categoryId,
        explicitCategory: true,
        memo: l.memo,
        transferSide: l.transferSide,
        transferAmount: l.transferAmount !== undefined ? l.transferAmount : l.transferSide?.amount,
      }))
    : existing.map((l) => ({
        id: l.id,
        amount: l.amount,
        transferAccountId: otherOf.get(l.id)?.accountId ?? null,
        categoryId: l.categoryId,
        explicitCategory: false,
      }));

  // Lines left out go first, with their transfers.
  const kept = new Set(specs.flatMap((s) => (s.id ? [s.id] : [])));
  for (const line of existing) {
    if (kept.has(line.id)) continue;
    const other = otherOf.get(line.id);
    if (other) await tx.delete(transaction).where(eq(transaction.id, other.id));
    await tx.delete(subTransaction).where(eq(subTransaction.id, line.id));
  }

  const parent = await parentBases(
    tx,
    parentId,
    specs.map((s) => s.amount),
  );
  for (const [index, spec] of specs.entries()) {
    const old = spec.id ? byId.get(spec.id) : undefined;
    if (spec.id && !old) throw new AppError(400, "BAD_REQUEST", "No such line in this split");
    const other = old ? otherOf.get(old.id) : undefined;

    let transferTo: AccountRow | null = null;
    if (spec.transferAccountId) {
      transferTo = await findAccount(tx, budgetId, spec.transferAccountId);
      assertTransferPair(account, transferTo);
    }
    const retargeted = (transferTo?.id ?? null) !== (other?.accountId ?? null);
    // Entering a scheduled split still reaches a closed account.
    if (transferTo && retargeted && !ctx.counterpart && !ctx.restore) assertOpen(transferTo);
    if (spec.transferSide && !transferTo) {
      throw new AppError(400, "BAD_REQUEST", "A line's `transferSide` needs `transferAccountId`");
    }

    let categoryId = spec.categoryId;
    if (spec.explicitCategory) {
      categoryId = await resolveCategory(tx, budgetId, account, transferTo, spec.categoryId);
    } else if (moved || retargeted) {
      const keep = usesCategory(account, transferTo) ? spec.categoryId : null;
      categoryId = await resolveCategory(tx, budgetId, account, transferTo, keep);
    }
    const payeeId = transferTo
      ? await transferPayeeId(tx, transferTo)
      : spec.payeeId !== undefined
        ? spec.payeeId
        : spec.payeeName === undefined
          ? (old?.payeeId ?? null)
          : spec.payeeName
            ? await findOrCreatePayee(tx, budgetId, spec.payeeName)
            : null;

    const values = {
      sortOrder: index,
      amount: spec.amount,
      currency: account.currency,
      // Set from the parent's by `syncBases` below.
      baseAmount: 0n,
      payeeId,
      categoryId,
      memo: spec.memo,
    };
    let lineId: string;
    if (old) {
      lineId = old.id;
      await tx.update(subTransaction).set(values).where(eq(subTransaction.id, old.id));
    } else {
      lineId = newId();
      await tx.insert(subTransaction).values({ id: lineId, transactionId: parentId, ...values });
    }

    const otherAmount = () =>
      lineOtherAmount(tx, ctx.fx, {
        budgetId,
        date,
        spec,
        account,
        transferTo: transferTo as AccountRow,
        other,
        base: parent.bases[index] as bigint,
        budgetCurrency: parent.budgetCurrency,
      });
    if (other && !transferTo) {
      await tx.delete(transaction).where(eq(transaction.id, other.id));
    } else if (other && transferTo) {
      const keep = usesCategory(transferTo, account) ? other.categoryId : null;
      await tx
        .update(transaction)
        .set({
          accountId: transferTo.id,
          currency: transferTo.currency,
          date,
          amount: await otherAmount(),
          payeeId: moved ? await transferPayeeId(tx, account) : undefined,
          categoryId:
            moved || retargeted
              ? await resolveCategory(tx, budgetId, transferTo, account, keep)
              : undefined,
          // A line's memo is its other side's too.
          memo: spec.memo !== undefined && spec.memo !== old?.memo ? spec.memo : undefined,
        })
        .where(eq(transaction.id, other.id));
    } else if (transferTo) {
      const side = spec.transferSide;
      await insertTransaction(tx, {
        budgetId,
        accountId: transferTo.id,
        date,
        amount: await otherAmount(),
        currency: transferTo.currency,
        baseAmount: 0n,
        payeeId: await transferPayeeId(tx, account),
        categoryId: await resolveCategory(
          tx,
          budgetId,
          transferTo,
          account,
          side?.categoryId ?? null,
        ),
        memo: side?.memo ?? spec.memo ?? "",
        cleared:
          side?.cleared ?? ctx.counterpart?.cleared(transferTo) ?? clearedOnEntry(transferTo),
        approved: side?.approved ?? ctx.counterpart?.approved,
        flag: side?.flag,
        transferSubTransactionId: lineId,
      });
    }
  }
  await syncBases(tx, parentId);
}

/** The split's lines (these amounts) in the budget's currency at its rate, and that currency. */
async function parentBases(tx: Db, parentId: string, amounts: readonly bigint[]) {
  const [parent] = await tx
    .select({
      amount: transaction.amount,
      currency: transaction.currency,
      fxRate: transaction.fxRate,
      budgetCurrency: budget.currency,
    })
    .from(transaction)
    .innerJoin(budget, eq(budget.id, transaction.budgetId))
    .where(eq(transaction.id, parentId));
  if (!parent) throw new Error(`Split ${parentId} missing`);
  const rate = parent.fxRate === null ? null : normalizeRate(parent.fxRate);
  return {
    budgetCurrency: parent.budgetCurrency,
    bases: linesToBase(parent.amount, amounts, parent.currency, rate, parent.budgetCurrency),
  };
}

/**
 * A transfer line's other side's amount: the opposite amount in one currency. Between currencies
 * the split's rate decides the line's base amount, so a side in the budget's
 * currency takes that; another currency takes `transferAmount`, or keeps its own amount on an
 * edit, or gets the line's base amount at the date's rate.
 */
async function lineOtherAmount(
  tx: Db,
  fx: FxDeps | undefined,
  input: {
    budgetId: string;
    date: string;
    spec: LineSpec;
    account: AccountRow;
    transferTo: AccountRow;
    other: { amount: bigint; currency: AccountRow["currency"] } | undefined;
    base: bigint;
    budgetCurrency: AccountRow["currency"];
  },
) {
  const { spec, account, transferTo, other, base } = input;
  const given = checkTransferAmount(spec.amount, spec.transferAmount, account, transferTo);
  if (account.currency === transferTo.currency) return -spec.amount;
  // Its amount is its base amount, which the split's rate sets (a given one is left aside).
  if (transferTo.currency === input.budgetCurrency) return -base;
  if (given !== undefined) return given;
  const keep =
    other !== undefined &&
    spec.transferAmount !== null &&
    other.currency === transferTo.currency &&
    oppositeSides(spec.amount, other.amount);
  if (keep) return other.amount;
  if (spec.amount === 0n) return 0n;
  if (!fx) throw new Error("A transfer line between currencies needs `fx` or its amount");
  return otherSideAmount(tx, fx, {
    budgetId: input.budgetId,
    budgetCurrency: input.budgetCurrency,
    base,
    currency: transferTo.currency,
    date: input.date,
  });
}

/** Removes a split's transfer lines' other sides before the split itself is deleted. */
export async function deleteLineTransfers(tx: Db, parentId: string) {
  const lines = await splitLines(tx, parentId);
  const counterparts = await lockCounterparts(
    tx,
    lines.map((l) => l.id),
  );
  if (counterparts.length > 0) {
    await tx.delete(transaction).where(
      inArray(
        transaction.id,
        counterparts.map((c) => c.id),
      ),
    );
  }
}
