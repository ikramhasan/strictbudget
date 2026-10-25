import { newId } from "@strictbudget/db";
import {
  budget,
  budgetAccount,
  budgetMember,
  budgetView,
  category,
  categoryGroup,
  categoryTarget,
  flagName,
  payee,
  payeeRule,
  scheduledSubTransaction,
  scheduledTransaction,
} from "@strictbudget/db/schema";
import { accountFamily, monthOf } from "@strictbudget/engine";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { insertStartingBalance, internalCategoryId, type Tx, transferPayeeId } from "./ledger";
import { saveLoanTerms } from "./loans";
import { payeeCategories } from "./payee-categories";

type BudgetRow = typeof budget.$inferSelect;

/**
 * Each payee's Categorization setting, and its auto-categorization default (the transactions it
 * came from stay behind, so the copy carries it). An "Always use my choice" payee keeps the
 * chosen category, mapped to the new budget's category.
 */
async function copyPayeeCategories(
  tx: Tx,
  oldBudgetId: string,
  ids: { categoryIds: ReadonlyMap<string, string>; payeeIds: ReadonlyMap<string, string> },
) {
  const rows = await tx
    .select({
      id: payee.id,
      categorization: payee.categorization,
      defaultCategoryId: payee.defaultCategoryId,
      carriedCategoryId: payee.carriedCategoryId,
      autoCategoryId: payee.autoCategoryId,
      autoCategorySaved: payee.autoCategorySaved,
    })
    .from(payee)
    .where(
      and(
        eq(payee.budgetId, oldBudgetId),
        isNull(payee.internalKind),
        isNull(payee.transferAccountId),
      ),
    );
  const history = await payeeCategories(tx, oldBudgetId, rows);
  const mapped = (id: string | null | undefined) => (id ? (ids.categoryIds.get(id) ?? null) : null);
  for (const p of rows) {
    const id = ids.payeeIds.get(p.id);
    const carriedCategoryId = mapped(history.get(p.id)?.autoCategoryId);
    const defaultCategoryId = p.categorization === "always" ? mapped(p.defaultCategoryId) : null;
    const categorization =
      p.categorization === "always" && !defaultCategoryId ? "auto" : p.categorization;
    if (!id || (categorization === "auto" && !carriedCategoryId)) continue;
    await tx
      .update(payee)
      .set({ categorization, defaultCategoryId, carriedCategoryId })
      .where(eq(payee.id, id));
  }
}

/**
 * What a fresh start adds to the old budget's name: "Household (Archived on 2026-10-15)", the
 * date always ISO whatever the budget's date format.
 */
export const ARCHIVED_STAMP = "(Archived on ";

/**
 * Copies the old budget's setup into the freshly created `newBudgetId`: partners, category
 * groups and categories (order, hidden flags, notes, targets, spending pace settings), payees
 * and their renaming rules, flag names, and accounts (with their transfer payees), each starting
 * at $0 with a $0 Starting Balance on `date` for the user to update, and scheduled transactions,
 * unchanged. No transactions come along. Then archives the old budget.
 */
export async function copyIntoFreshStart(
  tx: Tx,
  input: { old: BudgetRow; newBudgetId: string; ownerId: string; date: string },
) {
  const { old, newBudgetId, ownerId, date } = input;

  // Partners keep their access and role; the owner was added when the budget was created.
  const members = await tx
    .select()
    .from(budgetMember)
    .where(and(eq(budgetMember.budgetId, old.id), ne(budgetMember.userId, ownerId)));
  if (members.length > 0) {
    await tx.insert(budgetMember).values(
      members.map((m) => ({
        id: newId(),
        budgetId: newBudgetId,
        userId: m.userId,
        role: m.role,
      })),
    );
  }

  // Accounts first, so payment categories can point at the new ones.
  const accounts = await tx
    .select()
    .from(budgetAccount)
    .where(eq(budgetAccount.budgetId, old.id))
    .orderBy(asc(budgetAccount.sortOrder), asc(budgetAccount.id));
  const accountIds = new Map<string, string>();
  /** Old transfer payee → the new account's. */
  const payeeIds = new Map<string, string>();
  const oldTransferPayees = new Map(
    (
      await tx
        .select({ id: payee.id, accountId: payee.transferAccountId })
        .from(payee)
        .where(eq(payee.budgetId, old.id))
    ).flatMap((p) => (p.accountId ? [[p.accountId, p.id] as const] : [])),
  );
  for (const a of accounts) {
    const id = newId();
    accountIds.set(a.id, id);
    await tx.insert(budgetAccount).values({
      id,
      budgetId: newBudgetId,
      name: a.name,
      type: a.type,
      note: a.note,
      sortOrder: a.sortOrder,
      closed: a.closed,
      starredSortOrder: a.starredSortOrder,
      currency: a.currency,
      interestRate: a.interestRate,
      minimumPayment: a.minimumPayment,
      escrowAmount: a.escrowAmount,
    });
    const transferPayee = await transferPayeeId(tx, { id, budgetId: newBudgetId, name: a.name });
    const oldTransferPayee = oldTransferPayees.get(a.id);
    if (oldTransferPayee) payeeIds.set(oldTransferPayee, transferPayee);
    await insertStartingBalance(tx, {
      budgetId: newBudgetId,
      accountId: id,
      type: a.type,
      amount: 0n,
      currency: a.currency,
      date,
    });
  }

  // People's payees, hidden ones still hidden; the internal ones are recreated on first use,
  // transfer ones came with the accounts.
  const payees = await tx
    .select({ id: payee.id, name: payee.name, hidden: payee.hidden })
    .from(payee)
    .where(
      and(eq(payee.budgetId, old.id), isNull(payee.internalKind), isNull(payee.transferAccountId)),
    );
  if (payees.length > 0) {
    const copies = payees.map((p) => {
      const id = newId();
      payeeIds.set(p.id, id);
      return { id, budgetId: newBudgetId, name: p.name, hidden: p.hidden };
    });
    await tx.insert(payee).values(copies);
  }

  // Renaming rules come along on both kinds of payee, in order.
  const rules = await tx
    .select()
    .from(payeeRule)
    .where(eq(payeeRule.budgetId, old.id))
    .orderBy(asc(payeeRule.createdAt), asc(payeeRule.id));
  const ruleCopies = rules.flatMap((r) => {
    const payeeId = payeeIds.get(r.payeeId);
    return payeeId
      ? [
          {
            id: newId(),
            budgetId: newBudgetId,
            payeeId,
            operator: r.operator,
            text: r.text,
            position: r.position,
            // Keeps which rule is newest when several match.
            createdAt: r.createdAt,
          },
        ]
      : [];
  });
  if (ruleCopies.length > 0) await tx.insert(payeeRule).values(ruleCopies);

  const flags = await tx.select().from(flagName).where(eq(flagName.budgetId, old.id));
  if (flags.length > 0) {
    await tx
      .insert(flagName)
      .values(
        flags.map((f) => ({ id: newId(), budgetId: newBudgetId, color: f.color, name: f.name })),
      );
  }

  const groups = await tx
    .select()
    .from(categoryGroup)
    .where(and(eq(categoryGroup.budgetId, old.id), eq(categoryGroup.internal, false)));
  const groupIds = new Map<string, string>();
  for (const g of groups) {
    const id = newId();
    groupIds.set(g.id, id);
    await tx.insert(categoryGroup).values({
      id,
      budgetId: newBudgetId,
      name: g.name,
      sortOrder: g.sortOrder,
      hidden: g.hidden,
      kind: g.kind,
    });
  }

  const categories = await tx
    .select()
    .from(category)
    .where(and(eq(category.budgetId, old.id), isNull(category.internalKind)));
  const targets = new Map(
    (await tx.select().from(categoryTarget).where(eq(categoryTarget.budgetId, old.id))).map((t) => [
      t.categoryId,
      t,
    ]),
  );
  const categoryIds = new Map<string, string>();
  for (const c of categories) {
    const groupId = groupIds.get(c.groupId);
    if (!groupId) continue;
    const id = newId();
    categoryIds.set(c.id, id);
    await tx.insert(category).values({
      id,
      budgetId: newBudgetId,
      groupId,
      name: c.name,
      note: c.note,
      sortOrder: c.sortOrder,
      hidden: c.hidden,
      linkedAccountId: c.linkedAccountId ? (accountIds.get(c.linkedAccountId) ?? null) : null,
      pace: c.pace,
    });
    const target = targets.get(c.id);
    if (target) {
      // The new budget starts on `date`, so its targets start in that month.
      await tx.insert(categoryTarget).values({
        id: newId(),
        budgetId: newBudgetId,
        categoryId: id,
        cadence: target.cadence,
        behavior: target.behavior,
        amount: target.amount,
        currency: target.currency,
        dueDay: target.dueDay,
        dueDate: target.dueDate,
        repeatEvery: target.repeatEvery,
        repeatUnit: target.repeatUnit,
        startMonth: `${monthOf(date)}-01`,
        // A weekly target begun this month keeps its start day.
        startDay: monthOf(target.startMonth) === monthOf(date) ? target.startDay : null,
      });
    }
  }

  // Loans keep their paired category and their current terms, keyed by the fresh start's month.
  for (const a of accounts) {
    const id = accountIds.get(a.id);
    if (!id || accountFamily(a.type) !== "loan") continue;
    await saveLoanTerms(tx, { ...a, id }, date);
    const paired = a.pairedCategoryId ? categoryIds.get(a.pairedCategoryId) : undefined;
    if (paired) {
      await tx
        .update(budgetAccount)
        .set({ pairedCategoryId: paired })
        .where(eq(budgetAccount.id, id));
    }
  }

  // Ready to Assign and Uncategorized are seeded with every budget.
  for (const kind of ["ready_to_assign", "uncategorized"] as const) {
    categoryIds.set(
      await internalCategoryId(tx, old.id, kind),
      await internalCategoryId(tx, newBudgetId, kind),
    );
  }
  await copyPayeeCategories(tx, old.id, { categoryIds, payeeIds });
  await copySchedules(tx, old.id, newBudgetId, { accountIds, categoryIds, payeeIds });
  await copyViews(tx, old, newBudgetId, categoryIds);
  // The budget's settings carry over, its AI settings with them.
  await tx
    .update(budget)
    .set({ aiEnabled: old.aiEnabled, aiAssistantButton: old.aiAssistantButton })
    .where(eq(budget.id, newBudgetId));

  await tx
    .update(budget)
    .set({
      name: `${old.name} ${ARCHIVED_STAMP}${date})`,
      archivedAt: new Date(),
    })
    .where(eq(budget.id, old.id));
}

/**
 * Copies the custom views (onto the new categories) and the Manage Views order.
 */
async function copyViews(
  tx: Tx,
  old: BudgetRow,
  newBudgetId: string,
  categoryIds: ReadonlyMap<string, string>,
) {
  const views = await tx.select().from(budgetView).where(eq(budgetView.budgetId, old.id));
  const viewIds = new Map(views.map((v) => [v.id, newId()]));
  if (views.length > 0) {
    await tx.insert(budgetView).values(
      views.map((v) => ({
        id: viewIds.get(v.id) ?? newId(),
        budgetId: newBudgetId,
        name: v.name,
        categoryIds: v.categoryIds.flatMap((id) => {
          const mapped = categoryIds.get(id);
          return mapped ? [mapped] : [];
        }),
      })),
    );
  }
  if (old.viewOrder) {
    // Preset keys stay as they are; view ids move to the copies.
    const viewOrder = old.viewOrder.map((key) => viewIds.get(key) ?? key);
    await tx.update(budget).set({ viewOrder }).where(eq(budget.id, newBudgetId));
  }
}

/** Copies the old budget's scheduled transactions (and split lines) onto the new ids. */
async function copySchedules(
  tx: Tx,
  oldBudgetId: string,
  newBudgetId: string,
  ids: {
    accountIds: ReadonlyMap<string, string>;
    categoryIds: ReadonlyMap<string, string>;
    payeeIds: ReadonlyMap<string, string>;
  },
) {
  const mapped = (map: ReadonlyMap<string, string>, id: string | null) =>
    id ? (map.get(id) ?? null) : null;
  const schedules = await tx
    .select()
    .from(scheduledTransaction)
    .where(eq(scheduledTransaction.budgetId, oldBudgetId));
  if (schedules.length === 0) return;
  const lines = await tx
    .select()
    .from(scheduledSubTransaction)
    .where(
      inArray(
        scheduledSubTransaction.scheduledTransactionId,
        schedules.map((s) => s.id),
      ),
    );
  for (const s of schedules) {
    const accountId = ids.accountIds.get(s.accountId);
    if (!accountId) continue;
    const id = newId();
    await tx.insert(scheduledTransaction).values({
      id,
      budgetId: newBudgetId,
      accountId,
      frequency: s.frequency,
      dateFirst: s.dateFirst,
      dateNext: s.dateNext,
      amount: s.amount,
      currency: s.currency,
      payeeId: mapped(ids.payeeIds, s.payeeId),
      categoryId: mapped(ids.categoryIds, s.categoryId),
      memo: s.memo,
      flag: s.flag,
    });
    const own = lines.filter((l) => l.scheduledTransactionId === s.id);
    if (own.length > 0) {
      await tx.insert(scheduledSubTransaction).values(
        own.map((l) => ({
          id: newId(),
          scheduledTransactionId: id,
          sortOrder: l.sortOrder,
          amount: l.amount,
          currency: l.currency,
          payeeId: mapped(ids.payeeIds, l.payeeId),
          categoryId: mapped(ids.categoryIds, l.categoryId),
          memo: l.memo,
        })),
      );
    }
  }
}
