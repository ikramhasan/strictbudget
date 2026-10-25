import { type Database, sql } from "@strictbudget/db";
import { type BudgetRole, budget, budgetMember, userPreference } from "@strictbudget/db/schema";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AuthedEnv } from "../middleware/require-auth";
import type { AppEnv } from "../types";
import { keyAllowsBudget } from "./api-keys";
import { type BudgetPermission, budgetRoles } from "./budget-access-control";
import { AppError } from "./errors";

export type BudgetRow = typeof budget.$inferSelect;

export interface BudgetAccess {
  budget: BudgetRow;
  role: BudgetRole;
  lastUsedAt: Date | null;
}

/**
 * Loads a budget the signed-in user belongs to. Every budget-scoped route authorizes through this.
 * Non-members get 404 (never 403) so budget ids can't be probed; members lacking `permission` get 403.
 * An API key limited to other budgets gets 404 too (`requireAuth` checks the path first).
 */
export async function loadBudgetAccess(
  // biome-ignore lint/suspicious/noExplicitAny: accepts any route's context (path/input generics)
  c: Context<AppEnv & AuthedEnv, any, any>,
  budgetId: string,
  permission?: BudgetPermission,
): Promise<BudgetAccess> {
  if (!keyAllowsBudget(c.var.apiKey, budgetId)) {
    throw new AppError(404, "NOT_FOUND", "Budget not found");
  }
  const [row] = await c.var.deps.db
    .select({ budget, role: budgetMember.role, lastUsedAt: budgetMember.lastUsedAt })
    .from(budget)
    .innerJoin(
      budgetMember,
      and(eq(budgetMember.budgetId, budget.id), eq(budgetMember.userId, c.var.user.id)),
    )
    .where(eq(budget.id, budgetId))
    .limit(1);
  if (!row) throw new AppError(404, "NOT_FOUND", "Budget not found");
  if (permission && !budgetRoles[row.role].authorize(permission).success) {
    throw new AppError(403, "FORBIDDEN", "You don't have permission to do that in this budget");
  }
  return row;
}

/** Remembers the budget the user last opened, across devices; returns the time it stored. */
export async function rememberLastBudget(
  db: Database,
  userId: string,
  budgetId: string,
): Promise<Date | null> {
  const [member] = await db
    .update(budgetMember)
    .set({ lastUsedAt: sql`now()` })
    .where(and(eq(budgetMember.budgetId, budgetId), eq(budgetMember.userId, userId)))
    .returning({ lastUsedAt: budgetMember.lastUsedAt });
  await db
    .insert(userPreference)
    .values({ userId, lastBudgetId: budgetId })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: { lastBudgetId: budgetId, updatedAt: sql`now()` },
    });
  return member?.lastUsedAt ?? null;
}
