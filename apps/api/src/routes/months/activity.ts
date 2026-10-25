import type { RouteHandler } from "@hono/zod-openapi";
import { sql } from "@strictbudget/db";
import {
  budgetAccount,
  category,
  categoryGroup,
  payee,
  subTransaction,
  transaction,
} from "@strictbudget/db/schema";
import { monthBounds } from "@strictbudget/engine";
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import { type Db, internalCategoryId, internalPayeeId } from "../../lib/ledger";
import { enterDueScheduled, entryDate, userToday } from "../../lib/scheduled";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type { listMonthActivity } from "./routes";

type Env = AppEnv & AuthedEnv;

/**
 * The categories whose activity is asked for: one category, a group's categories that aren't
 * hidden (the ones its totals add up), or Uncategorized.
 */
async function categoryIds(
  db: Db,
  budgetId: string,
  query: { categoryId?: string; groupId?: string; uncategorized?: boolean },
): Promise<{ ids: string[]; cardAccountId?: string; cardCategoryId?: string }> {
  const asked = [query.categoryId, query.groupId, query.uncategorized || undefined].filter(
    (v) => v !== undefined,
  );
  if (asked.length !== 1) {
    throw new AppError(400, "BAD_REQUEST", "Pass one of categoryId, groupId or uncategorized");
  }
  if (query.uncategorized)
    return { ids: [await internalCategoryId(db, budgetId, "uncategorized")] };
  if (query.categoryId) {
    const [row] = await db
      .select({
        id: category.id,
        internalKind: category.internalKind,
        linkedAccountId: category.linkedAccountId,
      })
      .from(category)
      .where(and(eq(category.id, query.categoryId), eq(category.budgetId, budgetId)));
    if (!row || row.internalKind) throw new AppError(404, "NOT_FOUND", "Category not found");
    return {
      ids: [row.id],
      cardAccountId: row.linkedAccountId ?? undefined,
      cardCategoryId: row.linkedAccountId ? row.id : undefined,
    };
  }
  const groupId = query.groupId ?? "";
  const [group] = await db
    .select({ id: categoryGroup.id, internal: categoryGroup.internal })
    .from(categoryGroup)
    .where(and(eq(categoryGroup.id, groupId), eq(categoryGroup.budgetId, budgetId)));
  if (!group || group.internal) throw new AppError(404, "NOT_FOUND", "Category group not found");
  const rows = await db
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.groupId, groupId), eq(category.hidden, false)));
  return { ids: rows.map((r) => r.id) };
}

/**
 * The transactions behind a month's Activity: those dated in the month up to the user's today,
 * with a split's lines listed one by one. For a credit card's payment category it's the card's
 * register for the month: spending, returns and payments.
 */
export const listMonthActivityHandler: RouteHandler<typeof listMonthActivity, Env> = async (c) => {
  const { budgetId, month } = c.req.valid("param");
  const { today: rawToday, ...query } = c.req.valid("query");
  const today = userToday(c.var.deps, rawToday);
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  if (rawToday) await enterDueScheduled(db, c.var.deps, budgetId, entryDate(c.var.deps, rawToday));

  const { ids, cardAccountId, cardCategoryId } = await categoryIds(db, budgetId, query);
  const startingBalance = await internalPayeeId(db, budgetId, "starting_balance");
  const { start, end } = monthBounds(month);
  const cutoff = end < today ? end : today;
  // Nothing matches an empty list, but the queries still run so their row types stay inferred.
  const inIds = ids.length ? ids : [""];
  const dated = and(
    eq(transaction.budgetId, budgetId),
    gte(transaction.date, start),
    lte(transaction.date, cutoff),
  );

  const whole = await db
    .select({
      id: transaction.id,
      transactionId: transaction.id,
      accountId: transaction.accountId,
      accountName: budgetAccount.name,
      date: transaction.date,
      payeeName: payee.name,
      categoryId: transaction.categoryId,
      memo: transaction.memo,
      amount: transaction.baseAmount,
      nativeAmount: transaction.amount,
      currency: transaction.currency,
      createdAt: transaction.createdAt,
    })
    .from(transaction)
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .leftJoin(payee, eq(payee.id, transaction.payeeId))
    .where(
      cardAccountId
        ? // A payment category: the card's register for the month, without its Starting Balance.
          and(
            dated,
            eq(transaction.accountId, cardAccountId),
            or(isNull(transaction.payeeId), ne(transaction.payeeId, startingBalance)),
          )
        : and(dated, isNotNull(transaction.categoryId), inArray(transaction.categoryId, inIds)),
    );
  // A card's splits are listed line by line.
  const cardSplits = cardAccountId
    ? new Set(
        (
          await db
            .selectDistinct({ id: subTransaction.transactionId })
            .from(subTransaction)
            .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
            .where(and(dated, eq(transaction.accountId, cardAccountId)))
        ).map((r) => r.id),
      )
    : new Set<string>();

  // A split line shows its own payee, or the split's when it has none.
  const splitPayee = alias(payee, "split_payee");
  const lines = await db
    .select({
      id: subTransaction.id,
      transactionId: transaction.id,
      accountId: transaction.accountId,
      accountName: budgetAccount.name,
      date: transaction.date,
      payeeName: sql<string | null>`coalesce(${payee.name}, ${splitPayee.name})`,
      categoryId: subTransaction.categoryId,
      memo: subTransaction.memo,
      amount: subTransaction.baseAmount,
      nativeAmount: subTransaction.amount,
      currency: subTransaction.currency,
      createdAt: transaction.createdAt,
    })
    .from(subTransaction)
    .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
    .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
    .leftJoin(payee, eq(payee.id, subTransaction.payeeId))
    .leftJoin(splitPayee, eq(splitPayee.id, transaction.payeeId))
    .where(
      cardAccountId
        ? and(dated, eq(transaction.accountId, cardAccountId))
        : and(
            dated,
            isNotNull(subTransaction.categoryId),
            inArray(subTransaction.categoryId, inIds),
          ),
    );

  const rows = [...whole.filter((r) => !cardSplits.has(r.id)), ...lines].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const labels = await categoryLabels(db, budgetId);
  return c.json(
    {
      transactions: rows.map((r) => ({
        id: r.id,
        transactionId: r.transactionId,
        accountId: r.accountId,
        accountName: r.accountName,
        date: r.date,
        payeeName: r.payeeName,
        categoryId: r.categoryId,
        // A card's payments and other transfers show its payment category.
        categoryName: labels.get(r.categoryId ?? cardCategoryId ?? "") ?? null,
        memo: r.memo,
        amount: r.amount.toString(),
        nativeAmount: r.nativeAmount.toString(),
        currency: r.currency,
      })),
    },
    200,
  );
};

/** "Group: Category" for each category; internal ones by their own name. */
async function categoryLabels(db: Db, budgetId: string) {
  const rows = await db
    .select({
      id: category.id,
      name: category.name,
      internalKind: category.internalKind,
      groupName: categoryGroup.name,
    })
    .from(category)
    .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
    .where(eq(category.budgetId, budgetId));
  return new Map(
    rows.map((r) => [r.id, r.internalKind ? r.name : `${r.groupName}: ${r.name}`] as const),
  );
}
