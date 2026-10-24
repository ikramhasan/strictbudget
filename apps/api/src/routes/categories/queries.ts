import { newId, sql } from "@strictbudget/db";
import {
  category,
  categoryAssignment,
  categoryGroup,
  categoryTarget,
  moneyMove,
  payee,
  scheduledSubTransaction,
  scheduledTransaction,
  subTransaction,
  transaction,
} from "@strictbudget/db/schema";
import { monthOf } from "@strictbudget/engine";
import { type AnyColumn, and, asc, count, eq, inArray, isNull, max, ne } from "drizzle-orm";
import { adjustAssigned } from "../../lib/assignments";
import { AppError } from "../../lib/errors";
import { type Db, internalCategoryId } from "../../lib/ledger";

export type CategoryRow = typeof category.$inferSelect;
export type CategoryGroupRow = typeof categoryGroup.$inferSelect;
export type TargetRow = typeof categoryTarget.$inferSelect;

export function toTargetJson(t: TargetRow) {
  return {
    cadence: t.cadence,
    behavior: t.behavior,
    amount: t.amount.toString(),
    currency: t.currency,
    dueDay: t.dueDay,
    dueDate: t.dueDate,
    repeatEvery: t.repeatEvery,
    repeatUnit: t.repeatUnit,
    startMonth: monthOf(t.startMonth),
    startDay: t.startDay,
    snoozedMonth: t.snoozedMonth && monthOf(t.snoozedMonth),
  };
}

export interface CategoryUsage {
  transactionCount: number;
  hasAssignedMoney: boolean;
}

export function toCategoryJson(
  c: CategoryRow,
  hasTransactions = false,
  target: TargetRow | null = null,
  usage: CategoryUsage = { transactionCount: 0, hasAssignedMoney: false },
) {
  return {
    id: c.id,
    groupId: c.groupId,
    name: c.name,
    note: c.note,
    hidden: c.hidden,
    linkedAccountId: c.linkedAccountId,
    hasTransactions,
    ...usage,
    target: target && toTargetJson(target),
  };
}

export async function loadCategoryJson(
  db: Db,
  budgetId: string,
  row: CategoryRow,
  target: TargetRow | null | undefined,
) {
  const usage = await categoryUsage(db, budgetId, [row.id]);
  return toCategoryJson(row, await hasHistory(db, [row.id]), target ?? null, usage.get(row.id));
}

export function toGroupJson(
  g: CategoryGroupRow,
  categories: CategoryRow[],
  used: ReadonlySet<string> = new Set(),
  targets: ReadonlyMap<string, TargetRow> = new Map(),
  usage: ReadonlyMap<string, CategoryUsage> = new Map(),
) {
  return {
    id: g.id,
    name: g.name,
    hidden: g.hidden,
    kind: g.kind,
    categories: categories.map((c) =>
      toCategoryJson(c, used.has(c.id), targets.get(c.id), usage.get(c.id)),
    ),
  };
}

/** Visible-to-users groups and categories (internal ones excluded), in display order. */
export async function listCategoryTree(db: Db, budgetId: string) {
  const groups = await db
    .select()
    .from(categoryGroup)
    .where(and(eq(categoryGroup.budgetId, budgetId), eq(categoryGroup.internal, false)))
    .orderBy(
      sql`${categoryGroup.kind} is null`,
      asc(categoryGroup.sortOrder),
      asc(categoryGroup.id),
    );
  const categories = await db
    .select()
    .from(category)
    .where(and(eq(category.budgetId, budgetId), isNull(category.internalKind)))
    .orderBy(asc(category.sortOrder), asc(category.id));
  const usage = await categoryUsage(db, budgetId);
  const used = new Set([...usage].filter(([, u]) => u.transactionCount > 0).map(([id]) => id));
  const targetRows = await db
    .select()
    .from(categoryTarget)
    .where(eq(categoryTarget.budgetId, budgetId));
  const targets = new Map(targetRows.map((t) => [t.categoryId, t]));
  return {
    readyToAssignCategoryId: await internalCategoryId(db, budgetId, "ready_to_assign"),
    uncategorizedCategoryId: await internalCategoryId(db, budgetId, "uncategorized"),
    groups: groups.map((g) =>
      toGroupJson(
        g,
        categories.filter((c) => c.groupId === g.id),
        used,
        targets,
        usage,
      ),
    ),
  };
}

export async function findGroup(db: Db, budgetId: string, groupId: string) {
  const [row] = await db
    .select()
    .from(categoryGroup)
    .where(
      and(
        eq(categoryGroup.id, groupId),
        eq(categoryGroup.budgetId, budgetId),
        eq(categoryGroup.internal, false),
      ),
    );
  if (!row) throw new AppError(404, "NOT_FOUND", "Category group not found");
  return row;
}

export async function findCategory(db: Db, budgetId: string, categoryId: string) {
  const [row] = await db
    .select()
    .from(category)
    .where(
      and(
        eq(category.id, categoryId),
        eq(category.budgetId, budgetId),
        isNull(category.internalKind),
      ),
    );
  if (!row) throw new AppError(404, "NOT_FOUND", "Category not found");
  return row;
}

async function nextSortOrder(
  db: Db,
  table: typeof category | typeof categoryGroup,
  where: ReturnType<typeof eq>,
) {
  const [row] = await db
    .select({ value: max(table.sortOrder) })
    .from(table)
    .where(where);
  return (row?.value ?? -1) + 1;
}

export async function insertGroup(db: Db, budgetId: string, name: string) {
  const sortOrder = await nextSortOrder(db, categoryGroup, eq(categoryGroup.budgetId, budgetId));
  const [row] = await db
    .insert(categoryGroup)
    .values({ id: newId(), budgetId, name, sortOrder })
    .returning();
  if (!row) throw new Error("Category group insert returned nothing");
  return row;
}

export async function insertCategory(db: Db, budgetId: string, groupId: string, name: string) {
  const sortOrder = await nextSortOrder(db, category, eq(category.groupId, groupId));
  const [row] = await db
    .insert(category)
    .values({ id: newId(), budgetId, groupId, name, sortOrder })
    .returning();
  if (!row) throw new Error("Category insert returned nothing");
  return row;
}

export async function findTarget(db: Db, categoryId: string) {
  const [row] = await db
    .select()
    .from(categoryTarget)
    .where(eq(categoryTarget.categoryId, categoryId));
  return row ?? null;
}

export function managedError(message: string) {
  return new AppError(409, "MANAGED_CATEGORY", message);
}

/** Whether any transaction (scheduled ones included) uses one of these categories. */
export async function hasHistory(db: Db, categoryIds: readonly string[]) {
  if (categoryIds.length === 0) return false;
  const [row] = await db
    .select({ id: transaction.id })
    .from(transaction)
    .where(inArray(transaction.categoryId, [...categoryIds]))
    .limit(1);
  const [line] = await db
    .select({ id: subTransaction.id })
    .from(subTransaction)
    .where(inArray(subTransaction.categoryId, [...categoryIds]))
    .limit(1);
  const [scheduled] = await db
    .select({ id: scheduledTransaction.id })
    .from(scheduledTransaction)
    .where(inArray(scheduledTransaction.categoryId, [...categoryIds]))
    .limit(1);
  const [scheduledLine] = await db
    .select({ id: scheduledSubTransaction.id })
    .from(scheduledSubTransaction)
    .where(inArray(scheduledSubTransaction.categoryId, [...categoryIds]))
    .limit(1);
  return Boolean(row ?? line ?? scheduled ?? scheduledLine);
}

/**
 * Moves the history of categories that are about to be deleted to `targetId`, which must be
 * another category of the budget (Ready to Assign and Uncategorized included, payment categories
 * not). Without a target, deleting a category with history is refused; one with only assigned
 * money gives it back to Ready to Assign. Either way Recent Moves keeps the categories' moves.
 */
export async function reassignHistory(
  db: Db,
  budgetId: string,
  categoryIds: readonly string[],
  targetId: string | undefined,
  userId: string,
) {
  if (!targetId && (await hasHistory(db, categoryIds))) {
    throw new AppError(
      409,
      "CATEGORY_HAS_HISTORY",
      "This category has transactions. Choose a category to move them to.",
    );
  }
  const [target] = targetId
    ? await db
        .select()
        .from(category)
        .where(and(eq(category.id, targetId), eq(category.budgetId, budgetId)))
    : [];
  if (targetId && !target) {
    throw new AppError(404, "NOT_FOUND", "The category to move history to wasn't found");
  }
  if (target && (categoryIds.includes(target.id) || target.linkedAccountId)) {
    throw new AppError(400, "BAD_REQUEST", "History can't be moved to that category");
  }
  await recordDeletion(
    db,
    budgetId,
    categoryIds,
    target && !target.internalKind
      ? target.id
      : await internalCategoryId(db, budgetId, "ready_to_assign"),
    userId,
  );
  if (!target) return;
  // The assigned money goes along (and with it what's available). Moved to Ready to Assign or
  // Uncategorized, it just returns to Ready to Assign with the deleted rows.
  const assignments = target.internalKind
    ? []
    : await db
        .select()
        .from(categoryAssignment)
        .where(inArray(categoryAssignment.categoryId, [...categoryIds]));
  for (const a of assignments) {
    await adjustAssigned(
      db,
      { id: budgetId, currency: a.currency },
      target.id,
      monthOf(a.month),
      a.amount,
    );
  }
  await db
    .update(transaction)
    .set({ categoryId: target.id })
    .where(inArray(transaction.categoryId, [...categoryIds]));
  // A payee's stored auto-categorization default follows its transactions, as the replayed one
  // did before it was stored (Uncategorized is never a default).
  await db
    .update(payee)
    .set({ autoCategoryId: target.internalKind === "uncategorized" ? null : target.id })
    .where(inArray(payee.autoCategoryId, [...categoryIds]));
  await db
    .update(subTransaction)
    .set({ categoryId: target.id })
    .where(inArray(subTransaction.categoryId, [...categoryIds]));
  await db
    .update(scheduledTransaction)
    .set({ categoryId: target.id })
    .where(inArray(scheduledTransaction.categoryId, [...categoryIds]));
  await db
    .update(scheduledSubTransaction)
    .set({ categoryId: target.id })
    .where(inArray(scheduledSubTransaction.categoryId, [...categoryIds]));
}

/**
 * Recent Moves for categories about to be deleted: their earlier moves stay, naming the "deleted
 * category", and the delete itself is logged, each month's assigned money going to
 * `destinationId` (the category picked, or Ready to Assign). A negative amount moves the other way.
 */
async function recordDeletion(
  db: Db,
  budgetId: string,
  categoryIds: readonly string[],
  destinationId: string,
  userId: string,
) {
  if (categoryIds.length === 0) return;
  const rows = await db
    .select({ id: category.id, name: category.name })
    .from(category)
    .where(inArray(category.id, [...categoryIds]));
  const names = new Map(rows.map((r) => [r.id, r.name]));
  for (const { id, name } of rows) {
    await db
      .update(moneyMove)
      .set({ fromCategoryName: name })
      .where(eq(moneyMove.fromCategoryId, id));
    await db.update(moneyMove).set({ toCategoryName: name }).where(eq(moneyMove.toCategoryId, id));
  }
  const assignments = await db
    .select()
    .from(categoryAssignment)
    .where(
      and(
        inArray(categoryAssignment.categoryId, [...categoryIds]),
        ne(categoryAssignment.amount, 0n),
      ),
    )
    .orderBy(asc(categoryAssignment.month));
  for (const a of assignments) {
    const name = names.get(a.categoryId) ?? null;
    const out = a.amount > 0n;
    await db.insert(moneyMove).values({
      id: newId(),
      budgetId,
      userId,
      fromCategoryId: out ? a.categoryId : destinationId,
      toCategoryId: out ? destinationId : a.categoryId,
      fromCategoryName: out ? name : null,
      toCategoryName: out ? null : name,
      deletion: true,
      month: a.month,
      amount: out ? a.amount : -a.amount,
      currency: a.currency,
    });
  }
}

export async function categoryUsage(db: Db, budgetId: string, categoryIds?: readonly string[]) {
  const only = <T extends AnyColumn>(column: T) =>
    categoryIds ? inArray(column, [...categoryIds]) : undefined;
  const rows = await db
    .select({ id: transaction.categoryId, n: count() })
    .from(transaction)
    .where(and(eq(transaction.budgetId, budgetId), only(transaction.categoryId)))
    .groupBy(transaction.categoryId);
  const lines = await db
    .select({ id: subTransaction.categoryId, n: count() })
    .from(subTransaction)
    .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
    .where(and(eq(transaction.budgetId, budgetId), only(subTransaction.categoryId)))
    .groupBy(subTransaction.categoryId);
  const funded = await db
    .selectDistinct({ id: categoryAssignment.categoryId })
    .from(categoryAssignment)
    .where(
      and(
        eq(categoryAssignment.budgetId, budgetId),
        ne(categoryAssignment.amount, 0n),
        only(categoryAssignment.categoryId),
      ),
    );
  const usage = new Map<string, CategoryUsage>();
  const entry = (id: string) => {
    const found = usage.get(id) ?? { transactionCount: 0, hasAssignedMoney: false };
    usage.set(id, found);
    return found;
  };
  for (const r of [...rows, ...lines]) if (r.id) entry(r.id).transactionCount += r.n;
  for (const f of funded) entry(f.id).hasAssignedMoney = true;
  return usage;
}
