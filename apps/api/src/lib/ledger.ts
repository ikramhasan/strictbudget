import { type Database, newId, sql } from "@strictbudget/db";
import {
  type ClearedState,
  category,
  categoryGroup,
  type FlagColor,
  type InternalCategoryKind,
  type InternalPayeeKind,
  payee,
  transaction,
} from "@strictbudget/db/schema";
import { type AccountType, isOnBudget } from "@strictbudget/engine";
import { and, eq, isNull, lte, max } from "drizzle-orm";
import { type BaseFields, baseFields, budgetCurrencyOf, type FxDeps } from "./base-amount";
import { loanChargeBalances } from "./loans";
import { notePayeeCategorizations } from "./payee-categories";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Db = Database | Tx;

const INTERNAL_PAYEE_NAMES: Record<InternalPayeeKind, string> = {
  starting_balance: "Starting Balance",
  manual_balance_adjustment: "Manual Balance Adjustment",
  reconciliation_balance_adjustment: "Reconciliation Balance Adjustment",
  fx_revaluation: "FX Revaluation",
};

/** The budget's built-in payee of this kind, created on first use. */
export async function internalPayeeId(db: Db, budgetId: string, kind: InternalPayeeKind) {
  await db
    .insert(payee)
    .values({ id: newId(), budgetId, name: INTERNAL_PAYEE_NAMES[kind], internalKind: kind })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: payee.id })
    .from(payee)
    .where(and(eq(payee.budgetId, budgetId), eq(payee.internalKind, kind)));
  if (!row) throw new Error(`Internal payee ${kind} missing`);
  return row.id;
}

export function transferPayeeName(accountName: string) {
  return `Transfer : ${accountName}`;
}

/**
 * The account's "Transfer : <account>" payee. Created with the account; accounts from before
 * transfers existed get theirs here on first use.
 */
export async function transferPayeeId(
  db: Db,
  account: { id: string; budgetId: string; name: string },
) {
  await db
    .insert(payee)
    .values({
      id: newId(),
      budgetId: account.budgetId,
      name: transferPayeeName(account.name),
      transferAccountId: account.id,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: payee.id })
    .from(payee)
    .where(eq(payee.transferAccountId, account.id));
  if (!row) throw new Error(`Transfer payee for ${account.id} missing`);
  return row.id;
}

/** Id of one of the budget's internal categories (seeded with every budget). */
export async function internalCategoryId(db: Db, budgetId: string, kind: InternalCategoryKind) {
  const [row] = await db
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.budgetId, budgetId), eq(category.internalKind, kind)));
  if (!row) throw new Error(`Internal category ${kind} missing for budget ${budgetId}`);
  return row.id;
}

/** The "Credit Card Payments" group, created with the budget's first credit account. */
export async function creditCardPaymentsGroupId(db: Db, budgetId: string) {
  await db
    .insert(categoryGroup)
    .values({
      id: newId(),
      budgetId,
      name: "Credit Card Payments",
      sortOrder: -1,
      kind: "credit_card_payments",
    })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: categoryGroup.id })
    .from(categoryGroup)
    .where(
      and(eq(categoryGroup.budgetId, budgetId), eq(categoryGroup.kind, "credit_card_payments")),
    );
  if (!row) throw new Error("Credit Card Payments group missing");
  return row.id;
}

/** Adds a credit account's payment category at the end of the Credit Card Payments group. */
export async function createPaymentCategory(
  db: Db,
  budgetId: string,
  accountId: string,
  name: string,
) {
  const groupId = await creditCardPaymentsGroupId(db, budgetId);
  const [last] = await db
    .select({ value: max(category.sortOrder) })
    .from(category)
    .where(eq(category.groupId, groupId));
  await db.insert(category).values({
    id: newId(),
    budgetId,
    groupId,
    name,
    sortOrder: (last?.value ?? -1) + 1,
    linkedAccountId: accountId,
  });
}

export interface NewTransaction {
  budgetId: string;
  accountId: string;
  date: string;
  amount: bigint;
  currency: typeof transaction.$inferInsert.currency;
  payeeId: string | null;
  categoryId: string | null;
  cleared: ClearedState;
  memo?: string;
  flag?: FlagColor | null;
  /** False for scheduled transactions entered on their date (they wait for approval). */
  approved?: boolean;
  transferTransactionId?: string | null;
  transferSubTransactionId?: string | null;
  /** A file import's id and payee as the file named it. */
  importId?: string | null;
  importedPayee?: string | null;
  /**
   * The amount in the budget's currency, when already known (a revaluation's). Left out, it's
   * `amount` in an account in the budget's currency, or converted with `fx` (at `rate`, or the
   * date's rate) in a foreign one.
   */
  baseAmount?: bigint;
  fxRate?: string | null;
  fxRateManual?: boolean;
  /** Needed to convert a foreign-currency amount (`baseFields`). */
  fx?: FxDeps;
  /** A rate typed by hand for a foreign-currency amount. */
  rate?: string | null;
  /** Split lines follow, so a zero amount still needs its rate (`syncBases` converts them). */
  split?: boolean;
}

export async function insertTransaction(db: Db, values: NewTransaction) {
  const { fx, rate, split, ...row } = values;
  const id = newId();
  let base: BaseFields = {
    baseAmount: row.baseAmount ?? row.amount,
    fxRate: row.fxRate ?? null,
    fxRateManual: row.fxRateManual ?? false,
  };
  if (row.baseAmount === undefined) {
    const budgetCurrency = await budgetCurrencyOf(db, row.budgetId);
    // Zero is zero in any currency, so there's no rate to look up (an empty Starting Balance),
    // unless split lines follow: a split totalling zero still converts its lines at its rate.
    if (budgetCurrency !== row.currency && (row.amount !== 0n || split)) {
      if (!fx)
        throw new Error(`A ${row.currency} transaction needs its amount in ${budgetCurrency}`);
      base = await baseFields(db, fx, { ...row, budgetCurrency, rate });
    }
  }
  await db.insert(transaction).values({ id, ...row, ...base });
  // An add updates the payee's auto-categorization default.
  if (row.payeeId) await notePayeeCategorizations(db, row.budgetId, [id]);
  return id;
}

/**
 * The budget's payee with this name (ignoring case), created if there's none. Internal payees
 * match too, so typing "Starting Balance" picks the real one instead of failing. Transfer payees
 * don't: a transfer is asked for by account.
 */
export async function findOrCreatePayee(db: Db, budgetId: string, name: string) {
  await db.insert(payee).values({ id: newId(), budgetId, name }).onConflictDoNothing();
  const [row] = await db
    .select({ id: payee.id })
    .from(payee)
    .where(
      and(
        eq(payee.budgetId, budgetId),
        isNull(payee.transferAccountId),
        sql`lower(${payee.name}) = lower(${name})`,
      ),
    );
  if (!row) throw new Error(`Payee ${name} missing`);
  return row.id;
}

/** The server's calendar date, for requests that weren't given the user's today. */
export function serverToday() {
  return new Date().toISOString().slice(0, 10);
}

export interface AccountBalances {
  cleared: bigint;
  uncleared: bigint;
  working: bigint;
}

/**
 * Cleared (incl. reconciled), uncleared and working balances for each account of the budget, in
 * its own currency (or the budget's: loans are always in the budget's, so their charges apply), as
 * of `today` (the user's calendar date): future-dated transactions don't count until their date.
 */
export async function accountBalances(
  db: Db,
  budgetId: string,
  today: string,
  /** "base": in the budget's currency (Σ base amounts), for the budget's math. */
  currency: "native" | "base" = "native",
) {
  const amount = currency === "base" ? transaction.baseAmount : transaction.amount;
  const rows = await db
    .select({
      accountId: transaction.accountId,
      cleared: sql<string>`coalesce(sum(${amount}) filter (where ${transaction.cleared} <> 'uncleared'), 0)`,
      uncleared: sql<string>`coalesce(sum(${amount}) filter (where ${transaction.cleared} = 'uncleared'), 0)`,
    })
    .from(transaction)
    .where(and(eq(transaction.budgetId, budgetId), lte(transaction.date, today)))
    .groupBy(transaction.accountId);
  // A loan's interest and escrow aren't transactions but add to what it owes.
  const charges = await loanChargeBalances(db, budgetId, today);
  const balances = new Map<string, AccountBalances>();
  for (const row of rows) {
    const charge = charges.get(row.accountId);
    // Postgres returns numeric sums as strings; BigInt parses them exactly.
    const cleared = BigInt(row.cleared) - (charge?.cleared ?? 0n);
    const uncleared = BigInt(row.uncleared) - (charge?.uncleared ?? 0n);
    balances.set(row.accountId, { cleared, uncleared, working: cleared + uncleared });
  }
  return balances;
}

export const ZERO_BALANCES: AccountBalances = { cleared: 0n, uncleared: 0n, working: 0n };

/**
 * An account's Starting Balance: money in budget accounts goes to Ready to Assign; credit debt has
 * no category (existing debt, paid from the payment category); off-budget accounts never have a
 * category.
 */
export async function insertStartingBalance(
  db: Db,
  input: {
    budgetId: string;
    accountId: string;
    type: AccountType;
    amount: bigint;
    currency: NewTransaction["currency"];
    date: string;
    /** For an account in another currency: converts the balance (at `rate`, or the date's). */
    fx?: FxDeps;
    rate?: string | null;
  },
) {
  const toReadyToAssign = isOnBudget(input.type) && input.amount >= 0n;
  await insertTransaction(db, {
    budgetId: input.budgetId,
    accountId: input.accountId,
    date: input.date,
    amount: input.amount,
    currency: input.currency,
    fx: input.fx,
    rate: input.rate,
    payeeId: await internalPayeeId(db, input.budgetId, "starting_balance"),
    categoryId: toReadyToAssign
      ? await internalCategoryId(db, input.budgetId, "ready_to_assign")
      : null,
    cleared: "cleared",
  });
}
