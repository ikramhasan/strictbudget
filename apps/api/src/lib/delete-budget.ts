import { budget, scheduledTransaction, transaction } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import type { Db } from "./ledger";

/**
 * Removes a budget's transactions and scheduled transactions, ahead of the budget itself.
 * Split lines refer to categories with no cascade, so a cascade from the budget
 * that reached a category before the split lines that use it failed the whole delete.
 */
export async function deleteBudgetTransactions(db: Db, budgetId: string) {
  await db.delete(transaction).where(eq(transaction.budgetId, budgetId));
  await db.delete(scheduledTransaction).where(eq(scheduledTransaction.budgetId, budgetId));
}

/** Deletes a budget and everything in it, directly (not through the organization plugin). */
export async function deleteBudgetRow(db: Db, budgetId: string) {
  await db.transaction(async (tx) => {
    await deleteBudgetTransactions(tx, budgetId);
    await tx.delete(budget).where(eq(budget.id, budgetId));
  });
}
