import { sql } from "@strictbudget/db";
import {
  budgetAccount,
  category,
  categoryGroup,
  type FlagColor,
  payee,
  subTransaction,
  transaction,
} from "@strictbudget/db/schema";
import { ACCOUNT_TYPES, type CurrencyCode, isOnBudget } from "@strictbudget/engine";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { type Db, internalCategoryId, internalPayeeId } from "./ledger";

/**
 * What a report sums:
 * - `spending`: lines on budget accounts with a category other than Inflow: Ready to Assign, split
 *   lines one by one, except saving lines. Transfers between budget accounts carry no category and
 *   drop out; a transfer to a tracking liability (a loan tracked off budget) counts under its
 *   category (Uncategorized when it has none). With `saving` it's the plan's category Activity.
 * - `saving`: the lines of `spending`'s kind that leave the plan as saving rather than being spent:
 *   a transfer to (or back from) a tracking asset account, whatever its category, and any line in
 *   a savings category whose goal is Keep saving. Spending a save-up goal or a safety fund on what
 *   it's for is spending.
 * - `activity`: `spending` and `saving` together: the plan's category Activity, for reports that
 *   show it (Budget vs Actual, Category History, spending pace).
 * - `income`: lines on budget accounts categorized to Ready to Assign, except starting balances.
 */
export const REPORT_KINDS = ["spending", "income", "saving", "activity"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_GROUPINGS = [
  "month",
  "day",
  "group",
  "category",
  "payee",
  "account",
  "flag",
] as const;
export type ReportGrouping = (typeof REPORT_GROUPINGS)[number];

/**
 * Which lines a report reads. `null` in `payeeIds` or `flags` matches lines with no payee or no
 * flag. Unset lists don't filter.
 */
export interface ReportFilter {
  kind: ReportKind;
  /** First and last day, inclusive (ISO dates). */
  start: string;
  end: string;
  accountIds?: readonly string[];
  groupIds?: readonly string[];
  categoryIds?: readonly string[];
  payeeIds?: readonly (string | null)[];
  flags?: readonly (FlagColor | null)[];
}

export interface ReportSum {
  keys: Partial<Record<ReportGrouping, string | null>>;
  /** Sum of the negative lines (≤ 0), in the budget's currency. */
  outflow: bigint;
  /** Sum of the positive lines (≥ 0). */
  inflow: bigint;
  net: bigint;
  /** Number of lines (a split's lines count one by one). */
  count: number;
}

const ON_BUDGET_TYPES = ACCOUNT_TYPES.filter((t) => isOnBudget(t));

interface LineSource {
  categoryId: SQLWrapper;
  payeeId: SQL;
  amount: SQLWrapper;
}

const wholeSource: LineSource = {
  categoryId: transaction.categoryId,
  payeeId: sql`${transaction.payeeId}`,
  amount: transaction.baseAmount,
};
// A split line's payee is its own, or the split's when it has none.
const lineSource: LineSource = {
  categoryId: subTransaction.categoryId,
  payeeId: sql`coalesce(${subTransaction.payeeId}, ${transaction.payeeId})`,
  amount: subTransaction.baseAmount,
};

/** Matches `column` against a list where null stands for "none". */
function matchNullable(column: SQLWrapper, values: readonly (string | null)[]) {
  const ids = values.filter((v): v is string => v !== null);
  const parts = [
    ids.length ? inArray(column as SQL, ids) : undefined,
    values.includes(null) ? isNull(column as SQL) : undefined,
  ].filter((p) => p !== undefined);
  return parts.length ? or(...parts) : sql`false`;
}

interface ReportIds {
  readyToAssign: string;
  startingBalance: string;
}

async function reportIds(db: Db, budgetId: string): Promise<ReportIds> {
  return {
    readyToAssign: await internalCategoryId(db, budgetId, "ready_to_assign"),
    startingBalance: await internalPayeeId(db, budgetId, "starting_balance"),
  };
}

/** A spending line that's saving (see `REPORT_KINDS`). */
function savingLine(source: LineSource) {
  return sql`(exists (
      select 1 from payee tp join budget_account ta on ta.id = tp.transfer_account_id
      where tp.id = ${source.payeeId} and ta.type = 'asset'
    ) or (${category.savings} and exists (
      select 1 from category_target ct
      where ct.category_id = ${source.categoryId} and ct.goal = 'keep_saving'
    )))`;
}

function whereFor(budgetId: string, ids: ReportIds, filter: ReportFilter, source: LineSource) {
  const spent = and(
    isNotNull(source.categoryId as SQL),
    ne(source.categoryId as SQL, ids.readyToAssign),
  );
  const kind =
    filter.kind === "spending"
      ? and(spent, sql`not ${savingLine(source)}`)
      : filter.kind === "saving"
        ? and(spent, savingLine(source))
        : filter.kind === "activity"
          ? spent
          : and(
              eq(source.categoryId as SQL, ids.readyToAssign),
              or(isNull(source.payeeId), ne(source.payeeId, ids.startingBalance)),
            );
  return and(
    eq(transaction.budgetId, budgetId),
    gte(transaction.date, filter.start),
    lte(transaction.date, filter.end),
    inArray(budgetAccount.type, ON_BUDGET_TYPES),
    kind,
    filter.accountIds && inArray(transaction.accountId, [...filter.accountIds, ""]),
    filter.groupIds && inArray(category.groupId, [...filter.groupIds, ""]),
    filter.categoryIds && inArray(source.categoryId as SQL, [...filter.categoryIds, ""]),
    filter.payeeIds && matchNullable(source.payeeId, filter.payeeIds),
    filter.flags && matchNullable(transaction.flag, filter.flags),
  );
}

function groupExpression(grouping: ReportGrouping, source: LineSource): SQL<string | null> {
  switch (grouping) {
    case "month":
      return sql<string>`to_char(${transaction.date}, 'YYYY-MM')`;
    case "day":
      return sql<string>`to_char(${transaction.date}, 'YYYY-MM-DD')`;
    case "group":
      return sql<string | null>`${category.groupId}`;
    case "category":
      return sql<string | null>`${source.categoryId}`;
    case "payee":
      return sql<string | null>`${source.payeeId}`;
    case "account":
      return sql<string>`${transaction.accountId}`;
    case "flag":
      return sql<string | null>`${transaction.flag}`;
  }
}

async function sumSource(
  db: Db,
  budgetId: string,
  ids: ReportIds,
  filter: ReportFilter,
  groupBy: readonly ReportGrouping[],
  split: boolean,
) {
  const source = split ? lineSource : wholeSource;
  const keys = Object.fromEntries(groupBy.map((g) => [g, groupExpression(g, source)]));
  const amount = source.amount;
  const select = {
    ...keys,
    outflow: sql<string>`coalesce(sum(${amount}) filter (where ${amount} < 0), 0)`,
    inflow: sql<string>`coalesce(sum(${amount}) filter (where ${amount} > 0), 0)`,
    net: sql<string>`coalesce(sum(${amount}), 0)`,
    count: sql<number>`count(*)::int`,
  };
  const where = whereFor(budgetId, ids, filter, source);
  const grouped = Object.values(keys);
  const query = split
    ? db
        .select(select)
        .from(subTransaction)
        .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
        .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
        .leftJoin(category, eq(category.id, subTransaction.categoryId))
        .where(where)
        .$dynamic()
    : db
        .select(select)
        .from(transaction)
        .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
        .leftJoin(category, eq(category.id, transaction.categoryId))
        .where(where)
        .$dynamic();
  return grouped.length ? query.groupBy(...grouped) : query;
}

/**
 * The report's lines summed per combination of `groupBy` keys (one row with no keys when
 * `groupBy` is empty and anything matched).
 */
export async function reportSums(
  db: Db,
  budgetId: string,
  filter: ReportFilter,
  groupBy: readonly ReportGrouping[],
): Promise<ReportSum[]> {
  const ids = await reportIds(db, budgetId);
  const [whole, lines] = await Promise.all([
    sumSource(db, budgetId, ids, filter, groupBy, false),
    sumSource(db, budgetId, ids, filter, groupBy, true),
  ]);
  const sums = new Map<string, ReportSum>();
  for (const row of [...whole, ...lines] as Record<string, unknown>[]) {
    const keys = Object.fromEntries(groupBy.map((g) => [g, row[g] as string | null]));
    const id = JSON.stringify(groupBy.map((g) => keys[g]));
    const sum = sums.get(id) ?? { keys, outflow: 0n, inflow: 0n, net: 0n, count: 0 };
    sum.outflow += BigInt(row.outflow as string);
    sum.inflow += BigInt(row.inflow as string);
    sum.net += BigInt(row.net as string);
    sum.count += row.count as number;
    sums.set(id, sum);
  }
  return [...sums.values()].filter((s) => s.count > 0);
}

export interface ReportLine {
  /** The transaction's id, or the split line's. */
  id: string;
  transactionId: string;
  accountId: string;
  accountName: string;
  date: string;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  groupName: string | null;
  categoryName: string | null;
  memo: string;
  flag: FlagColor | null;
  cleared: "uncleared" | "cleared" | "reconciled";
  /** In the budget's currency. */
  amount: bigint;
  /** In the account's currency. */
  nativeAmount: bigint;
  currency: CurrencyCode;
  createdAt: Date;
}

export const REPORT_LINE_ORDERS = ["newest", "largest_outflow"] as const;
export type ReportLineOrder = (typeof REPORT_LINE_ORDERS)[number];

/**
 * The lines behind a report's sums (its drill-down and its transactions export): newest first as
 * the register lists them, or largest outflow first; at most `limit` of them (each query is
 * ordered and cut in SQL, so a drill-down doesn't read the whole history).
 */
export async function reportLines(
  db: Db,
  budgetId: string,
  filter: ReportFilter,
  order: ReportLineOrder = "newest",
  limit?: number,
): Promise<ReportLine[]> {
  const ids = await reportIds(db, budgetId);
  const splitPayee = alias(payee, "split_payee");
  const orderBy = (amount: AnyPgColumn, id: AnyPgColumn) => [
    ...(order === "largest_outflow" ? [asc(amount)] : []),
    desc(transaction.date),
    desc(transaction.createdAt),
    asc(id),
  ];
  const common = {
    transactionId: transaction.id,
    accountId: transaction.accountId,
    accountName: budgetAccount.name,
    date: transaction.date,
    groupName: categoryGroup.name,
    categoryName: category.name,
    flag: transaction.flag,
    cleared: transaction.cleared,
    createdAt: transaction.createdAt,
  };
  const [whole, lines] = await Promise.all([
    db
      .select({
        ...common,
        id: transaction.id,
        payeeId: transaction.payeeId,
        payeeName: payee.name,
        categoryId: transaction.categoryId,
        memo: transaction.memo,
        amount: transaction.baseAmount,
        nativeAmount: transaction.amount,
        currency: transaction.currency,
      })
      .from(transaction)
      .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
      .leftJoin(category, eq(category.id, transaction.categoryId))
      .leftJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
      .leftJoin(payee, eq(payee.id, transaction.payeeId))
      .where(whereFor(budgetId, ids, filter, wholeSource))
      .orderBy(...orderBy(transaction.baseAmount, transaction.id))
      .limit(limit ?? MAX_LINES),
    db
      .select({
        ...common,
        id: subTransaction.id,
        payeeId: sql<string | null>`coalesce(${subTransaction.payeeId}, ${transaction.payeeId})`,
        payeeName: sql<string | null>`coalesce(${payee.name}, ${splitPayee.name})`,
        categoryId: subTransaction.categoryId,
        memo: subTransaction.memo,
        amount: subTransaction.baseAmount,
        nativeAmount: subTransaction.amount,
        currency: subTransaction.currency,
      })
      .from(subTransaction)
      .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
      .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
      .leftJoin(category, eq(category.id, subTransaction.categoryId))
      .leftJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
      .leftJoin(payee, eq(payee.id, subTransaction.payeeId))
      .leftJoin(splitPayee, eq(splitPayee.id, transaction.payeeId))
      .where(whereFor(budgetId, ids, filter, lineSource))
      .orderBy(...orderBy(subTransaction.baseAmount, subTransaction.id))
      .limit(limit ?? MAX_LINES),
  ]);
  const newest = (a: ReportLine, b: ReportLine) =>
    b.date.localeCompare(a.date) ||
    b.createdAt.getTime() - a.createdAt.getTime() ||
    a.id.localeCompare(b.id);
  return [...whole, ...lines]
    .sort((a, b) =>
      order === "largest_outflow"
        ? (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0) || newest(a, b)
        : newest(a, b),
    )
    .slice(0, limit);
}

/** A ceiling on lines read when no `limit` is given (an export of everything). */
const MAX_LINES = 1_000_000;
