import { payee, type transaction } from "@strictbudget/db/schema";
import { type CurrencyCode, convert, money, normalizeRate } from "@strictbudget/engine";
import { eq } from "drizzle-orm";
import { AppError } from "./errors";
import { knownRateOn } from "./fx";
import type { Db } from "./ledger";

export async function isRevaluationPayee(db: Db, payeeId: string | null) {
  if (!payeeId) return false;
  const [row] = await db
    .select({ kind: payee.internalKind })
    .from(payee)
    .where(eq(payee.id, payeeId));
  return row?.kind === "fx_revaluation";
}

/**
 * Unrealized FX gain or loss: what a foreign-currency account's balance is worth
 * in the budget's currency at `rate` (converted once, half-even) less what its transactions were
 * booked at (Σ base amounts). Positive is a gain.
 */
export function unrealizedGain(
  native: bigint,
  booked: bigint,
  currency: CurrencyCode,
  rate: string,
  budgetCurrency: CurrencyCode,
) {
  return convert(money(native, currency), rate, budgetCurrency).amount - booked;
}

export interface Unrealized {
  /** In the budget's minor units; positive is a gain. */
  gain: bigint;
  /** "1 account currency = rate budget currency". */
  rate: string;
  /** The date the rate is from (an earlier one when there's none for today). */
  rateDate: string;
}

/**
 * Each foreign-currency account's unrealized gain or loss at today's known rate (no network, so
 * the account list never waits on a provider). Accounts in the budget's currency, and those with
 * no known rate, are left out.
 */
export async function unrealizedGains(
  db: Db,
  input: {
    budgetId: string;
    budgetCurrency: CurrencyCode;
    today: string;
    accounts: readonly { id: string; currency: CurrencyCode; native: bigint; booked: bigint }[];
  },
): Promise<Map<string, Unrealized>> {
  const { budgetId, budgetCurrency, today } = input;
  const rates = new Map<CurrencyCode, { rate: string; rateDate: string } | null>();
  const result = new Map<string, Unrealized>();
  for (const a of input.accounts) {
    if (a.currency === budgetCurrency) continue;
    if (!rates.has(a.currency)) {
      rates.set(
        a.currency,
        await knownRateOn(db, {
          budgetId,
          budgetCurrency,
          from: a.currency,
          to: budgetCurrency,
          date: today,
        }),
      );
    }
    const known = rates.get(a.currency);
    if (!known) continue;
    result.set(a.id, {
      gain: unrealizedGain(a.native, a.booked, a.currency, known.rate, budgetCurrency),
      ...known,
    });
  }
  return result;
}

/**
 * A revaluation's native amount is zero and its base amount is the point, so an edit that would
 * convert its amount again (amount, date, account, payee, rate, split) would erase it. Those are
 * refused; category, memo, cleared state and flag can change, and it can be deleted. Returns
 * whether the row is a revaluation (its base amount then stays as it is).
 */
export async function assertRevaluationEditable(
  db: Db,
  existing: typeof transaction.$inferSelect,
  body: {
    accountId?: string;
    date?: string;
    amount?: string;
    payeeName?: string | null;
    transferAccountId?: string;
    subtransactions?: unknown;
    fxRate?: string | null;
  },
): Promise<boolean> {
  if (!existing.payeeId) return false;
  const [row] = await db
    .select({ kind: payee.internalKind, name: payee.name })
    .from(payee)
    .where(eq(payee.id, existing.payeeId));
  if (row?.kind !== "fx_revaluation") return false;
  // An editor saving the whole row sends the fields it didn't change too.
  // A revaluation's rate is never typed, so null ("the date's rate", as an undo sends it) keeps it.
  const sameRate =
    body.fxRate === undefined ||
    body.fxRate === null ||
    (existing.fxRate !== null && normalizeRate(body.fxRate) === normalizeRate(existing.fxRate));
  const changes =
    (body.accountId !== undefined && body.accountId !== existing.accountId) ||
    (body.date !== undefined && body.date !== existing.date) ||
    (body.amount !== undefined && BigInt(body.amount) !== existing.amount) ||
    (body.payeeName !== undefined && body.payeeName?.toLowerCase() !== row.name.toLowerCase()) ||
    body.transferAccountId !== undefined ||
    body.subtransactions !== undefined ||
    !sameRate;
  if (!changes) return true;
  throw new AppError(
    409,
    "REVALUATION_LOCKED",
    "An FX revaluation's amount, date, account and payee can't change. Delete it and revalue " +
      "again instead.",
  );
}
