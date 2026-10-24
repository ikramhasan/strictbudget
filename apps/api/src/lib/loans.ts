import { newId } from "@strictbudget/db";
import { budgetAccount, loanCharge, loanTerms, payee, transaction } from "@strictbudget/db/schema";
import {
  ACCOUNT_TYPES,
  accountFamily,
  type BudgetMonth,
  currencyExponent,
  type LoanChargeKind,
  type LoanChargeOverride,
  type LoanLine,
  type LoanMonth,
  type LoanTerms,
  type LoanTermsChange,
  loanCharges,
  loanMonths,
  loanTermsEntries,
  monthOf,
  termsFor,
  withLoanTerms,
} from "@strictbudget/engine";
import { and, asc, desc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "./ledger";

export const LOAN_TYPES = ACCOUNT_TYPES.filter((t) => accountFamily(t) === "loan");
const CASH_TYPES = ACCOUNT_TYPES.filter((t) => accountFamily(t) === "cash");
const CREDIT_TYPES = ACCOUNT_TYPES.filter((t) => accountFamily(t) === "credit");
const PAYING_TYPES = [...CASH_TYPES, ...CREDIT_TYPES];

type AccountRow = typeof budgetAccount.$inferSelect;

/** A loan transaction as the loan page shows it. */
export interface LoanTransaction {
  id: string;
  date: string;
  amount: bigint;
  memo: string;
  kind: LoanLine["kind"];
  /** Internal payee kind (balance adjustments), if any. */
  payeeKind: string | null;
  /** Payments: the account the money came from and that side's id. */
  fromAccountId: string | null;
  otherSideId: string | null;
}

export interface LoanState {
  months: LoanMonth[];
  transactions: LoanTransaction[];
  terms: LoanTerms[];
  /** `updatedAt` of each override, keyed "YYYY-MM:kind" (shown as "Edited on October 13"). */
  editedAt: Map<string, Date>;
}

const firstOfMonth = (month: BudgetMonth) => `${month}-01`;

/** Where a loan's terms without `loan_terms` entries are filed: before any month it can have. */
const EARLIEST_MONTH = "0001-01";

/** The loans' transactions up to `today`, classified for `loanMonths`. */
async function loanTransactions(db: Db, accountIds: string[], today: string) {
  if (accountIds.length === 0) return [];
  const rows = await db
    .select({
      id: transaction.id,
      accountId: transaction.accountId,
      date: transaction.date,
      amount: transaction.amount,
      memo: transaction.memo,
      cleared: transaction.cleared,
      payeeKind: payee.internalKind,
      transferAccountId: payee.transferAccountId,
      transferTransactionId: transaction.transferTransactionId,
      transferSubTransactionId: transaction.transferSubTransactionId,
    })
    .from(transaction)
    .leftJoin(payee, eq(payee.id, transaction.payeeId))
    .where(and(inArray(transaction.accountId, accountIds), lte(transaction.date, today)))
    .orderBy(asc(transaction.date), asc(transaction.id));
  return rows.map((r) => {
    const transfer = r.transferTransactionId !== null || r.transferSubTransactionId !== null;
    const kind: LoanLine["kind"] =
      transfer && r.amount > 0n
        ? "payment"
        : r.payeeKind === "starting_balance"
          ? "starting_balance"
          : "other";
    return {
      accountId: r.accountId,
      cleared: r.cleared,
      line: {
        id: r.id,
        date: r.date,
        amount: r.amount,
        memo: r.memo,
        kind,
        payeeKind: r.payeeKind,
        fromAccountId: transfer ? r.transferAccountId : null,
        otherSideId: r.transferTransactionId,
      } satisfies LoanTransaction,
    };
  });
}

/** The loans' stored `loan_terms` entries, by account id. */
async function storedTerms(db: Db, ids: string[]) {
  const rows = ids.length
    ? await db.select().from(loanTerms).where(inArray(loanTerms.accountId, ids))
    : [];
  const byAccount = new Map<string, LoanTerms[]>();
  for (const r of rows) {
    const list = byAccount.get(r.accountId) ?? [];
    list.push({
      month: monthOf(r.month),
      interestRate: r.interestRate,
      minimumPayment: r.minimumPayment,
      escrowAmount: r.escrowAmount,
    });
    byAccount.set(r.accountId, list);
  }
  return byAccount;
}

async function termsByAccount(db: Db, accounts: AccountRow[]) {
  const byAccount = await storedTerms(
    db,
    accounts.map((a) => a.id),
  );
  // Loans without `loan_terms` entries have only the account's columns: they apply to every month.
  for (const a of accounts) {
    if (!byAccount.has(a.id)) {
      byAccount.set(a.id, [
        {
          month: EARLIEST_MONTH,
          interestRate: a.interestRate,
          minimumPayment: a.minimumPayment,
          escrowAmount: a.escrowAmount,
        },
      ]);
    }
  }
  return byAccount;
}

async function overridesByAccount(db: Db, accountIds: string[]) {
  const rows = accountIds.length
    ? await db.select().from(loanCharge).where(inArray(loanCharge.accountId, accountIds))
    : [];
  type Entry = { overrides: LoanChargeOverride[]; editedAt: Map<string, Date> };
  const byAccount = new Map<string, Entry>();
  for (const r of rows) {
    const entry: Entry = byAccount.get(r.accountId) ?? { overrides: [], editedAt: new Map() };
    const month = monthOf(r.month);
    entry.overrides.push({ month, kind: r.kind, amount: r.amount, status: r.status });
    entry.editedAt.set(`${month}:${r.kind}`, r.updatedAt);
    byAccount.set(r.accountId, entry);
  }
  return byAccount;
}

/** Every loan's months through `today`'s month, keyed by account id. */
export async function loanStates(
  db: Db,
  accounts: AccountRow[],
  today: string,
  /** Terms to use instead of the stored ones, by account id (a preview). */
  termsOverride?: ReadonlyMap<string, LoanTerms[]>,
): Promise<Map<string, LoanState>> {
  const loans = accounts.filter((a) => accountFamily(a.type) === "loan");
  const ids = loans.map((a) => a.id);
  const [lines, stored, overrides] = await Promise.all([
    loanTransactions(db, ids, today),
    termsByAccount(db, loans),
    overridesByAccount(db, ids),
  ]);
  const terms = new Map([...stored, ...(termsOverride ?? [])]);
  const states = new Map<string, LoanState>();
  for (const loan of loans) {
    const own = lines.filter((l) => l.accountId === loan.id).map((l) => l.line);
    const accountTerms = terms.get(loan.id) ?? [];
    const accountOverrides = overrides.get(loan.id);
    states.set(loan.id, {
      months: loanMonths({
        lines: own,
        terms: accountTerms,
        overrides: accountOverrides?.overrides ?? [],
        through: monthOf(today),
        exponent: currencyExponent(loan.currency),
      }),
      transactions: own,
      terms: accountTerms,
      editedAt: accountOverrides?.editedAt ?? new Map(),
    });
  }
  return states;
}

/**
 * What interest and escrow add to each loan's debt through `today`, split like balances: charges
 * fixed by a reconcile count as cleared, the rest as uncleared.
 */
export async function loanChargeBalances(db: Db, budgetId: string, today: string) {
  const loans = await db
    .select()
    .from(budgetAccount)
    .where(and(eq(budgetAccount.budgetId, budgetId), inArray(budgetAccount.type, LOAN_TYPES)));
  const states = await loanStates(db, loans, today);
  const result = new Map<string, { cleared: bigint; uncleared: bigint }>();
  for (const [accountId, state] of states) {
    let cleared = 0n;
    let uncleared = 0n;
    for (const m of state.months) {
      for (const charge of [m.interest, m.escrow]) {
        if (charge.status === "reconciled") cleared += charge.applied;
        else uncleared += charge.applied;
      }
    }
    if (cleared !== 0n || uncleared !== 0n) result.set(accountId, { cleared, uncleared });
  }
  return result;
}

/** Sets a month's interest or escrow total ("Edited on …"). */
export async function setLoanCharge(
  db: Db,
  account: AccountRow,
  input: {
    month: BudgetMonth;
    kind: LoanChargeKind;
    amount: bigint;
    status: "edited" | "reconciled";
  },
) {
  await db
    .insert(loanCharge)
    .values({
      id: newId(),
      accountId: account.id,
      month: firstOfMonth(input.month),
      kind: input.kind,
      amount: input.amount,
      currency: account.currency,
      status: input.status,
    })
    .onConflictDoUpdate({
      target: [loanCharge.accountId, loanCharge.month, loanCharge.kind],
      set: { amount: input.amount, status: input.status, updatedAt: sql`now()` },
    });
}

/**
 * Update Balance fixes every month's interest and escrow at what's applied, shown "Reconciled"
 * (a capped escrow stays as capped; a month with nothing applied gets no interest line).
 */
export async function freezeLoanCharges(
  db: Db,
  account: AccountRow,
  today: string,
  /** The months to fix, if not the loan's current ones. */
  from?: LoanState,
) {
  const state = from ?? (await loanStates(db, [account], today)).get(account.id);
  for (const m of state?.months ?? []) {
    for (const kind of ["interest", "escrow"] as const) {
      const charge = m[kind];
      if (charge.status === "estimated" && charge.applied === 0n) continue;
      await setLoanCharge(db, account, {
        month: m.month,
        kind,
        amount: charge.applied,
        status: "reconciled",
      });
    }
  }
}

/** Records the loan's terms from `today`'s month on, replacing that month's entry. */
export async function saveLoanTerms(
  db: Db,
  account: Pick<AccountRow, "id" | "currency" | "interestRate" | "minimumPayment" | "escrowAmount">,
  today: string,
) {
  await saveLoanTermsEntry(db, account, { ...account, month: monthOf(today) });
}

/** Writes one `loan_terms` entry, replacing that month's. */
async function saveLoanTermsEntry(
  db: Db,
  account: Pick<AccountRow, "id" | "currency">,
  entry: LoanTerms,
) {
  const values = {
    interestRate: entry.interestRate,
    minimumPayment: entry.minimumPayment,
    escrowAmount: entry.escrowAmount,
  };
  await db
    .insert(loanTerms)
    .values({
      id: newId(),
      accountId: account.id,
      month: firstOfMonth(entry.month),
      currency: account.currency,
      ...values,
    })
    .onConflictDoUpdate({ target: [loanTerms.accountId, loanTerms.month], set: values });
}

/** What Update Balance's interest rate / escrow check does to a loan. */
export interface LoanTermsCheck {
  before: LoanState;
  /** The `loan_terms` entries to write; empty when nothing changes. */
  entries: LoanTerms[];
  /** How much more the new terms charge through `today` (minor units; positive adds debt). */
  extraCharges: bigint;
}

/**
 * Works out Update Balance's check step without writing anything. The new rate or escrow applies
 * from this month on, and the Difference it then shows re-estimates this month with it while
 * earlier months keep theirs. Months before the change keep their terms here too: if no entry
 * covers them yet, the old terms are pinned from the start (otherwise they'd take the first entry,
 * the changed one).
 */
export async function checkLoanTerms(
  db: Db,
  account: AccountRow,
  today: string,
  change: LoanTermsChange,
): Promise<LoanTermsCheck> {
  const month = monthOf(today);
  const before = (await loanStates(db, [account], today)).get(account.id);
  if (!before) throw new Error(`Loan state missing for ${account.id}`);
  const changed = loanTermsEntries(before.terms, month, change);
  const old = termsFor(before.terms, month);
  if (changed.length === 0 || !old) return { before, entries: [], extraCharges: 0n };
  const pinned = before.terms.some((t) => t.month < month)
    ? []
    : [{ ...old, month: EARLIEST_MONTH }];
  const entries = [...pinned, ...changed];
  const preview = new Map([[account.id, withLoanTerms(before.terms, entries)]]);
  const after = (await loanStates(db, [account], today, preview)).get(account.id);
  if (!after) throw new Error(`Loan state missing for ${account.id}`);
  return { before, entries, extraCharges: loanCharges(after.months) - loanCharges(before.months) };
}

/** Writes what `checkLoanTerms` worked out, and this month's terms to the account. */
export async function applyLoanTerms(
  db: Db,
  account: AccountRow,
  today: string,
  check: LoanTermsCheck,
) {
  if (check.entries.length === 0) return;
  // A loan without `loan_terms` entries keeps its terms for earlier months (they're only on the
  // account).
  await keepEarlierTerms(db, account);
  for (const entry of check.entries) await saveLoanTermsEntry(db, account, entry);
  const now = termsFor(withLoanTerms(check.before.terms, check.entries), monthOf(today));
  await db
    .update(budgetAccount)
    .set({ interestRate: now?.interestRate ?? null, escrowAmount: now?.escrowAmount ?? null })
    .where(eq(budgetAccount.id, account.id));
}

/**
 * The terms in effect in `today`'s month, by loan id (loans with `loan_terms` entries). A change
 * not kept going forward ends next month, so the account's own columns can be out of date.
 */
export async function currentLoanTerms(db: Db, accountIds: string[], today: string) {
  const month = monthOf(today);
  const result = new Map<string, LoanTerms>();
  for (const [id, list] of await storedTerms(db, accountIds)) {
    const now = termsFor(list, month);
    if (now) result.set(id, now);
  }
  return result;
}

/**
 * Before a loan with no `loan_terms` rows yet gets new terms, records the ones it had
 * so earlier months keep them: months before the first entry use that entry (`termsFor`).
 */
export async function keepEarlierTerms(
  db: Db,
  account: Pick<AccountRow, "id" | "currency" | "interestRate" | "minimumPayment" | "escrowAmount">,
) {
  const [existing] = await db
    .select({ id: loanTerms.id })
    .from(loanTerms)
    .where(eq(loanTerms.accountId, account.id))
    .limit(1);
  if (existing) return;
  await saveLoanTerms(db, account, `${EARLIEST_MONTH}-01`);
}

/** The date of each loan's latest payment, for the paired category's "Last Paid on …". */
export async function lastLoanPayments(db: Db, budgetId: string, today: string) {
  const rows = await db
    .select({ accountId: transaction.accountId, date: sql<string>`max(${transaction.date})` })
    .from(transaction)
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        inArray(budgetAccount.type, LOAN_TYPES),
        sql`${transaction.amount} > 0`,
        lte(transaction.date, today),
        or(
          isNotNull(transaction.transferTransactionId),
          isNotNull(transaction.transferSubTransactionId),
        ),
      ),
    )
    .groupBy(transaction.accountId);
  return new Map(rows.map((r) => [r.accountId, r.date]));
}

/**
 * For each loan, the cash or credit account of the payment into it that was entered last (not
 * the latest-dated one): Record Payment starts there. Payments from Record Payment and register
 * transfers both count, even one back-dated to before the others.
 *
 * For each credit card, the cash or credit account of the transfer into it entered last: a card's
 * Record Payment prefills it. A transfer from another card counts too, and the last entered wins
 * even when back-dated, as for loans.
 */
export async function lastPaymentSources(db: Db, budgetId: string) {
  const loan = alias(budgetAccount, "paid_to");
  const from = alias(budgetAccount, "paid_from");
  const rows = await db
    .selectDistinctOn([transaction.accountId], {
      accountId: transaction.accountId,
      fromAccountId: from.id,
    })
    .from(transaction)
    .innerJoin(loan, eq(loan.id, transaction.accountId))
    .innerJoin(payee, eq(payee.id, transaction.payeeId))
    .innerJoin(from, eq(from.id, payee.transferAccountId))
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        inArray(loan.type, [...LOAN_TYPES, ...CREDIT_TYPES]),
        inArray(from.type, PAYING_TYPES),
        sql`${transaction.amount} > 0`,
      ),
    )
    .orderBy(transaction.accountId, desc(transaction.createdAt), desc(transaction.id));
  return new Map(rows.map((r) => [r.accountId, r.fromAccountId]));
}
