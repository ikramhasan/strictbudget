import { budget, budgetMember } from "@strictbudget/db/schema";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { type ImportCounts, importBackup } from "../backup/import";
import { createFilledBudget } from "../backup/new-budget";
import { deleteBudgetRow } from "../delete-budget";
import type { Conversion } from "./from-api";

export interface ExternalImportResult {
  budgetId: string;
  /** The budget an earlier import of the same source made, returned instead of a second copy. */
  reused: boolean;
  counts: ImportCounts | null;
  warnings: string[];
}

/**
 * Imports a converted plan as a new budget owned by the caller. The same source imported
 * again (`source`: "external:<plan id>", or a hash of the files) finds the budget the earlier import
 * made instead of making another; `replace` deletes that one and imports afresh.
 */
export async function importConverted(
  // biome-ignore lint/suspicious/noExplicitAny: any route's context
  c: Context<AppEnv & AuthedEnv, any, any>,
  conversion: Conversion,
  options: { source: string; name?: string; replace?: boolean },
): Promise<ExternalImportResult> {
  const { db } = c.var.deps;
  const [earlier] = await db
    .select({ id: budget.id })
    .from(budget)
    .innerJoin(
      budgetMember,
      and(
        eq(budgetMember.budgetId, budget.id),
        eq(budgetMember.userId, c.var.user.id),
        eq(budgetMember.role, "owner"),
      ),
    )
    .where(eq(budget.importSource, options.source))
    .limit(1);
  if (earlier && !options.replace) {
    return { budgetId: earlier.id, reused: true, counts: null, warnings: [] };
  }
  const { backup } = conversion;
  const { budgetId, result } = await createFilledBudget(
    c,
    { ...backup.budget, name: options.name ?? backup.budget.name },
    async (tx, id) => {
      const counts = await importBackup(tx, backup, id);
      await tx.update(budget).set({ importSource: options.source }).where(eq(budget.id, id));
      return counts;
    },
  );
  // The new one is in place; the earlier import goes.
  if (earlier) await deleteBudgetRow(db, earlier.id);
  return { budgetId, reused: false, counts: result, warnings: conversion.warnings };
}
