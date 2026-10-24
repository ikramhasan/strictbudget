import { newId, sql } from "@strictbudget/db";
import { categoryAssignment, moneyMove } from "@strictbudget/db/schema";
import type { AutoAssignOption, BudgetMonth, CurrencyCode } from "@strictbudget/engine";
import { and, eq } from "drizzle-orm";
import type { Db } from "./ledger";

interface Budget {
  id: string;
  currency: CurrencyCode;
}

/** A category's Assigned amount in a month (zero without a row). */
export async function assignedAmount(
  db: Db,
  categoryId: string,
  month: BudgetMonth,
  { lock = false }: { lock?: boolean } = {},
) {
  const query = db
    .select({ amount: categoryAssignment.amount })
    .from(categoryAssignment)
    .where(
      and(
        eq(categoryAssignment.categoryId, categoryId),
        eq(categoryAssignment.month, `${month}-01`),
      ),
    );
  const [row] = await (lock ? query.for("update") : query);
  return row?.amount ?? 0n;
}

export async function assignmentRow(db: Db, categoryId: string, month: BudgetMonth) {
  const [row] = await db
    .select({ id: categoryAssignment.id })
    .from(categoryAssignment)
    .where(
      and(
        eq(categoryAssignment.categoryId, categoryId),
        eq(categoryAssignment.month, `${month}-01`),
      ),
    );
  return row ?? null;
}

/**
 * Adds `delta` to a category's Assigned amount in a month. The row stays at zero too: a month
 * stays open once money was assigned in it.
 */
export async function adjustAssigned(
  db: Db,
  budget: Budget,
  categoryId: string,
  month: BudgetMonth,
  delta: bigint,
) {
  await db
    .insert(categoryAssignment)
    .values({
      id: newId(),
      budgetId: budget.id,
      categoryId,
      month: `${month}-01`,
      amount: delta,
      currency: budget.currency,
    })
    .onConflictDoUpdate({
      target: [categoryAssignment.categoryId, categoryAssignment.month],
      set: { amount: sql`${categoryAssignment.amount} + ${delta}`, updatedAt: sql`now()` },
    });
}

/**
 * Records a change of assigned money for "Recent Moves". `amount` must be positive. The moves of
 * one Auto-Assign share `autoAssign.batchId`, so they show as one "N categories" entry.
 */
export async function logMove(
  db: Db,
  budget: Budget,
  move: {
    userId: string;
    fromCategoryId: string;
    toCategoryId: string;
    month: BudgetMonth;
    amount: bigint;
    autoAssign?: { batchId: string; method: AutoAssignOption };
  },
) {
  await db.insert(moneyMove).values({
    id: newId(),
    budgetId: budget.id,
    userId: move.userId,
    fromCategoryId: move.fromCategoryId,
    toCategoryId: move.toCategoryId,
    month: `${move.month}-01`,
    amount: move.amount,
    currency: budget.currency,
    autoAssignBatchId: move.autoAssign?.batchId ?? null,
    autoAssignMethod: move.autoAssign?.method ?? null,
  });
}
