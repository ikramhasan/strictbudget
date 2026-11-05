import type { components } from "@strictbudget/api-client";
import { type AccountType, accountFamily, isOnBudget } from "@strictbudget/engine";
import { isStarred } from "./accounts";
import { DEFAULT_SORT, type SortField } from "./register-sort";
import { type SubTransaction, type Transaction, transferLabel } from "./transactions";

type CreateBody = components["schemas"]["CreateTransaction"];
type UpdateBody = components["schemas"]["UpdateTransaction"];
type LineBody = components["schemas"]["SubTransactionInput"];
type AccountList = components["schemas"]["AccountList"];

/**
 * Saving in the register doesn't wait for the API: the row shows at once, marked pending, and the
 * refreshed rows take its place once the save is in (or it goes, with a toast, if the save fails).
 * These are the pure parts: the row a save will make, and the register's rows with every pending
 * save laid over them.
 */

/** What a pending row needs to name its ids the way a saved one would. */
export interface RowContext {
  account: (id: string) => { name: string; currency: string; type: AccountType } | undefined;
  categoryName: (id: string) => string | null;
  /** Whether a row in `accountId` (to `transferAccountId`) takes a category. */
  usesCategory: (accountId: string, transferAccountId: string | null) => boolean;
  budgetCurrency: string;
}

/** A new transaction waiting on its save. `savedId` is set once the API has it. */
export interface PendingCreate {
  row: Transaction;
  savedId?: string;
}

/** An edit waiting on its save, laid over the row it changes. */
export interface PendingEdit {
  key: number;
  id: string;
  body: UpdateBody;
  /** "row": saved from the editor (the row shows it's saving); "cell": one cell or toggle. */
  kind?: "row" | "cell";
}

/** How a pending row is marked: a new one, an edit from the editor, or a cell's. */
export type PendingKind = "new" | "row" | "cell";

let nextPending = 0;

/**
 * A local id for a row not saved yet. It sorts after any UUIDv7, so the register (which orders a
 * day's rows by id) puts it where a just-entered transaction goes: the top of its day.
 */
export function pendingId() {
  nextPending += 1;
  return `pending-${Date.now().toString(36)}-${nextPending.toString(36).padStart(4, "0")}`;
}

export const isPendingId = (id: string) => id.startsWith("pending-");

function lineRows(lines: readonly LineBody[], key: string, context: RowContext): SubTransaction[] {
  return lines.map((line, i) => ({
    id: line.id ?? `${key}:${i}`,
    amount: line.amount,
    baseAmount: line.amount,
    payeeId: null,
    payeeName: line.transferAccountId
      ? transferLabel(context.account(line.transferAccountId)?.name ?? "")
      : (line.payeeName ?? null),
    categoryId: line.categoryId ?? null,
    categoryName: line.categoryId ? context.categoryName(line.categoryId) : null,
    needsCategory: false,
    memo: line.memo ?? "",
    transferAccountId: line.transferAccountId ?? null,
    transferTransactionId: null,
    transferReconciled: false,
    transferSide: null,
  }));
}

function transferSide(
  id: string,
  amount: string,
  to: { currency: string; type: AccountType },
  own: string,
  given?: string | null,
): Transaction["transferSide"] {
  return {
    id: `${id}:transfer`,
    version: 0,
    memo: "",
    // Each side starts cleared in a cash account, as the API does.
    cleared: to.type === "cash" ? "cleared" : "uncleared",
    flag: null,
    approved: true,
    categoryId: null,
    amount: given ?? (to.currency === own ? (-BigInt(amount)).toString() : "0"),
    currency: to.currency as Transaction["currency"],
  };
}

/** The row a new transaction's save will make, as far as the register can tell before it's in. */
export function pendingTransaction(id: string, body: CreateBody, context: RowContext): Transaction {
  const account = context.account(body.accountId);
  const currency = account?.currency ?? context.budgetCurrency;
  const to = body.transferAccountId ? context.account(body.transferAccountId) : undefined;
  const lines = lineRows(body.subtransactions ?? [], id, context);
  const categoryId = lines.length > 0 ? null : (body.categoryId ?? null);
  const transferAccountId = body.transferAccountId ?? null;
  return {
    id,
    accountId: body.accountId,
    accountName: account?.name ?? "",
    date: body.date,
    amount: body.amount,
    currency: currency as Transaction["currency"],
    baseAmount: body.amount,
    fxRate: null,
    fxRateManual: false,
    payeeId: null,
    payeeName: to ? transferLabel(to.name) : (body.payeeName ?? null),
    categoryId,
    categoryName: categoryId ? context.categoryName(categoryId) : null,
    memo: body.memo ?? "",
    cleared: body.cleared ?? (account?.type === "cash" ? "cleared" : "uncleared"),
    flag: body.flag ?? null,
    approved: true,
    needsCategory:
      categoryId === null &&
      lines.length === 0 &&
      context.usesCategory(body.accountId, transferAccountId),
    imported: false,
    importedPayee: null,
    matched: null,
    transferAccountId,
    transferTransactionId: null,
    transferFromSplit: false,
    transferReconciled: false,
    transferSide: to ? transferSide(id, body.amount, to, currency, body.transferAmount) : null,
    attachment: null,
    subtransactions: lines,
    runningBalance: "0",
    matchingLineIds: null,
    enteredBy: null,
    changedBy: null,
    version: 0,
  };
}

/** `row` as an edit's save will leave it. */
export function patchedTransaction(
  row: Transaction,
  body: UpdateBody,
  context: RowContext,
  key = 0,
): Transaction {
  const next: Transaction = { ...row };
  if (body.accountId !== undefined) {
    const account = context.account(body.accountId);
    next.accountId = body.accountId;
    next.accountName = account?.name ?? next.accountName;
  }
  if (body.date !== undefined) next.date = body.date;
  if (body.amount !== undefined) {
    next.amount = body.amount;
    if (next.currency === context.budgetCurrency) next.baseAmount = body.amount;
  }
  if (body.payeeName !== undefined) {
    next.payeeName = body.payeeName;
    next.payeeId = null;
    next.transferAccountId = null;
    next.transferSide = null;
  }
  if (body.transferAccountId !== undefined) {
    const to = context.account(body.transferAccountId);
    next.transferAccountId = body.transferAccountId;
    next.payeeName = transferLabel(to?.name ?? "");
    next.payeeId = null;
    if (to && row.transferAccountId !== body.transferAccountId) {
      next.transferSide = transferSide(row.id, next.amount, to, next.currency);
    }
  }
  // A transfer in one currency moves the same money the other way.
  if (
    body.amount !== undefined &&
    next.transferSide &&
    next.transferSide.currency === next.currency
  ) {
    next.transferSide = { ...next.transferSide, amount: (-BigInt(body.amount)).toString() };
  }
  if (body.subtransactions !== undefined) {
    next.subtransactions = lineRows(body.subtransactions, `${row.id}:${key}`, context);
    next.categoryId = null;
    next.categoryName = null;
  } else if (body.categoryId !== undefined) {
    // A category un-splits a split.
    next.subtransactions = [];
    next.categoryId = body.categoryId;
    next.categoryName = body.categoryId ? context.categoryName(body.categoryId) : null;
  }
  if (body.memo !== undefined) next.memo = body.memo;
  if (body.cleared !== undefined) next.cleared = body.cleared;
  if (body.flag !== undefined) next.flag = body.flag;
  if (body.approved !== undefined) next.approved = body.approved;
  // Saving approves, except a flag change (see the API's `approved`).
  else if (Object.keys(body).some((k) => k !== "flag" && k !== "expectedVersion")) {
    next.approved = true;
  }
  next.needsCategory =
    next.categoryId === null &&
    next.subtransactions.length === 0 &&
    context.usesCategory(next.accountId, next.transferAccountId);
  return next;
}

/** Whether a row is "last" of its day for the API: its largest outflow, the last entered among equals. */
function apiLast<T extends Pick<Transaction, "id" | "amount">>(rows: readonly T[]) {
  return rows.reduce((a, b) => {
    const diff = BigInt(a.amount) - BigInt(b.amount);
    return diff > 0n || (diff === 0n && b.id > a.id) ? b : a;
  });
}

/**
 * An account's balance at the end of `date` (or of the latest earlier day it has rows on), from the
 * loaded rows; null when none of its rows that early are loaded.
 */
function balanceThrough(rows: readonly Transaction[], accountId: string, date: string) {
  let day: string | null = null;
  for (const r of rows) {
    if (r.accountId === accountId && r.date <= date && (day === null || r.date > day)) day = r.date;
  }
  if (day === null) return null;
  const onDay = rows.filter((r) => r.accountId === accountId && r.date === day);
  return BigInt(apiLast(onDay).runningBalance);
}

/** Adds `delta` to the running balance of every row of `accountId` dated `date` or later. */
function shiftBalances(rows: Transaction[], accountId: string, date: string, delta: bigint) {
  if (delta === 0n) return;
  for (const [i, r] of rows.entries()) {
    if (r.accountId === accountId && r.date >= date) {
      rows[i] = { ...r, runningBalance: (BigInt(r.runningBalance) + delta).toString() };
    }
  }
}

/** Where a new row goes: by its date when the register is sorted by date, otherwise on top. */
function insertAt(rows: readonly Transaction[], row: Transaction, sort: readonly SortField[]) {
  const [first] = sort.length > 0 ? sort : DEFAULT_SORT;
  if (first?.column !== "date") return 0;
  const index =
    first.dir === "desc"
      ? rows.findIndex((r) => r.date <= row.date)
      : rows.findIndex((r) => r.date > row.date);
  return index === -1 ? rows.length : index;
}

/**
 * The register's rows with the pending saves laid over them: edits applied to their rows (and the
 * running balances after them), new rows in place. `known` holds rows a save has returned that the
 * list may not have caught up with. A row moved to another account leaves an account's register,
 * as a new one in another account never joins it.
 */
export function withPending(
  rows: readonly Transaction[],
  {
    creates,
    edits,
    known,
  }: {
    creates: readonly PendingCreate[];
    edits: readonly PendingEdit[];
    known: ReadonlyMap<string, Transaction>;
  },
  context: RowContext,
  sort: readonly SortField[],
  accountId?: string,
): { rows: readonly Transaction[]; pending: ReadonlyMap<string, PendingKind> } {
  const pending = new Map<string, PendingKind>();
  if (creates.length === 0 && edits.length === 0 && known.size === 0) return { rows, pending };
  const out: Transaction[] = rows.map((r) => {
    const newer = known.get(r.id);
    return newer && newer.version > r.version ? newer : r;
  });
  for (const edit of edits) {
    const i = out.findIndex((r) => r.id === edit.id);
    const before = out[i];
    if (!before) continue;
    const after = patchedTransaction(before, edit.body, context, edit.key);
    out[i] = after;
    if (pending.get(after.id) !== "row") pending.set(after.id, edit.kind ?? "cell");
    if (after.accountId === before.accountId) {
      const delta = BigInt(after.amount) - BigInt(before.amount);
      shiftBalances(out, before.accountId, before.date, delta);
    }
  }
  const shown = accountId ? out.filter((r) => r.accountId === accountId) : out;
  for (const create of creates) {
    if (create.savedId && shown.some((r) => r.id === create.savedId)) continue;
    const row = create.row;
    if (accountId && row.accountId !== accountId) continue;
    const through = balanceThrough(shown, row.accountId, row.date) ?? 0n;
    shiftBalances(shown, row.accountId, row.date, BigInt(row.amount));
    const placed = { ...row, runningBalance: (through + BigInt(row.amount)).toString() };
    shown.splice(insertAt(shown, placed, sort), 0, placed);
    pending.set(row.id, "new");
  }
  return { rows: shown, pending };
}

/** What a transaction adds to each account's cleared and uncleared balances. */
type Effect = Map<string, { cleared: bigint; uncleared: bigint }>;

function add(effect: Effect, accountId: string, amount: bigint, cleared: boolean, sign: bigint) {
  const current = effect.get(accountId) ?? { cleared: 0n, uncleared: 0n };
  if (cleared) current.cleared += amount * sign;
  else current.uncleared += amount * sign;
  effect.set(accountId, current);
}

function effectOf(row: Transaction | null, today: string, effect: Effect, sign: bigint) {
  // Balances leave out what's dated after today.
  if (!row || row.date > today) return;
  add(effect, row.accountId, BigInt(row.amount), row.cleared !== "uncleared", sign);
  const side = row.transferSide;
  if (row.transferAccountId && side) {
    add(effect, row.transferAccountId, BigInt(side.amount), side.cleared !== "uncleared", sign);
  }
}

/** How a save moves the accounts' balances: from `before` (null for a new row) to `after`. */
export function balanceChange(
  before: Transaction | null,
  after: Transaction | null,
  today: string,
): Effect {
  const effect: Effect = new Map();
  effectOf(before, today, effect, -1n);
  effectOf(after, today, effect, 1n);
  for (const [id, { cleared, uncleared }] of effect) {
    if (cleared === 0n && uncleared === 0n) effect.delete(id);
  }
  return effect;
}

/**
 * The account list with `change` applied: each account's balances, its converted balances when
 * they're in its own currency, and the sidebar's totals it counts in when they're in that currency
 * too. The next refresh brings the API's figures.
 */
export function withBalanceChange(list: AccountList, change: Effect): AccountList {
  if (change.size === 0) return list;
  const totals = { ...list.totals };
  const bump = (key: keyof AccountList["totals"], currency: string, delta: bigint) => {
    const total = totals[key];
    if (total && total.currency === currency) {
      totals[key] = { ...total, amount: (BigInt(total.amount) + delta).toString() };
    }
  };
  const accounts = list.accounts.map((a) => {
    const delta = change.get(a.id);
    if (!delta) return a;
    const plus = (value: string, by: bigint) => (BigInt(value) + by).toString();
    const working = delta.cleared + delta.uncleared;
    if (!a.closed) {
      bump("netWorth", a.currency, working);
      if (isStarred(a)) bump("starred", a.currency, working);
      const family = accountFamily(a.type);
      if (family === "loan") bump("loans", a.currency, working);
      else if (family === "tracking") bump("tracking", a.currency, working);
      else if (isOnBudget(a.type)) bump("budget", a.currency, working);
    } else bump("closed", a.currency, working);
    return {
      ...a,
      balances: {
        cleared: plus(a.balances.cleared, delta.cleared),
        uncleared: plus(a.balances.uncleared, delta.uncleared),
        working: plus(a.balances.working, working),
      },
      converted:
        a.converted && a.converted.currency === a.currency
          ? {
              ...a.converted,
              cleared: plus(a.converted.cleared, delta.cleared),
              uncleared: plus(a.converted.uncleared, delta.uncleared),
              working: plus(a.converted.working, working),
            }
          : a.converted,
    };
  });
  return { ...list, accounts, totals };
}
