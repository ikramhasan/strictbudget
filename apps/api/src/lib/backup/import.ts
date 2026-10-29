import { newId, sql } from "@strictbudget/db";
import {
  accountImportId,
  budget,
  budgetAccount,
  budgetView,
  type CsvImportSettings,
  category,
  categoryAssignment,
  categoryGroup,
  categoryTarget,
  flagName,
  fxRateOverride,
  loanCharge,
  loanTerms,
  type MatchedImport,
  moneyMove,
  monthNote,
  PRESET_BUDGET_VIEWS,
  payee,
  payeeRule,
  type StatementImportSettings,
  scheduledSubTransaction,
  scheduledTransaction,
  subTransaction,
  transaction,
} from "@strictbudget/db/schema";
import type { CurrencyCode } from "@strictbudget/engine";
import { and, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { pauseAudit } from "../audit-context";
import { AppError } from "../errors";
import type { Tx } from "../ledger";
import { BACKUP_SECTIONS, type Backup } from "./schema";

/** Rows per insert statement (well under Postgres's 65,535 parameters). */
const CHUNK = 500;

export type ImportCounts = Record<(typeof BACKUP_SECTIONS)[number], number>;

const invalid = (message: string) => new AppError(400, "INVALID_BACKUP", message);

/** One kind of row's old id → new id. A reference to an id the file doesn't hold is an error. */
class IdMap {
  private readonly ids = new Map<string, string>();
  constructor(private readonly what: string) {}
  /** Gives `old` a fresh UUIDv7 (or the id it must map to). */
  add(old: string, id = newId()) {
    if (this.ids.has(old)) throw invalid(`Two ${this.what} have the id ${old}`);
    this.ids.set(old, id);
    return id;
  }
  get(old: string) {
    const id = this.ids.get(old);
    if (!id) throw invalid(`A row refers to a missing ${this.what.replace(/s$/, "")} (${old})`);
    return id;
  }
  ref(old: string | null) {
    return old === null ? null : this.get(old);
  }
  has(old: string) {
    return this.ids.has(old);
  }
}

async function insertChunks<T extends PgTable>(
  tx: Tx,
  table: T,
  rows: readonly T["$inferInsert"][],
) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx.insert(table).values(rows.slice(i, i + CHUNK) as T["$inferInsert"][]);
  }
}

/**
 * Rows in the order of their old ids. Lists break ties on id (UUIDv7s, in creation order), so
 * new ids handed out in this order keep every such order.
 */
const byId = <T extends { id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const big = (s: string) => BigInt(s);
const bigOrNull = (s: string | null) => (s === null ? null : BigInt(s));

/**
 * Fills the new, empty budget `budgetId` (its internal categories already seeded, nothing else)
 * from a backup. Every row gets a new id and every reference is remapped; the file's internal
 * group and categories map onto the new budget's own. Runs in the caller's transaction, without
 * the change log: the new budget's history starts after its import.
 */
export async function importBackup(tx: Tx, doc: Backup, budgetId: string): Promise<ImportCounts> {
  await pauseAudit(tx);
  const groups = new IdMap("category groups");
  const categories = new IdMap("categories");
  const accounts = new IdMap("accounts");
  const payees = new IdMap("payees");
  const transactions = new IdMap("transactions");
  const subs = new IdMap("split lines");
  const scheduled = new IdMap("scheduled transactions");
  const views = new IdMap("views");

  // The new budget's internal group and categories stand in for the file's.
  const internal = await tx
    .select({ id: category.id, kind: category.internalKind, groupId: category.groupId })
    .from(category)
    .where(eq(category.budgetId, budgetId));
  const internalGroupId = internal[0]?.groupId;
  if (!internalGroupId) throw new Error("The new budget's internal categories are missing");
  for (const g of doc.categoryGroups) {
    if (g.internal) groups.add(g.id, internalGroupId);
  }

  await insertChunks(
    tx,
    categoryGroup,
    byId(doc.categoryGroups)
      .filter((g) => !g.internal)
      .map((g) => ({
        id: groups.add(g.id),
        budgetId,
        name: g.name,
        sortOrder: g.sortOrder,
        hidden: g.hidden,
        kind: g.kind,
      })),
  );

  // Accounts before categories (payment categories point at them); their own category and
  // account references are set once those exist.
  await insertChunks(
    tx,
    budgetAccount,
    byId(doc.accounts).map((a) => ({
      id: accounts.add(a.id),
      budgetId,
      name: a.name,
      type: a.type,
      note: a.note,
      sortOrder: a.sortOrder,
      closed: a.closed,
      starredSortOrder: a.starredSortOrder,
      currency: a.currency,
      interestRate: a.interestRate,
      minimumPayment: bigOrNull(a.minimumPayment),
      escrowAmount: bigOrNull(a.escrowAmount),
      lastReconciledAt: a.lastReconciledAt ? new Date(a.lastReconciledAt) : null,
      paidOffBannerDismissed: a.paidOffBannerDismissed,
      csvImportSettings: (a.csvImportSettings ?? null) as CsvImportSettings | null,
      statementImportSettings: (a.statementImportSettings ??
        null) as StatementImportSettings | null,
    })),
  );
  await insertChunks(
    tx,
    accountImportId,
    doc.accountImportIds.map((r) => ({
      accountId: accounts.get(r.accountId),
      importId: r.importId,
    })),
  );

  const own = new Map(internal.map((c) => [c.kind, c.id]));
  const listed = [];
  for (const c of byId(doc.categories)) {
    if (c.internalKind) {
      const id = own.get(c.internalKind);
      if (!id) throw new Error(`The new budget has no ${c.internalKind} category`);
      categories.add(c.id, id);
      continue;
    }
    listed.push({
      id: categories.add(c.id),
      budgetId,
      groupId: groups.get(c.groupId),
      name: c.name,
      note: c.note,
      sortOrder: c.sortOrder,
      hidden: c.hidden,
      linkedAccountId: accounts.ref(c.linkedAccountId),
      pace: c.pace ?? null,
      savings: c.savings ?? false,
    });
  }
  await insertChunks(tx, category, listed);

  for (const a of doc.accounts) {
    if (!a.pairedCategoryId && !a.migratedToAccountId) continue;
    await tx
      .update(budgetAccount)
      .set({
        pairedCategoryId: categories.ref(a.pairedCategoryId),
        migratedToAccountId: accounts.ref(a.migratedToAccountId),
      })
      .where(eq(budgetAccount.id, accounts.get(a.id)));
  }

  await insertChunks(
    tx,
    loanTerms,
    doc.loanTerms.map((t) => ({
      id: newId(),
      accountId: accounts.get(t.accountId),
      month: t.month,
      interestRate: t.interestRate,
      minimumPayment: bigOrNull(t.minimumPayment),
      escrowAmount: bigOrNull(t.escrowAmount),
      currency: t.currency,
    })),
  );
  await insertChunks(
    tx,
    loanCharge,
    doc.loanCharges.map((c) => ({
      id: newId(),
      accountId: accounts.get(c.accountId),
      month: c.month,
      kind: c.kind,
      amount: big(c.amount),
      currency: c.currency,
      status: c.status,
    })),
  );

  await insertChunks(
    tx,
    payee,
    byId(doc.payees).map((p) => ({
      id: payees.add(p.id),
      budgetId,
      name: p.name,
      internalKind: p.internalKind,
      transferAccountId: accounts.ref(p.transferAccountId),
      hidden: p.hidden,
      categorization: p.categorization,
      defaultCategoryId: categories.ref(p.defaultCategoryId),
      carriedCategoryId: categories.ref(p.carriedCategoryId),
      autoCategoryId: categories.ref(p.autoCategoryId ?? null),
      autoCategorySaved: p.autoCategorySaved ?? false,
    })),
  );
  await insertChunks(
    tx,
    payeeRule,
    doc.payeeRules.map((r) => ({
      id: newId(),
      budgetId,
      payeeId: payees.get(r.payeeId),
      operator: r.operator,
      text: r.text,
      position: r.position,
      // The newest rule wins when several payees' rules match: keep their order.
      createdAt: new Date(r.createdAt),
    })),
  );
  await insertChunks(
    tx,
    flagName,
    doc.flagNames.map((f) => ({ id: newId(), budgetId, color: f.color, name: f.name })),
  );

  await insertChunks(
    tx,
    categoryAssignment,
    doc.assignments.map((a) => ({
      id: newId(),
      budgetId,
      categoryId: categories.get(a.categoryId),
      month: a.month,
      amount: big(a.amount),
      currency: a.currency,
    })),
  );
  // Recent Moves: a category the file no longer has keeps its name, as after a deletion.
  const batches = new Map<string, string>();
  await insertChunks(
    tx,
    moneyMove,
    doc.moneyMoves.map((m) => {
      const batch = m.autoAssignBatchId;
      if (batch && !batches.has(batch)) batches.set(batch, newId());
      return {
        id: newId(),
        budgetId,
        fromCategoryId:
          m.fromCategoryId && categories.has(m.fromCategoryId)
            ? categories.get(m.fromCategoryId)
            : null,
        toCategoryId:
          m.toCategoryId && categories.has(m.toCategoryId) ? categories.get(m.toCategoryId) : null,
        fromCategoryName: m.fromCategoryName,
        toCategoryName: m.toCategoryName,
        deletion: m.deletion,
        autoAssignBatchId: batch ? (batches.get(batch) ?? null) : null,
        autoAssignMethod: m.autoAssignMethod,
        month: m.month,
        amount: big(m.amount),
        currency: m.currency,
        createdAt: new Date(m.createdAt),
      };
    }),
  );
  await insertChunks(
    tx,
    categoryTarget,
    doc.targets.map((t) => ({
      id: newId(),
      budgetId,
      categoryId: categories.get(t.categoryId),
      cadence: t.cadence,
      behavior: t.behavior,
      amount: big(t.amount),
      currency: t.currency,
      dueDay: t.dueDay,
      dueDate: t.dueDate,
      repeatEvery: t.repeatEvery,
      repeatUnit: t.repeatUnit,
      goal: t.goal ?? null,
      goalAmount: t.goalAmount == null ? null : big(t.goalAmount),
      startMonth: t.startMonth,
      startDay: t.startDay,
      snoozedMonth: t.snoozedMonth,
    })),
  );
  await insertChunks(
    tx,
    monthNote,
    doc.monthNotes.map((n) => ({ id: newId(), budgetId, month: n.month, note: n.note })),
  );
  await insertChunks(
    tx,
    budgetView,
    byId(doc.views).map((v) => ({
      id: views.add(v.id),
      budgetId,
      name: v.name,
      // Ids of deleted categories are dropped when read anyway.
      categoryIds: v.categoryIds.filter((id) => categories.has(id)).map((id) => categories.get(id)),
    })),
  );

  // Transactions, then their lines, then the transfer links between them.
  await insertChunks(
    tx,
    transaction,
    byId(doc.transactions).map((t) => ({
      id: transactions.add(t.id),
      budgetId,
      accountId: accounts.get(t.accountId),
      date: t.date,
      amount: big(t.amount),
      currency: t.currency,
      baseAmount: big(t.baseAmount),
      fxRate: t.fxRate,
      fxRateManual: t.fxRateManual,
      payeeId: payees.ref(t.payeeId),
      categoryId: categories.ref(t.categoryId),
      memo: t.memo,
      cleared: t.cleared,
      flag: t.flag,
      approved: t.approved,
      importId: t.importId ?? null,
      importedPayee: t.importedPayee ?? null,
      matchedImport: (t.matchedImport ?? null) as MatchedImport | null,
    })),
  );
  await insertChunks(
    tx,
    subTransaction,
    byId(doc.subTransactions).map((s) => ({
      id: subs.add(s.id),
      transactionId: transactions.get(s.transactionId),
      sortOrder: s.sortOrder,
      amount: big(s.amount),
      currency: s.currency,
      baseAmount: big(s.baseAmount),
      payeeId: payees.ref(s.payeeId),
      categoryId: categories.ref(s.categoryId),
      memo: s.memo,
    })),
  );
  const links = doc.transactions.filter(
    (t) => t.transferTransactionId !== null || t.transferSubTransactionId !== null,
  );
  for (let i = 0; i < links.length; i += CHUNK) {
    const chunk = links.slice(i, i + CHUNK);
    const ids = chunk.map((t) => transactions.get(t.id));
    const toTransaction = chunk.map((t) => transactions.ref(t.transferTransactionId));
    const toLine = chunk.map((t) => subs.ref(t.transferSubTransactionId));
    await tx.execute(sql`
      update "transaction" t
      set transfer_transaction_id = l.to_transaction, transfer_sub_transaction_id = l.to_line
      from unnest(${sql.param(ids)}::text[], ${sql.param(toTransaction)}::text[],
        ${sql.param(toLine)}::text[]) as l(id, to_transaction, to_line)
      where t.id = l.id`);
  }

  await insertChunks(
    tx,
    scheduledTransaction,
    byId(doc.scheduledTransactions).map((s) => ({
      id: scheduled.add(s.id),
      budgetId,
      accountId: accounts.get(s.accountId),
      frequency: s.frequency,
      dateFirst: s.dateFirst,
      dateNext: s.dateNext,
      amount: big(s.amount),
      currency: s.currency,
      payeeId: payees.ref(s.payeeId),
      categoryId: categories.ref(s.categoryId),
      memo: s.memo,
      flag: s.flag,
    })),
  );
  await insertChunks(
    tx,
    scheduledSubTransaction,
    doc.scheduledSubTransactions.map((s) => ({
      id: newId(),
      scheduledTransactionId: scheduled.get(s.scheduledTransactionId),
      sortOrder: s.sortOrder,
      amount: big(s.amount),
      currency: s.currency,
      payeeId: payees.ref(s.payeeId),
      categoryId: categories.ref(s.categoryId),
      memo: s.memo,
    })),
  );
  await insertChunks(
    tx,
    fxRateOverride,
    doc.fxRateOverrides.map((o) => ({
      id: newId(),
      budgetId,
      date: o.date,
      currency: o.currency,
      rate: o.rate,
    })),
  );

  const presets = new Set<string>(PRESET_BUDGET_VIEWS);
  await tx
    .update(budget)
    .set({
      createdAt: new Date(doc.budget.createdAt),
      expectedIncome: bigOrNull(doc.budget.expectedIncome),
      expectedIncomeCurrency: doc.budget.expectedIncomeCurrency as CurrencyCode | null,
      loanSimulatorBannerDismissed: doc.budget.loanSimulatorBannerDismissed,
      savingsSuggestionDismissed: doc.budget.savingsSuggestionDismissed ?? false,
      aiEnabled: doc.budget.aiEnabled,
      aiAssistantButton: doc.budget.aiAssistantButton,
      viewOrder:
        doc.budget.viewOrder?.flatMap((key) =>
          presets.has(key) ? [key] : views.has(key) ? [views.get(key)] : [],
        ) ?? null,
    })
    .where(and(eq(budget.id, budgetId)));

  return Object.fromEntries(
    BACKUP_SECTIONS.map((section) => [section, doc[section].length]),
  ) as ImportCounts;
}
