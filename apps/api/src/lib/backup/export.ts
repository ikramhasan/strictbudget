import {
  accountImportId,
  budgetAccount,
  budgetView,
  category,
  categoryAssignment,
  categoryGroup,
  categoryTarget,
  flagName,
  fxRateOverride,
  loanCharge,
  loanTerms,
  moneyMove,
  monthNote,
  payee,
  payeeRule,
  scheduledSubTransaction,
  scheduledTransaction,
  subTransaction,
  transaction,
} from "@strictbudget/db/schema";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { BudgetRow } from "../budget-access";
import type { Db } from "../ledger";
import { BACKUP_FORMAT, BACKUP_SECTIONS, BACKUP_VERSION, type Backup } from "./schema";

/** A JSON column, as the file's loose object (it's written back as it was). */
const loose = (value: object | null) => (value ?? null) as Record<string, unknown> | null;

/** Rows read per query for the big sections. */
const PAGE = 1000;

type Section = (typeof BACKUP_SECTIONS)[number];
type Rows<S extends Section> = Backup[S];

const str = (n: bigint | null) => (n === null ? null : n.toString());
const iso = (d: Date | null) => (d === null ? null : d.toISOString());

/** Reads one section, in pages of rows ordered by id where it can be big. */
type Reader<S extends Section> = (db: Db, budgetId: string) => AsyncGenerator<Rows<S>>;

async function* once<T>(rows: Promise<T>) {
  yield await rows;
}

async function* paged<T extends { id: string }, R>(
  read: (after: string | null) => Promise<T[]>,
  map: (rows: T[]) => R,
): AsyncGenerator<R> {
  let after: string | null = null;
  for (;;) {
    const rows = await read(after);
    if (rows.length === 0) return;
    yield map(rows);
    if (rows.length < PAGE) return;
    after = rows[rows.length - 1]?.id ?? null;
  }
}

const readers: { [S in Section]: Reader<S> } = {
  categoryGroups: (db, budgetId) =>
    once(
      db
        .select({
          id: categoryGroup.id,
          name: categoryGroup.name,
          sortOrder: categoryGroup.sortOrder,
          hidden: categoryGroup.hidden,
          internal: categoryGroup.internal,
          kind: categoryGroup.kind,
        })
        .from(categoryGroup)
        .where(eq(categoryGroup.budgetId, budgetId))
        .orderBy(asc(categoryGroup.sortOrder), asc(categoryGroup.id)),
    ),
  categories: (db, budgetId) =>
    once(
      db
        .select({
          id: category.id,
          groupId: category.groupId,
          name: category.name,
          note: category.note,
          sortOrder: category.sortOrder,
          hidden: category.hidden,
          internalKind: category.internalKind,
          linkedAccountId: category.linkedAccountId,
          pace: category.pace,
          savings: category.savings,
        })
        .from(category)
        .where(eq(category.budgetId, budgetId))
        .orderBy(asc(category.sortOrder), asc(category.id)),
    ),
  accounts: async function* (db, budgetId) {
    const rows = await db
      .select()
      .from(budgetAccount)
      .where(eq(budgetAccount.budgetId, budgetId))
      .orderBy(asc(budgetAccount.sortOrder), asc(budgetAccount.id));
    yield rows.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      note: a.note,
      sortOrder: a.sortOrder,
      closed: a.closed,
      starredSortOrder: a.starredSortOrder,
      currency: a.currency,
      interestRate: a.interestRate,
      minimumPayment: str(a.minimumPayment),
      escrowAmount: str(a.escrowAmount),
      lastReconciledAt: iso(a.lastReconciledAt),
      pairedCategoryId: a.pairedCategoryId,
      paidOffBannerDismissed: a.paidOffBannerDismissed,
      migratedToAccountId: a.migratedToAccountId,
      csvImportSettings: loose(a.csvImportSettings),
      statementImportSettings: loose(a.statementImportSettings),
    }));
  },
  loanTerms: async function* (db, budgetId) {
    const rows = await db
      .select({ t: loanTerms })
      .from(loanTerms)
      .innerJoin(budgetAccount, eq(budgetAccount.id, loanTerms.accountId))
      .where(eq(budgetAccount.budgetId, budgetId))
      .orderBy(asc(loanTerms.accountId), asc(loanTerms.month));
    yield rows.map(({ t }) => ({
      id: t.id,
      accountId: t.accountId,
      month: t.month,
      interestRate: t.interestRate,
      minimumPayment: str(t.minimumPayment),
      escrowAmount: str(t.escrowAmount),
      currency: t.currency,
    }));
  },
  loanCharges: async function* (db, budgetId) {
    const rows = await db
      .select({ c: loanCharge })
      .from(loanCharge)
      .innerJoin(budgetAccount, eq(budgetAccount.id, loanCharge.accountId))
      .where(eq(budgetAccount.budgetId, budgetId))
      .orderBy(asc(loanCharge.accountId), asc(loanCharge.month), asc(loanCharge.kind));
    yield rows.map(({ c }) => ({
      id: c.id,
      accountId: c.accountId,
      month: c.month,
      kind: c.kind,
      amount: c.amount.toString(),
      currency: c.currency,
      status: c.status,
    }));
  },
  payees: (db, budgetId) =>
    once(
      db
        .select({
          id: payee.id,
          name: payee.name,
          internalKind: payee.internalKind,
          transferAccountId: payee.transferAccountId,
          hidden: payee.hidden,
          categorization: payee.categorization,
          defaultCategoryId: payee.defaultCategoryId,
          carriedCategoryId: payee.carriedCategoryId,
          autoCategoryId: payee.autoCategoryId,
          autoCategorySaved: payee.autoCategorySaved,
        })
        .from(payee)
        .where(eq(payee.budgetId, budgetId))
        .orderBy(asc(payee.id)),
    ),
  payeeRules: async function* (db, budgetId) {
    const rows = await db
      .select()
      .from(payeeRule)
      .where(eq(payeeRule.budgetId, budgetId))
      .orderBy(asc(payeeRule.payeeId), asc(payeeRule.position));
    yield rows.map((r) => ({
      id: r.id,
      payeeId: r.payeeId,
      operator: r.operator,
      text: r.text,
      position: r.position,
      createdAt: r.createdAt.toISOString(),
    }));
  },
  flagNames: (db, budgetId) =>
    once(
      db
        .select({ color: flagName.color, name: flagName.name })
        .from(flagName)
        .where(eq(flagName.budgetId, budgetId))
        .orderBy(asc(flagName.color)),
    ),
  assignments: (db, budgetId) =>
    paged(
      (after) =>
        db
          .select()
          .from(categoryAssignment)
          .where(
            and(
              eq(categoryAssignment.budgetId, budgetId),
              after ? gt(categoryAssignment.id, after) : undefined,
            ),
          )
          .orderBy(asc(categoryAssignment.id))
          .limit(PAGE),
      (rows) =>
        rows.map((a) => ({
          categoryId: a.categoryId,
          month: a.month,
          amount: a.amount.toString(),
          currency: a.currency,
        })),
    ),
  moneyMoves: (db, budgetId) =>
    paged(
      (after) =>
        db
          .select()
          .from(moneyMove)
          .where(and(eq(moneyMove.budgetId, budgetId), after ? gt(moneyMove.id, after) : undefined))
          .orderBy(asc(moneyMove.id))
          .limit(PAGE),
      (rows) =>
        rows.map((m) => ({
          fromCategoryId: m.fromCategoryId,
          toCategoryId: m.toCategoryId,
          fromCategoryName: m.fromCategoryName,
          toCategoryName: m.toCategoryName,
          deletion: m.deletion,
          autoAssignBatchId: m.autoAssignBatchId,
          autoAssignMethod: m.autoAssignMethod,
          month: m.month,
          amount: m.amount.toString(),
          currency: m.currency,
          createdAt: m.createdAt.toISOString(),
        })),
    ),
  targets: async function* (db, budgetId) {
    const rows = await db
      .select()
      .from(categoryTarget)
      .where(eq(categoryTarget.budgetId, budgetId))
      .orderBy(asc(categoryTarget.id));
    yield rows.map((t) => ({
      categoryId: t.categoryId,
      cadence: t.cadence,
      behavior: t.behavior,
      amount: t.amount.toString(),
      currency: t.currency,
      dueDay: t.dueDay,
      dueDate: t.dueDate,
      repeatEvery: t.repeatEvery,
      repeatUnit: t.repeatUnit,
      goal: t.goal,
      goalAmount: t.goalAmount?.toString() ?? null,
      startMonth: t.startMonth,
      startDay: t.startDay,
      snoozedMonth: t.snoozedMonth,
    }));
  },
  monthNotes: (db, budgetId) =>
    once(
      db
        .select({ month: monthNote.month, note: monthNote.note })
        .from(monthNote)
        .where(eq(monthNote.budgetId, budgetId))
        .orderBy(asc(monthNote.month)),
    ),
  views: (db, budgetId) =>
    once(
      db
        .select({ id: budgetView.id, name: budgetView.name, categoryIds: budgetView.categoryIds })
        .from(budgetView)
        .where(eq(budgetView.budgetId, budgetId))
        .orderBy(asc(budgetView.id)),
    ),
  transactions: (db, budgetId) =>
    paged(
      (after) =>
        db
          .select()
          .from(transaction)
          .where(
            and(eq(transaction.budgetId, budgetId), after ? gt(transaction.id, after) : undefined),
          )
          .orderBy(asc(transaction.id))
          .limit(PAGE),
      (rows) =>
        rows.map((t) => ({
          id: t.id,
          accountId: t.accountId,
          date: t.date,
          amount: t.amount.toString(),
          currency: t.currency,
          baseAmount: t.baseAmount.toString(),
          fxRate: t.fxRate,
          fxRateManual: t.fxRateManual,
          payeeId: t.payeeId,
          categoryId: t.categoryId,
          memo: t.memo,
          cleared: t.cleared,
          flag: t.flag,
          approved: t.approved,
          transferTransactionId: t.transferTransactionId,
          transferSubTransactionId: t.transferSubTransactionId,
          importId: t.importId,
          importedPayee: t.importedPayee,
          matchedImport: loose(t.matchedImport),
        })),
    ),
  subTransactions: (db, budgetId) =>
    paged(
      (after) =>
        db
          .select({ s: subTransaction })
          .from(subTransaction)
          .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
          .where(
            and(
              eq(transaction.budgetId, budgetId),
              after ? gt(subTransaction.id, after) : undefined,
            ),
          )
          .orderBy(asc(subTransaction.id))
          .limit(PAGE)
          .then((rows) => rows.map((r) => r.s)),
      (rows) =>
        rows.map((s) => ({
          id: s.id,
          transactionId: s.transactionId,
          sortOrder: s.sortOrder,
          amount: s.amount.toString(),
          currency: s.currency,
          baseAmount: s.baseAmount.toString(),
          payeeId: s.payeeId,
          categoryId: s.categoryId,
          memo: s.memo,
        })),
    ),
  scheduledTransactions: async function* (db, budgetId) {
    const rows = await db
      .select()
      .from(scheduledTransaction)
      .where(eq(scheduledTransaction.budgetId, budgetId))
      .orderBy(asc(scheduledTransaction.id));
    yield rows.map((s) => ({
      id: s.id,
      accountId: s.accountId,
      frequency: s.frequency,
      dateFirst: s.dateFirst,
      dateNext: s.dateNext,
      amount: s.amount.toString(),
      currency: s.currency,
      payeeId: s.payeeId,
      categoryId: s.categoryId,
      memo: s.memo,
      flag: s.flag,
    }));
  },
  scheduledSubTransactions: async function* (db, budgetId) {
    const parents = db
      .select({ id: scheduledTransaction.id })
      .from(scheduledTransaction)
      .where(eq(scheduledTransaction.budgetId, budgetId));
    const rows = await db
      .select()
      .from(scheduledSubTransaction)
      .where(inArray(scheduledSubTransaction.scheduledTransactionId, parents))
      .orderBy(
        asc(scheduledSubTransaction.scheduledTransactionId),
        asc(scheduledSubTransaction.sortOrder),
      );
    yield rows.map((s) => ({
      scheduledTransactionId: s.scheduledTransactionId,
      sortOrder: s.sortOrder,
      amount: s.amount.toString(),
      currency: s.currency,
      payeeId: s.payeeId,
      categoryId: s.categoryId,
      memo: s.memo,
    }));
  },
  fxRateOverrides: (db, budgetId) =>
    once(
      db
        .select({
          date: fxRateOverride.date,
          currency: fxRateOverride.currency,
          rate: fxRateOverride.rate,
        })
        .from(fxRateOverride)
        .where(eq(fxRateOverride.budgetId, budgetId))
        .orderBy(asc(fxRateOverride.date), asc(fxRateOverride.currency)),
    ),
  accountImportIds: (db, budgetId) =>
    once(
      db
        .select({ accountId: accountImportId.accountId, importId: accountImportId.importId })
        .from(accountImportId)
        .innerJoin(budgetAccount, eq(budgetAccount.id, accountImportId.accountId))
        .where(eq(budgetAccount.budgetId, budgetId))
        .orderBy(asc(accountImportId.accountId), asc(accountImportId.importId)),
    ),
};

/**
 * Writes the budget's backup as JSON, section by section, the big ones a page at a time, so a
 * large budget never sits in memory whole.
 */
export async function writeBackup(
  db: Db,
  budget: BudgetRow,
  write: (chunk: string) => Promise<void>,
  now = new Date(),
) {
  const head: Pick<Backup, "format" | "version" | "exportedAt" | "budget"> = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    budget: {
      name: budget.name,
      currency: budget.currency,
      numberFormat: budget.numberFormat,
      currencySymbolPosition: budget.currencySymbolPosition,
      dateFormat: budget.dateFormat,
      createdAt: budget.createdAt.toISOString(),
      expectedIncome: str(budget.expectedIncome),
      expectedIncomeCurrency: budget.expectedIncomeCurrency,
      loanSimulatorBannerDismissed: budget.loanSimulatorBannerDismissed,
      savingsSuggestionDismissed: budget.savingsSuggestionDismissed,
      aiEnabled: budget.aiEnabled,
      aiAssistantButton: budget.aiAssistantButton,
      viewOrder: budget.viewOrder,
    },
  };
  const opening = JSON.stringify(head);
  await write(opening.slice(0, -1));
  for (const section of BACKUP_SECTIONS) {
    await write(`,${JSON.stringify(section)}:[`);
    let first = true;
    for await (const rows of (readers[section] as Reader<Section>)(db, budget.id)) {
      if (rows.length === 0) continue;
      await write(`${first ? "" : ","}${rows.map((row) => JSON.stringify(row)).join(",")}`);
      first = false;
    }
    await write("]");
  }
  await write("}");
}
