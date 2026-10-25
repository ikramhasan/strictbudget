import { sql } from "@strictbudget/db";
import { category, subTransaction, transaction } from "@strictbudget/db/schema";
import { and, count, eq, or, type SQL } from "drizzle-orm";
import type { Db } from "./ledger";

/**
 * A transaction that needs a category: one left Uncategorized. Transactions that take no category
 * (transfers within the budget, tracking accounts, splits, a card's Starting Balance) have none at
 * all, so they never need one.
 */
export function needsCategorySql(categoryId: SQL | typeof transaction.categoryId): SQL {
  return sql`exists (
    select 1 from ${category} review_category
    where review_category.id = ${categoryId} and review_category.internal_kind = 'uncategorized'
  )`;
}

/**
 * A split with a line left Uncategorized: it counts in the review banner and `Is: Needs Category`
 * even once approved, though the split's row has no icon.
 */
export function splitNeedsCategorySql(transactionId: SQL | typeof transaction.id): SQL {
  return sql`exists (
    select 1 from ${subTransaction} review_line
    join ${category} review_line_category on review_line_category.id = review_line.category_id
    where review_line.transaction_id = ${transactionId}
      and review_line_category.internal_kind = 'uncategorized'
  )`;
}

/**
 * How many transactions in each account are unapproved or need a category: the review banner's
 * count and the dot by the account in the sidebar.
 */
export async function transactionsToReview(db: Db, budgetId: string) {
  const rows = await db
    .select({ accountId: transaction.accountId, count: count() })
    .from(transaction)
    .where(
      and(
        eq(transaction.budgetId, budgetId),
        or(
          eq(transaction.approved, false),
          needsCategorySql(transaction.categoryId),
          splitNeedsCategorySql(transaction.id),
        ),
      ),
    )
    .groupBy(transaction.accountId);
  return new Map(rows.map((r) => [r.accountId, r.count]));
}

/**
 * Sets `approved` on these transactions and every transaction linked to them as a transfer:
 * plain transfers' other sides, and a split's transfer lines' counterparts (both ways). Approving
 * one side of a transfer approves the other; an undo takes them all back.
 */
export async function setApproval(db: Db, ids: readonly string[], approved: boolean) {
  if (ids.length === 0) return;
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  // The splits involved: the rows themselves, and the split of a counterpart among them.
  const splits = sql`(
    select ${transaction.id} from ${transaction} where ${transaction.id} in (${list})
    union
    select ${subTransaction.transactionId} from ${subTransaction}
    join ${transaction} on ${transaction.transferSubTransactionId} = ${subTransaction.id}
    where ${transaction.id} in (${list})
  )`;
  await db.execute(sql`
    update ${transaction} set approved = ${approved}
    where ${transaction.id} in (
      select id from ${splits} as linked(id)
      union
      select ${transaction.transferTransactionId} from ${transaction}
      where ${transaction.id} in (${list}) and ${transaction.transferTransactionId} is not null
      union
      select counterpart.id from ${transaction} counterpart
      join ${subTransaction} line on line.id = counterpart.transfer_sub_transaction_id
      where line.transaction_id in (select id from ${splits} as split(id))
    )
  `);
}
