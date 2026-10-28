import { sql } from "@strictbudget/db";
import { category, payee, subTransaction, transaction } from "@strictbudget/db/schema";
import {
  nextPayeeAutoCategory,
  type PayeeCategorization,
  payeeAutoCategory,
  payeePrefillCategory,
  payeeRecentCategories,
} from "@strictbudget/engine";
import { and, asc, eq, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { Db } from "./ledger";

export interface PayeeCategories {
  /** Manage Payees' "Current default category" (two of the last three, see `payeeAutoCategory`). */
  autoCategoryId: string | null;
  /** What a new transaction for the payee starts with, by its Categorization setting. */
  prefillCategoryId: string | null;
  /** Categories used with the payee, most recent first, each once (split lines included). */
  recentCategoryIds: string[];
}

export interface PayeeCategorySettings {
  id: string;
  categorization: PayeeCategorization;
  defaultCategoryId: string | null;
  carriedCategoryId: string | null;
  /** The stored default (see the `payee` columns); replayed from the history until saved. */
  autoCategoryId?: string | null;
  autoCategorySaved?: boolean;
}

interface Use {
  payeeId: string;
  categoryId: string;
  date: string;
  createdAt: Date;
  /** -1 for a whole transaction, else the split line's order. */
  line: number;
}

/**
 * Each payee's categories, from its transactions by date. Uncategorized doesn't count. The default
 * only reads whole transactions (split lines are skipped); the recent categories ("Suggested" in
 * the category list) read split lines too.
 */
export async function payeeCategories(
  db: Db,
  budgetId: string,
  payees: readonly PayeeCategorySettings[],
): Promise<Map<string, PayeeCategories>> {
  const result = new Map<string, PayeeCategories>();
  const ids = payees.map((p) => p.id);
  if (ids.length === 0) return result;
  const counts = sql`${category.internalKind} is distinct from 'uncategorized'`;
  const [whole, lines] = await Promise.all([
    db
      .select({
        payeeId: sql<string>`${transaction.payeeId}`,
        categoryId: sql<string>`${transaction.categoryId}`,
        date: transaction.date,
        createdAt: transaction.createdAt,
        id: transaction.id,
      })
      .from(transaction)
      .innerJoin(category, eq(category.id, transaction.categoryId))
      .where(and(eq(transaction.budgetId, budgetId), inArray(transaction.payeeId, ids), counts)),
    db
      .select({
        payeeId: sql<string>`coalesce(${subTransaction.payeeId}, ${transaction.payeeId})`,
        categoryId: sql<string>`${subTransaction.categoryId}`,
        date: transaction.date,
        createdAt: transaction.createdAt,
        id: transaction.id,
        sortOrder: subTransaction.sortOrder,
      })
      .from(subTransaction)
      .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
      .innerJoin(category, eq(category.id, subTransaction.categoryId))
      .where(
        and(
          eq(transaction.budgetId, budgetId),
          or(
            inArray(subTransaction.payeeId, ids),
            and(isNull(subTransaction.payeeId), inArray(transaction.payeeId, ids)),
          ),
          counts,
        ),
      ),
  ]);
  const uses: (Use & { id: string })[] = [
    ...whole.map((r) => ({ ...r, line: -1 })),
    ...lines.map(({ sortOrder, ...r }) => ({ ...r, line: sortOrder })),
  ];
  uses.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id) ||
      a.line - b.line,
  );
  const byPayee = new Map<string, Use[]>();
  for (const use of uses) {
    const list = byPayee.get(use.payeeId);
    if (list) list.push(use);
    else byPayee.set(use.payeeId, [use]);
  }

  for (const p of payees) {
    const own = byPayee.get(p.id) ?? [];
    const autoCategoryId = p.autoCategorySaved
      ? (p.autoCategoryId ?? null)
      : payeeAutoCategory(
          own.filter((u) => u.line < 0).map((u) => u.categoryId),
          p.carriedCategoryId,
        );
    result.set(p.id, {
      autoCategoryId,
      prefillCategoryId: payeePrefillCategory({
        categorization: p.categorization,
        defaultCategoryId: p.defaultCategoryId,
        autoCategoryId,
      }),
      recentCategoryIds: payeeRecentCategories(own.map((u) => u.categoryId).reverse()),
    });
  }
  return result;
}

/**
 * Updates the stored auto-categorization default of these transactions' payees after an add or
 * edit (see `nextPayeeAutoCategory`). Call it once the transactions are written. Deletes don't
 * call it: the default stays.
 */
export async function notePayeeCategorizations(
  db: Db,
  budgetId: string,
  transactionIds: readonly string[],
) {
  if (transactionIds.length === 0) return;
  const written = await db
    .select({
      payeeId: transaction.payeeId,
      categoryId: transaction.categoryId,
      internalKind: category.internalKind,
    })
    .from(transaction)
    .leftJoin(category, eq(category.id, transaction.categoryId))
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        inArray(transaction.id, [...transactionIds]),
        isNotNull(transaction.payeeId),
      ),
    );
  // Several rows of one payee (a bulk edit) apply in turn against the same last three.
  const byPayee = new Map<string, (string | null)[]>();
  for (const w of written) {
    if (!w.payeeId) continue;
    const counts = w.categoryId !== null && w.internalKind !== "uncategorized";
    byPayee.set(w.payeeId, [...(byPayee.get(w.payeeId) ?? []), counts ? w.categoryId : null]);
  }
  if (byPayee.size === 0) return;
  const rows = await db
    .select({
      id: payee.id,
      categorization: payee.categorization,
      defaultCategoryId: payee.defaultCategoryId,
      carriedCategoryId: payee.carriedCategoryId,
      autoCategoryId: payee.autoCategoryId,
      autoCategorySaved: payee.autoCategorySaved,
    })
    .from(payee)
    .where(and(eq(payee.budgetId, budgetId), inArray(payee.id, [...byPayee.keys()])));
  const legacy = rows.filter((p) => !p.autoCategorySaved);
  const replayed =
    legacy.length > 0
      ? await payeeCategories(db, budgetId, legacy)
      : new Map<string, PayeeCategories>();
  // Each payee's last three categorized transactions, in one query (an import touches hundreds).
  const ranked = db
    .select({
      payeeId: transaction.payeeId,
      categoryId: sql<string>`${transaction.categoryId}`.as("category_id"),
      rank: sql<number>`row_number() over (partition by ${transaction.payeeId} order by ${transaction.date} desc, ${transaction.createdAt} desc, ${transaction.id} desc)`.as(
        "rank",
      ),
    })
    .from(transaction)
    .innerJoin(category, eq(category.id, transaction.categoryId))
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        inArray(transaction.payeeId, [...byPayee.keys()]),
        sql`${category.internalKind} is distinct from 'uncategorized'`,
      ),
    )
    .as("ranked");
  const recent = await db
    .select({ payeeId: ranked.payeeId, categoryId: ranked.categoryId })
    .from(ranked)
    .where(lte(ranked.rank, 3))
    .orderBy(asc(ranked.payeeId), asc(ranked.rank));
  const lastThree = new Map<string, string[]>();
  for (const r of recent) {
    if (r.payeeId) lastThree.set(r.payeeId, [...(lastThree.get(r.payeeId) ?? []), r.categoryId]);
  }
  // Payees ending on the same default are saved together.
  const byDefault = new Map<string | null, string[]>();
  for (const p of rows) {
    let current = p.autoCategorySaved
      ? p.autoCategoryId
      : (replayed.get(p.id)?.autoCategoryId ?? null);
    for (const categoryId of byPayee.get(p.id) ?? []) {
      current = nextPayeeAutoCategory(current, lastThree.get(p.id) ?? [], categoryId);
    }
    byDefault.set(current, [...(byDefault.get(current) ?? []), p.id]);
  }
  for (const [autoCategoryId, ids] of byDefault) {
    await db
      .update(payee)
      .set({ autoCategoryId, autoCategorySaved: true })
      .where(inArray(payee.id, ids));
  }
}
