import { sql } from "@strictbudget/db";
import {
  budgetAccount,
  type ClearedState,
  category,
  type FlagColor,
  flagName,
  payee,
  subTransaction,
  transaction,
} from "@strictbudget/db/schema";
import {
  ACCOUNT_TYPES,
  type CurrencyCode,
  isOnBudget,
  normalizeRate,
  parseSearch,
  type SearchSettings,
  type SearchTerm,
} from "@strictbudget/engine";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { AppError } from "../../lib/errors";
import { type Db, serverToday } from "../../lib/ledger";
import { memberRefs } from "../../lib/member-colors";
import { attachmentJson, attachmentsFor } from "./attachments";

export type { SearchSettings };

const ON_BUDGET_TYPES = ACCOUNT_TYPES.filter(isOnBudget);

/** What a register can sort by (Outflow and Inflow apart). */
export const SORT_COLUMNS = [
  "date",
  "account",
  "payee",
  "category",
  "memo",
  "outflow",
  "inflow",
  "flag",
  "cleared",
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDir = "asc" | "desc";
export interface SortField {
  column: SortColumn;
  dir: SortDir;
}

/** `payee:desc,date:asc`: a stacked sort, first field first. */
export const SORT_PATTERN = new RegExp(
  `^(${SORT_COLUMNS.join("|")}):(asc|desc)(,(${SORT_COLUMNS.join("|")}):(asc|desc))*$`,
);

/** The fields of a `SORT_PATTERN` string, a column's first mention winning. */
export function parseSort(text: string): SortField[] {
  const fields: SortField[] = [];
  for (const part of text.split(",")) {
    const [column, dir] = part.split(":") as [SortColumn, SortDir];
    if (!fields.some((f) => f.column === column)) fields.push({ column, dir });
  }
  return fields;
}

function formatSort(fields: readonly SortField[]) {
  return fields.map((f) => `${f.column}:${f.dir}`).join(",");
}

export interface RegisterFilter {
  accountId?: string;
  /** The search syntax (see `parseSearch`); split lines are matched one by one. */
  q?: string;
  from?: string;
  to?: string;
  /** The View menu's "Show Reconciled Transactions" turned off. */
  hideReconciled?: boolean;
  /** The user's today: a year-less `Income:` means its year, and partial dates complete from it. */
  today?: string;
}

export interface RegisterPage {
  sort: readonly SortField[];
  limit: number;
  cursor?: string;
}

/**
 * Every transaction of the budget (or of one account), with the columns the register filters,
 * sorts and shows. Simple enough for Postgres to flatten into each query, so a query only builds
 * the columns it uses. Running balances come separately, for the rows shown (`runningBalances`).
 */
function registerCte(db: Db, budgetId: string, accountId?: string) {
  return db.$with("register").as(
    db
      .select({
        id: transaction.id,
        accountId: transaction.accountId,
        accountName: sql<string>`${budgetAccount.name}`.as("account_name"),
        date: transaction.date,
        amount: transaction.amount,
        currency: transaction.currency,
        baseAmount: transaction.baseAmount,
        fxRate: transaction.fxRate,
        fxRateManual: transaction.fxRateManual,
        payeeId: transaction.payeeId,
        payeeName: sql<string | null>`${payee.name}`.as("payee_name"),
        categoryId: transaction.categoryId,
        categoryName: sql<string | null>`${category.name}`.as("category_name"),
        // The `Income:` search: Ready to Assign, plus every budget account's Starting Balance
        // (card debt's is left uncategorized, so it's matched by its payee).
        income: sql<boolean>`coalesce(${category.internalKind} = 'ready_to_assign', false) or (
          ${transaction.categoryId} is null and ${payee.internalKind} = 'starting_balance'
          and ${inArray(budgetAccount.type, ON_BUDGET_TYPES)}
        )`.as("income"),
        memo: transaction.memo,
        cleared: transaction.cleared,
        flag: transaction.flag,
        approved: transaction.approved,
        importId: transaction.importId,
        importedPayee: transaction.importedPayee,
        matchedImport: transaction.matchedImport,
        // "This needs a category": left Uncategorized (see `needsCategorySql`).
        needsCategory: sql<boolean>`coalesce(${category.internalKind} = 'uncategorized', false)`.as(
          "needs_category",
        ),
        transferAccountId: sql<string | null>`${payee.transferAccountId}`.as("transfer_account_id"),
        // A split line's transfer points at the split itself.
        transferTransactionId: sql<string | null>`coalesce(${transaction.transferTransactionId}, (
          select ${subTransaction.transactionId} from ${subTransaction}
          where ${subTransaction.id} = ${transaction.transferSubTransactionId}
        ))`.as("transfer_transaction_id"),
        transferFromSplit: sql<boolean>`${transaction.transferSubTransactionId} is not null`.as(
          "transfer_from_split",
        ),
        transferReconciled: sql<boolean>`exists (
          select 1 from ${transaction} other_side
          where other_side.id = ${transaction.transferTransactionId}
            and other_side.cleared = 'reconciled'
        )`.as("transfer_reconciled"),
        createdByUserId: transaction.createdByUserId,
        updatedByUserId: transaction.updatedByUserId,
        createdByAgentId: transaction.createdByAgentId,
        updatedByAgentId: transaction.updatedByAgentId,
        version: transaction.version,
        // Changed by a later request (one request's writes all share its now()).
        changed: sql<boolean>`${transaction.updatedAt} > ${transaction.createdAt}`.as("changed"),
        // As text, so the cursor keeps Postgres's microseconds.
        createdAt: sql<string>`${transaction.createdAt}::text`.as("created_at"),
      })
      .from(transaction)
      .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
      .leftJoin(payee, eq(payee.id, transaction.payeeId))
      .leftJoin(category, eq(category.id, transaction.categoryId))
      .where(
        and(
          eq(transaction.budgetId, budgetId),
          accountId ? eq(transaction.accountId, accountId) : undefined,
        ),
      ),
  );
}

type Register = ReturnType<typeof registerCte>;

/** `%` and `_` are literal in a search, not wildcards. */
function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * What a search term is checked against: the transaction itself, or one line of a split. A line
 * has its own payee (or the split's, when it has none), category, memo and amount; the rest is
 * the split's.
 */
interface Unit {
  /** Its payee's name `ilike` the pattern (null without a payee). */
  payeeLike: (pattern: string) => SQL;
  categoryLike: (pattern: string) => SQL;
  memoLike: (pattern: string) => SQL;
  amount: SQL;
  isSplit: SQL;
  /** In Ready to Assign (`Income:`). */
  income: SQL;
  /** Left Uncategorized (`Is: Needs Category`). */
  needsCategory: SQL;
}

function termWhere(r: Register, unit: Unit, term: SearchTerm, budgetId: string): SQL {
  switch (term.kind) {
    case "text": {
      const pattern = likePattern(term.text);
      return sql`(${unit.payeeLike(pattern)} or ${unit.categoryLike(pattern)}
        or ${unit.memoLike(pattern)} or ${accountLike(r, budgetId, pattern)}
        ${term.amount === null ? sql`` : sql`or abs(${unit.amount}) = ${term.amount}`})`;
    }
    case "payee":
      return sql`coalesce(${unit.payeeLike(likePattern(term.text))}, false)`;
    case "category":
      return sql`coalesce(${unit.categoryLike(likePattern(term.text))}, false)`;
    case "memo":
      return sql`coalesce(${unit.memoLike(likePattern(term.text))}, false)`;
    case "account":
      return accountLike(r, budgetId, likePattern(term.text));
    case "split":
      return unit.isSplit;
    case "flag": {
      const text = term.text.toLowerCase();
      if (text === "none") return sql`${r.flag} is null`;
      return sql`(${r.flag} = ${text} or ${r.flag} in (
        select ${flagName.color} from ${flagName}
        where ${flagName.budgetId} = ${budgetId} and lower(${flagName.name}) = ${text}
      ))`;
    }
    case "is":
      switch (term.state) {
        case "uncleared":
        case "cleared":
        case "reconciled":
          return sql`${r.cleared} = ${term.state}`;
        case "unreconciled":
          return sql`${r.cleared} <> 'reconciled'`;
        case "cleared_or_reconciled":
          return sql`${r.cleared} in ('cleared', 'reconciled')`;
        case "matched":
          return sql`${r.matchedImport} is not null`;
        case "approved":
          return sql`${r.approved}`;
        case "unapproved":
          return sql`not ${r.approved}`;
        case "needs_category":
          return unit.needsCategory;
        case "unapproved_or_needs_category":
          return sql`(not ${r.approved} or ${unit.needsCategory})`;
      }
      break;
    case "amount": {
      const signed = term.direction === "outflow" ? sql`-(${unit.amount})` : unit.amount;
      const op = sql.raw(term.op === "eq" ? "=" : term.op === "gte" ? ">=" : "<=");
      return sql`(${signed} > 0 and ${signed} ${op} ${term.amount})`;
    }
    case "date": {
      const op = sql.raw(term.op === "on" ? "=" : term.op === "before" ? "<=" : ">=");
      return sql`${r.date} ${op} ${term.date}`;
    }
    case "income": {
      // `searchTerms` has filled in a missing year.
      const year = term.year ?? Number(serverToday().slice(0, 4));
      const from = `${String(year).padStart(4, "0")}-${String(term.month).padStart(2, "0")}-01`;
      return sql`(${unit.income} and ${r.date} >= ${from}::date
        and ${r.date} < ${from}::date + interval '1 month')`;
    }
  }
  throw new Error("unreachable");
}

function allTerms(r: Register, unit: Unit, terms: readonly SearchTerm[], budgetId: string) {
  return sql.join(
    terms.map((t) => sql`(${termWhere(r, unit, t, budgetId)})`),
    sql` and `,
  );
}

/**
 * The account's name `ilike` the pattern. Names are matched once in their own table rather than on
 * every row (a search that matches nothing reads every row); the same for payees
 * and categories below.
 */
function accountLike(r: Register, budgetId: string, pattern: string) {
  return sql`${r.accountId} in (select ${budgetAccount.id} from ${budgetAccount}
    where ${budgetAccount.budgetId} = ${budgetId} and ${budgetAccount.name} ilike ${pattern})`;
}

/** The transaction as a search unit. */
function parentUnit(r: Register, budgetId: string): Unit {
  return {
    // Null (no match either way) without a payee or category, as the name's `ilike` would be.
    payeeLike: (p) => sql`case when ${r.payeeId} is null then null else ${r.payeeId} in (
      select ${payee.id} from ${payee} where ${payee.budgetId} = ${budgetId} and ${payee.name} ilike ${p}
    ) end`,
    categoryLike: (p) => sql`case when ${r.categoryId} is null then null else ${r.categoryId} in (
      select ${category.id} from ${category}
      where ${category.budgetId} = ${budgetId} and ${category.name} ilike ${p}
    ) end`,
    memoLike: (p) => sql`${r.memo} ilike ${p}`,
    amount: sql`${r.amount}`,
    isSplit: sql`exists (select 1 from ${subTransaction} where ${subTransaction.transactionId} = ${r.id})`,
    income: sql`${r.income}`,
    needsCategory: sql`${r.needsCategory}`,
  };
}

/** A split line (`st`, its payee `sp` and category `sc`) as a search unit. */
function lineUnit(r: Register): Unit {
  return {
    payeeLike: (p) => sql`coalesce(sp.name, ${r.payeeName}) ilike ${p}`,
    categoryLike: (p) => sql`sc.name ilike ${p}`,
    memoLike: (p) => sql`st.memo ilike ${p}`,
    amount: sql`st.amount`,
    isSplit: sql`false`,
    income: sql`coalesce(sc.internal_kind = 'ready_to_assign', false)`,
    // An approved split with an uncategorized line still needs a category, and its search shows
    // only that line.
    needsCategory: sql`coalesce(sc.internal_kind = 'uncategorized', false)`,
  };
}

/** `condition` over a split line of the register row, joined as `st`, `sp` and `sc`. */
function lineMatches(r: Register, budgetId: string, condition: SQL) {
  // Most transactions aren't splits: the budget's split ids, gathered once, rule them out before
  // their lines are looked at row by row.
  return sql`${r.id} in (
    select ${subTransaction.transactionId} from ${subTransaction}
    join ${transaction} on ${transaction.id} = ${subTransaction.transactionId}
    where ${transaction.budgetId} = ${budgetId}
  ) and exists (
    select 1 from ${subTransaction} st
    left join ${payee} sp on sp.id = st.payee_id
    left join ${category} sc on sc.id = st.category_id
    where st.transaction_id = ${r.id} and (${condition})
  )`;
}

/**
 * The search's terms. A month without a year is the user's current year, so
 * the register matches the scheduled section around New Year; partial dates are completed from
 * the user's today too.
 */
function searchTerms(filter: RegisterFilter, settings: SearchSettings): SearchTerm[] {
  if (!filter.q) return [];
  const today = filter.today ?? serverToday();
  const year = Number(today.slice(0, 4));
  return parseSearch(filter.q, settings, today).map((t) =>
    t.kind === "income" && t.year === null ? { ...t, year } : t,
  );
}

/**
 * How a register reads its search: the budget's formats, in the register's account's currency.
 * All accounts list `currencies`, every currency the budget's accounts use: each row's amounts
 * are then read in its own.
 */
export interface RegisterSearch extends SearchSettings {
  currencies?: readonly CurrencyCode[];
}

/** The search's terms, per currency when rows in several currencies are searched. */
type TermSet = { currency: CurrencyCode | null; terms: SearchTerm[] };

function termSets(filter: RegisterFilter, settings: RegisterSearch): TermSet[] {
  const currencies = settings.currencies ?? [];
  if (currencies.length < 2) {
    const currency = currencies[0] ?? settings.currency;
    const terms = searchTerms(filter, { ...settings, currency });
    return terms.length > 0 ? [{ currency: null, terms }] : [];
  }
  return currencies
    .map((currency) => ({ currency, terms: searchTerms(filter, { ...settings, currency }) }))
    .filter((set) => set.terms.length > 0);
}

/** Every term of a set matches `unit`, in a row of the set's currency. */
function setsWhere(r: Register, unit: Unit, sets: readonly TermSet[], budgetId: string) {
  return sql.join(
    sets.map((set) =>
      set.currency === null
        ? sql`(${allTerms(r, unit, set.terms, budgetId)})`
        : sql`(${r.currency} = ${set.currency} and ${allTerms(r, unit, set.terms, budgetId)})`,
    ),
    sql` or `,
  );
}

/**
 * A transaction shows when it, or one of its split lines, matches every search term (only the
 * lines that match are shown). Dates and reconciled rows are the View menu's.
 */
function filterWhere(
  r: Register,
  budgetId: string,
  filter: RegisterFilter,
  settings: RegisterSearch,
) {
  const conditions: (SQL | undefined)[] = [];
  const sets = termSets(filter, settings);
  if (sets.length > 0) {
    conditions.push(sql`(
      (${setsWhere(r, parentUnit(r, budgetId), sets, budgetId)})
      or ${lineMatches(r, budgetId, setsWhere(r, lineUnit(r), sets, budgetId))}
    )`);
  }
  if (filter.from) conditions.push(sql`${r.date} >= ${filter.from}`);
  if (filter.to) conditions.push(sql`${r.date} <= ${filter.to}`);
  if (filter.hideReconciled) conditions.push(sql`${r.cleared} <> 'reconciled'`);
  return and(...conditions);
}

/**
 * The ids (with amount, account and the bits bulk edits check) of every transaction `filter`
 * matches, for "select all". Same filter as the register, without paging.
 */
export function matchingTransactions(
  db: Db,
  budgetId: string,
  filter: RegisterFilter,
  settings: RegisterSearch,
) {
  const r = registerCte(db, budgetId, filter.accountId);
  return db
    .with(r)
    .select({ id: r.id })
    .from(r)
    .where(filterWhere(r, budgetId, filter, settings))
    .as("matching");
}

/** A sort column as SQL (never null), plus the type its cursor value is cast back to. */
function sortKey(r: Register, column: SortColumn): { key: SQL; cast: SQL } {
  const text = sql.raw("text");
  const int = sql.raw("int");
  const bigint = sql.raw("bigint");
  switch (column) {
    case "date":
      return { key: sql`${r.date}`, cast: sql.raw("date") };
    case "account":
      return { key: sql`lower(${r.accountName})`, cast: text };
    case "payee":
      return { key: sql`lower(coalesce(${r.payeeName}, ''))`, cast: text };
    case "category":
      return { key: sql`lower(coalesce(${r.categoryName}, ''))`, cast: text };
    case "memo":
      return { key: sql`lower(${r.memo})`, cast: text };
    // Each amount column on its own: the other side's rows count as zero.
    case "outflow":
      return { key: sql`greatest(-${r.amount}, 0)`, cast: bigint };
    case "inflow":
      return { key: sql`greatest(${r.amount}, 0)`, cast: bigint };
    // Ascending: no flag, then the flag menu's colors.
    case "flag":
      return {
        key: sql`(case ${r.flag} when 'red' then 1 when 'orange' then 2 when 'yellow' then 3
          when 'green' then 4 when 'blue' then 5 when 'purple' then 6 else 0 end)`,
        cast: int,
      };
    // Ascending: reconciled, cleared, uncleared.
    case "cleared":
      return {
        key: sql`(case ${r.cleared} when 'reconciled' then 0 when 'cleared' then 1 else 2 end)`,
        cast: int,
      };
  }
}

/**
 * `[sort, ...one key per sort field, date, tie, createdAt, id]`: the last row's place. `tie` is
 * the amount negated (a day's largest outflow first).
 */
type Cursor = string[];

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(text: string, sort: readonly SortField[]): Cursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(text, "base64url").toString());
    if (
      Array.isArray(value) &&
      value.length === sort.length + 5 &&
      value.every((v) => typeof v === "string") &&
      value[0] === formatSort(sort)
    ) {
      return value;
    }
  } catch {
    // Falls through to the error below.
  }
  throw new AppError(400, "INVALID_CURSOR", "The cursor doesn't belong to this register or sort");
}

/**
 * Rows after `cursor` in the order `keys` (each with its own direction), then the fixed tiebreak
 * `tail` (descending): the first key that differs decides.
 */
function afterCursor(
  keys: readonly { key: SQL; cast: SQL; dir: SortDir }[],
  tail: SQL,
  cursor: Cursor,
) {
  const values = cursor.slice(1);
  const [d, t, c, id] = values.slice(keys.length);
  const tailAfter = sql`${tail} < (${d}::date, ${t}::bigint, ${c}::timestamptz, ${id})`;
  const levels: SQL[] = [];
  const equal: SQL[] = [];
  keys.forEach(({ key, cast, dir }, i) => {
    const value = sql`${values[i]}::${cast}`;
    const op = sql.raw(dir === "asc" ? ">" : "<");
    levels.push(and(...equal, sql`${key} ${op} ${value}`) as SQL);
    equal.push(sql`${key} = ${value}`);
  });
  levels.push(and(...equal, tailAfter) as SQL);
  return sql`(${sql.join(levels, sql` or `)})`;
}

/** Lines of the given split transactions, grouped by transaction. */
async function queryLines(db: Db, transactionIds: readonly string[]) {
  const other = alias(transaction, "other_side");
  const rows = await db
    .select({
      id: subTransaction.id,
      transactionId: subTransaction.transactionId,
      amount: subTransaction.amount,
      baseAmount: subTransaction.baseAmount,
      payeeId: subTransaction.payeeId,
      payeeName: payee.name,
      categoryId: subTransaction.categoryId,
      categoryName: category.name,
      needsCategory: sql<boolean>`coalesce(${category.internalKind} = 'uncategorized', false)`,
      memo: subTransaction.memo,
      transferAccountId: payee.transferAccountId,
      transferTransactionId: other.id,
      transferReconciled: sql<boolean>`coalesce(${other.cleared} = 'reconciled', false)`,
      sideMemo: other.memo,
      sideCleared: other.cleared,
      sideFlag: other.flag,
      sideId: other.id,
      sideVersion: other.version,
      sideApproved: other.approved,
      sideCategoryId: other.categoryId,
      sideAmount: other.amount,
      sideCurrency: other.currency,
    })
    .from(subTransaction)
    .leftJoin(payee, eq(payee.id, subTransaction.payeeId))
    .leftJoin(category, eq(category.id, subTransaction.categoryId))
    .leftJoin(other, eq(other.transferSubTransactionId, subTransaction.id))
    // An empty page still runs the query (with no match) so the line type stays inferred.
    .where(
      inArray(subTransaction.transactionId, transactionIds.length ? [...transactionIds] : [""]),
    )
    .orderBy(asc(subTransaction.sortOrder), asc(subTransaction.id));
  type Line = Omit<
    (typeof rows)[number],
    | "transactionId"
    | "sideId"
    | "sideVersion"
    | "sideMemo"
    | "sideCleared"
    | "sideFlag"
    | "sideApproved"
    | "sideCategoryId"
    | "sideAmount"
    | "sideCurrency"
  > & { transferSide: TransferSide | null };
  const byTransaction = new Map<string, Line[]>();
  for (const row of rows) {
    const {
      transactionId,
      sideId,
      sideVersion,
      sideMemo,
      sideCleared,
      sideFlag,
      sideApproved,
      sideCategoryId,
      sideAmount,
      sideCurrency,
      ...l
    } = row;
    const line: Line = {
      ...l,
      transferSide:
        l.transferTransactionId &&
        sideId !== null &&
        sideVersion !== null &&
        sideCleared !== null &&
        sideCurrency !== null
          ? {
              id: sideId,
              version: sideVersion,
              memo: sideMemo ?? "",
              cleared: sideCleared,
              flag: sideFlag,
              approved: sideApproved ?? true,
              categoryId: sideCategoryId,
              amount: (sideAmount ?? 0n).toString(),
              currency: sideCurrency,
            }
          : null,
    };
    byTransaction.set(transactionId, [...(byTransaction.get(transactionId) ?? []), line]);
  }
  return byTransaction;
}

/** A transfer's other side's own state (what an undo needs to bring it back as it was). */
export interface TransferSide {
  id: string;
  version: number;
  memo: string;
  cleared: ClearedState;
  flag: FlagColor | null;
  approved: boolean;
  categoryId: string | null;
  /** Its own amount in its account's currency (its own between currencies). */
  amount: string;
  currency: CurrencyCode;
}

/** The other sides of these rows' transfers (not a split line's, which `queryLines` has). */
async function queryTransferSides(db: Db, rows: readonly Row[]) {
  const ids = rows.flatMap((r) =>
    r.transferTransactionId && !r.transferFromSplit ? [r.transferTransactionId] : [],
  );
  const sides = new Map<string, TransferSide>();
  if (ids.length === 0) return sides;
  const found = await db
    .select({
      id: transaction.id,
      version: transaction.version,
      memo: transaction.memo,
      cleared: transaction.cleared,
      flag: transaction.flag,
      approved: transaction.approved,
      categoryId: transaction.categoryId,
      amount: transaction.amount,
      currency: transaction.currency,
    })
    .from(transaction)
    .where(inArray(transaction.id, ids));
  for (const { amount, ...side } of found) {
    sides.set(side.id, { ...side, amount: amount.toString() });
  }
  return sides;
}

/** The register's columns, selected from the CTE. */
function columns(r: Register) {
  return {
    id: r.id,
    accountId: r.accountId,
    accountName: r.accountName,
    date: r.date,
    amount: r.amount,
    currency: r.currency,
    baseAmount: r.baseAmount,
    fxRate: r.fxRate,
    fxRateManual: r.fxRateManual,
    payeeId: r.payeeId,
    payeeName: r.payeeName,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    memo: r.memo,
    cleared: r.cleared,
    flag: r.flag,
    approved: r.approved,
    needsCategory: r.needsCategory,
    importId: r.importId,
    importedPayee: r.importedPayee,
    matchedImport: r.matchedImport,
    transferAccountId: r.transferAccountId,
    transferTransactionId: r.transferTransactionId,
    transferFromSplit: r.transferFromSplit,
    transferReconciled: r.transferReconciled,
    createdByUserId: r.createdByUserId,
    updatedByUserId: r.updatedByUserId,
    createdByAgentId: r.createdByAgentId,
    updatedByAgentId: r.updatedByAgentId,
    version: r.version,
    changed: r.changed,
    createdAt: r.createdAt,
  };
}

type Row = Awaited<ReturnType<typeof selectPage>>[number];

function selectPage(db: Db, r: Register) {
  return db.with(r).select(columns(r)).from(r);
}

/**
 * `matching`: under a search, the ids of the split lines that matched it, by transaction (only
 * those are shown). Null when there's no search.
 */
async function toJson(
  db: Db,
  budgetId: string,
  rows: readonly Row[],
  matching: ReadonlyMap<string, string[]> | null = null,
) {
  const lines = await queryLines(
    db,
    rows.map((row) => row.id),
  );
  const sides = await queryTransferSides(db, rows);
  const balances = await runningBalances(
    db,
    rows.map((row) => row.id),
  );
  const member = await memberRefs(
    db,
    budgetId,
    rows.flatMap((r) => [r.createdByUserId, r.updatedByUserId]),
    rows.flatMap((r) => [r.createdByAgentId, r.updatedByAgentId]),
  );
  // A transfer's sides share one; a split line's transfer is a transaction of its own.
  const attachments = await attachmentsFor(
    db,
    rows.map((r) => ({
      id: r.id,
      transferPairId: r.transferFromSplit ? null : r.transferTransactionId,
    })),
  );
  return rows.map(
    ({
      createdAt: _,
      createdByUserId,
      updatedByUserId,
      createdByAgentId,
      updatedByAgentId,
      changed,
      importId,
      matchedImport,
      ...row
    }) => ({
      ...row,
      imported: importId !== null,
      matched: matchedImport
        ? {
            date: matchedImport.date,
            amount: matchedImport.amount,
            payee: matchedImport.payee,
            memo: matchedImport.memo,
          }
        : null,
      attachment: ((a) => (a ? attachmentJson(a) : null))(attachments.get(row.id)),
      enteredBy: member(createdByUserId, createdByAgentId),
      // Only once someone changed it after entering it.
      changedBy: changed ? member(updatedByUserId, updatedByAgentId) : null,
      amount: row.amount.toString(),
      baseAmount: row.baseAmount.toString(),
      fxRate: row.fxRate === null ? null : normalizeRate(row.fxRate),
      transferSide:
        row.transferTransactionId && !row.transferFromSplit
          ? (sides.get(row.transferTransactionId) ?? null)
          : null,
      subtransactions: (lines.get(row.id) ?? []).map((l) => ({
        ...l,
        amount: l.amount.toString(),
        baseAmount: l.baseAmount.toString(),
      })),
      matchingLineIds: matching ? (matching.get(row.id) ?? []) : null,
      // Postgres returns numeric sums as strings; BigInt normalizes them exactly.
      runningBalance: BigInt(balanceOf(balances, row.id)).toString(),
    }),
  );
}

/**
 * The rows of one page in order (one more than the limit, to know if there's another page): only
 * their ids and cursor keys, so Postgres builds the shown columns for the page alone.
 */
export function registerPageQuery(
  db: Db,
  budgetId: string,
  filter: RegisterFilter,
  page: RegisterPage,
  settings: RegisterSearch,
) {
  const r = registerCte(db, budgetId, filter.accountId);
  const keys = page.sort.map((f) => ({ ...sortKey(r, f.column), dir: f.dir }));
  // After the sort's fields, ties break by date, then amount (newest first, a day's largest
  // outflow on top), then creation, then id, so the order is total and
  // keyset paging never skips or repeats a row.
  const tie = sql`(-${r.amount})`;
  const tail = sql`(${r.date}, ${tie}, ${r.createdAt}::timestamptz, ${r.id})`;
  const after = page.cursor
    ? afterCursor(keys, tail, decodeCursor(page.cursor, page.sort))
    : undefined;
  return db
    .with(r)
    .select({
      id: r.id,
      date: r.date,
      createdAt: r.createdAt,
      sortKeys: sql<string[]>`array[${sql.join(
        keys.map(({ key }) => sql`(${key})::text`),
        sql`, `,
      )}]::text[]`,
      tie: sql<string>`${tie}::text`,
    })
    .from(r)
    .where(and(filterWhere(r, budgetId, filter, settings), after))
    .orderBy(
      ...keys.map(({ key, dir }) => sql`${key} ${sql.raw(dir)}`),
      sql`${r.date} desc`,
      sql`${tie} desc`,
      sql`${r.createdAt}::timestamptz desc`,
      sql`${r.id} desc`,
    )
    .limit(page.limit + 1);
}

/** One page of a register, filtered and sorted, with the cursor for the next. */
export async function queryRegister(
  db: Db,
  budgetId: string,
  filter: RegisterFilter,
  page: RegisterPage,
  settings: RegisterSearch,
) {
  const keys = await registerPageQuery(db, budgetId, filter, page, settings);
  const more = keys.length > page.limit;
  const ids = keys.slice(0, page.limit).map((k) => k.id);
  const last = keys[ids.length - 1];
  const r = registerCte(db, budgetId, filter.accountId);
  const byId = new Map(
    (ids.length ? await selectPage(db, r).where(inArray(r.id, ids)) : []).map((row) => [
      row.id,
      row,
    ]),
  );
  const pageRows = ids.flatMap((id) => byId.get(id) ?? []);
  const sets = termSets(filter, settings);
  const matching =
    sets.length > 0
      ? await matchingLines(
          db,
          budgetId,
          filter.accountId,
          pageRows.map((row) => row.id),
          sets,
        )
      : null;
  return {
    transactions: await toJson(db, budgetId, pageRows, matching),
    // Asked once, with the first page.
    someHidden: page.cursor ? null : await someHidden(db, budgetId, filter, settings),
    nextCursor:
      more && last
        ? encodeCursor([
            formatSort(page.sort),
            ...last.sortKeys,
            last.date,
            last.tie,
            last.createdAt,
            last.id,
          ])
        : null,
  };
}

/** Of these transactions' split lines, the ones that match every term, by transaction. */
async function matchingLines(
  db: Db,
  budgetId: string,
  accountId: string | undefined,
  ids: readonly string[],
  sets: readonly TermSet[],
) {
  const byTransaction = new Map<string, string[]>();
  if (ids.length === 0) return byTransaction;
  const r = registerCte(db, budgetId, accountId);
  const rows = await db
    .with(r)
    .select({ id: sql<string>`st.id`, transactionId: r.id })
    .from(r)
    .innerJoin(sql`${subTransaction} st`, sql`st.transaction_id = ${r.id}`)
    .leftJoin(sql`${payee} sp`, sql`sp.id = st.payee_id`)
    .leftJoin(sql`${category} sc`, sql`sc.id = st.category_id`)
    .where(and(inArray(r.id, [...ids]), setsWhere(r, lineUnit(r), sets, budgetId)));
  for (const { id, transactionId } of rows) {
    byTransaction.set(transactionId, [...(byTransaction.get(transactionId) ?? []), id]);
  }
  return byTransaction;
}

/** Whether the search, date range or hidden reconciled rows leave any of the register out. */
async function someHidden(
  db: Db,
  budgetId: string,
  filter: RegisterFilter,
  settings: RegisterSearch,
) {
  const r = registerCte(db, budgetId, filter.accountId);
  const where = filterWhere(r, budgetId, filter, settings);
  if (!where) return false;
  const [row] = await db
    .with(r)
    .select({ hidden: sql<boolean>`true` })
    .from(r)
    .where(sql`not coalesce((${where}), false)`)
    .limit(1);
  return Boolean(row);
}

/**
 * Each transaction's running balance in its account: the account's total up to it in the
 * register's order (date, then inflows first and outflows from smallest to largest, then
 * creation). The sum before the earliest of the rows' dates comes from one index range, and the
 * window runs over the dates the rows span only, so a page of recent rows costs the same however
 * long the account's history is.
 */
async function runningBalances(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    with bounds as materialized (
      select account_id, min(date) as lo, max(date) as hi
      from ${transaction} where id in (${list}) group by account_id
    )
    select w.id, w.balance::text as balance
    from bounds b
    cross join lateral (
      select coalesce(sum(e.amount), 0) as before from ${transaction} e
      where e.account_id = b.account_id and e.date < b.lo
    ) o
    cross join lateral (
      select t.id, o.before + sum(t.amount) over (
        order by t.date, t.amount desc, t.created_at, t.id
      ) as balance
      from ${transaction} t
      where t.account_id = b.account_id and t.date between b.lo and b.hi
    ) w
    where w.id in (${list})
  `)) as unknown as { id: string; balance: string }[];
  return new Map(rows.map((r) => [r.id, r.balance]));
}

function balanceOf(balances: ReadonlyMap<string, string>, id: string) {
  const balance = balances.get(id);
  if (balance === undefined) throw new Error(`No running balance for transaction ${id}`);
  return balance;
}

/** Transactions as the register shows them (with each account's running balance). */
export async function queryRegisterRows(db: Db, budgetId: string, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const r = registerCte(db, budgetId);
  return toJson(db, budgetId, await selectPage(db, r).where(inArray(r.id, [...ids])));
}

/** One transaction as the register shows it (with its running balance). */
export async function queryRegisterRow(db: Db, budgetId: string, accountId: string, id: string) {
  const r = registerCte(db, budgetId, accountId);
  const rows = await selectPage(db, r).where(eq(r.id, id));
  const [row] = await toJson(db, budgetId, rows);
  return row;
}
