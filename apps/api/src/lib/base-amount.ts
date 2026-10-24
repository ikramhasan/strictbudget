import { budget, subTransaction, transaction } from "@strictbudget/db/schema";
import {
  type CurrencyCode,
  convert,
  convertLines,
  impliedRate,
  money,
  normalizeRate,
} from "@strictbudget/engine";
import { asc, eq } from "drizzle-orm";
import type { AppDeps } from "../types";
import { resolveRate } from "./fx";
import type { Db } from "./ledger";

export type FxDeps = Pick<AppDeps, "fxProviders" | "serverDate">;

/** What the budget's math sees of a transaction: its amount in the budget's currency, and how. */
export interface BaseFields {
  baseAmount: bigint;
  fxRate: string | null;
  fxRateManual: boolean;
}

export interface BaseInput {
  budgetId: string;
  budgetCurrency: CurrencyCode;
  currency: CurrencyCode;
  date: string;
  amount: bigint;
  /** A rate typed by hand; otherwise the date's rate is looked up. */
  rate?: string | null;
  /** The user's today: a later date uses today's rate. */
  today?: string;
}

/** The rate for a transaction: typed by hand, or the budget's rate for its date. */
export async function rateFor(db: Db, deps: FxDeps, input: Omit<BaseInput, "amount">) {
  if (input.currency === input.budgetCurrency) return { fxRate: null, fxRateManual: false };
  if (input.rate) return { fxRate: normalizeRate(input.rate), fxRateManual: true };
  const { rate } = await resolveRate(db, deps, {
    budgetId: input.budgetId,
    from: input.currency,
    to: input.budgetCurrency,
    date: input.date,
    today: input.today,
  });
  return { fxRate: rate, fxRateManual: false };
}

/**
 * Converts a transaction's amount into the budget's currency, once: an account in
 * the budget's currency keeps its amount; a foreign one converts at the typed rate or the date's.
 */
export async function baseFields(db: Db, deps: FxDeps, input: BaseInput): Promise<BaseFields> {
  const { fxRate, fxRateManual } = await rateFor(db, deps, input);
  return {
    baseAmount: toBase(input.amount, input.currency, fxRate, input.budgetCurrency),
    fxRate,
    fxRateManual,
  };
}

/** `amount` in the budget's currency at `fxRate` (null: already in it). */
export function toBase(
  amount: bigint,
  currency: CurrencyCode,
  fxRate: string | null,
  budgetCurrency: CurrencyCode,
) {
  if (fxRate === null || currency === budgetCurrency) return amount;
  return convert(money(amount, currency), fxRate, budgetCurrency).amount;
}

/** A split's lines in the budget's currency, adding up to the parent's base amount. */
export function linesToBase(
  amount: bigint,
  lines: readonly bigint[],
  currency: CurrencyCode,
  fxRate: string | null,
  budgetCurrency: CurrencyCode,
) {
  if (fxRate === null || currency === budgetCurrency) return [...lines];
  return convertLines(money(amount, currency), lines, fxRate, budgetCurrency).lines;
}

/** The budget's currency (its base: what every base amount is in). */
export async function budgetCurrencyOf(db: Db, budgetId: string): Promise<CurrencyCode> {
  const [row] = await db
    .select({ currency: budget.currency })
    .from(budget)
    .where(eq(budget.id, budgetId));
  if (!row) throw new Error(`Budget ${budgetId} missing`);
  return row.currency;
}

/**
 * The base fields for an edit of a transaction (the rate lock): a typed rate wins; a cleared one
 * (null) goes back to the date's rate; otherwise the rate stays unless the date changed and it
 * wasn't typed, so editing only the amount keeps it.
 */
export async function rebase(
  db: Db,
  deps: FxDeps,
  existing: { budgetId: string; date: string; fxRate: string | null; fxRateManual: boolean },
  next: { currency: CurrencyCode; date: string; amount: bigint; rate?: string | null },
): Promise<BaseFields> {
  const budgetCurrency = await budgetCurrencyOf(db, existing.budgetId);
  const input = { budgetId: existing.budgetId, budgetCurrency, ...next };
  if (next.currency === budgetCurrency || next.rate !== undefined) {
    return baseFields(db, deps, input);
  }
  const keep = existing.fxRate !== null && (existing.fxRateManual || next.date === existing.date);
  if (!keep) return baseFields(db, deps, input);
  const fxRate = normalizeRate(existing.fxRate as string);
  return {
    baseAmount: toBase(next.amount, next.currency, fxRate, budgetCurrency),
    fxRate,
    fxRateManual: existing.fxRateManual,
  };
}

/** A transfer side's rate: null in the budget's currency, else what its amounts imply. */
function sideRate(
  amount: bigint,
  currency: CurrencyCode,
  base: bigint,
  budgetCurrency: CurrencyCode,
  fallback: string | null,
) {
  if (currency === budgetCurrency) return null;
  const fallbackRate = fallback === null ? null : normalizeRate(fallback);
  return impliedRate(money(amount, currency), money(base, budgetCurrency)) ?? fallbackRate;
}

/**
 * The other side's amount of a transfer between currencies when none is given:
 * the entered side's base amount, negated, in the other side's currency at the date's rate.
 */
export async function otherSideAmount(
  db: Db,
  deps: FxDeps,
  input: {
    budgetId: string;
    budgetCurrency: CurrencyCode;
    base: bigint;
    currency: CurrencyCode;
    date: string;
  },
) {
  if (input.currency === input.budgetCurrency) return -input.base;
  const { rate } = await resolveRate(db, deps, {
    budgetId: input.budgetId,
    from: input.budgetCurrency,
    to: input.currency,
    date: input.date,
  });
  return -convert(money(input.base, input.budgetCurrency), rate, input.currency).amount;
}

/** Whether `other` can be the other side of a transfer of `amount`: never the same way. */
export function oppositeSides(amount: bigint, other: bigint) {
  return amount === 0n ? other === 0n : amount < 0n ? other > 0n : other < 0n;
}

/**
 * Brings what follows a transaction's base amount in line with it: a split's lines (at its rate,
 * adding up to it), the other side of a transfer and of each transfer line. A transfer's sides
 * always have opposite base amounts, so it moves no money in the budget. Between currencies
 * each side keeps its own amount: a side in the budget's currency decides the base
 * amount (its amount is it), otherwise this side's does; the other side's rate is the one its
 * amounts imply. A split's transfer line follows the split's rate, so a line's other side in the
 * budget's currency takes the line's base amount as its amount.
 */
export async function syncBases(db: Db, transactionId: string) {
  const [parent] = await db
    .select({
      amount: transaction.amount,
      currency: transaction.currency,
      baseAmount: transaction.baseAmount,
      fxRate: transaction.fxRate,
      budgetCurrency: budget.currency,
      transferTransactionId: transaction.transferTransactionId,
    })
    .from(transaction)
    .innerJoin(budget, eq(budget.id, transaction.budgetId))
    .where(eq(transaction.id, transactionId));
  if (!parent) return;
  const { budgetCurrency } = parent;
  const fxRate = parent.fxRate === null ? null : normalizeRate(parent.fxRate);
  if (parent.transferTransactionId) {
    const [other] = await db
      .select({
        amount: transaction.amount,
        currency: transaction.currency,
        fxRate: transaction.fxRate,
      })
      .from(transaction)
      .where(eq(transaction.id, parent.transferTransactionId));
    if (other && other.currency !== parent.currency && other.currency === budgetCurrency) {
      // The other side is in the budget's currency: its amount is the transfer's base amount.
      const baseAmount = -other.amount;
      await db
        .update(transaction)
        .set({
          baseAmount,
          fxRate: sideRate(parent.amount, parent.currency, baseAmount, budgetCurrency, fxRate),
        })
        .where(eq(transaction.id, transactionId));
      await db
        .update(transaction)
        .set({ baseAmount: other.amount, fxRate: null })
        .where(eq(transaction.id, parent.transferTransactionId));
    } else if (other) {
      const baseAmount = -parent.baseAmount;
      await db
        .update(transaction)
        .set({
          baseAmount,
          fxRate:
            other.currency === parent.currency
              ? fxRate
              : sideRate(other.amount, other.currency, baseAmount, budgetCurrency, other.fxRate),
        })
        .where(eq(transaction.id, parent.transferTransactionId));
    }
  }
  const lines = await db
    .select({ id: subTransaction.id, amount: subTransaction.amount })
    .from(subTransaction)
    .where(eq(subTransaction.transactionId, transactionId))
    .orderBy(asc(subTransaction.sortOrder));
  const bases =
    fxRate === null
      ? lines.map((l) => l.amount)
      : linesToBase(
          parent.amount,
          lines.map((l) => l.amount),
          parent.currency,
          fxRate,
          budgetCurrency,
        );
  for (const [i, line] of lines.entries()) {
    const baseAmount = bases[i] as bigint;
    await db.update(subTransaction).set({ baseAmount }).where(eq(subTransaction.id, line.id));
    const [other] = await db
      .select({
        id: transaction.id,
        amount: transaction.amount,
        currency: transaction.currency,
        fxRate: transaction.fxRate,
      })
      .from(transaction)
      .where(eq(transaction.transferSubTransactionId, line.id));
    if (!other) continue;
    const sameCurrency = other.currency === parent.currency;
    const toBudget = !sameCurrency && other.currency === budgetCurrency;
    await db
      .update(transaction)
      .set({
        ...(toBudget ? { amount: -baseAmount } : {}),
        baseAmount: -baseAmount,
        fxRate: sameCurrency
          ? fxRate
          : sideRate(other.amount, other.currency, -baseAmount, budgetCurrency, other.fxRate),
      })
      .where(eq(transaction.id, other.id));
  }
}
