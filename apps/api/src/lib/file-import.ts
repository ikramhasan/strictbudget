import { newId, sql } from "@strictbudget/db";
import {
  accountImportId,
  budgetAccount,
  type MatchedImport,
  payee,
  payeeRule,
  subTransaction,
  transaction,
} from "@strictbudget/db/schema";
import { type ImportRow, importIds, isOnBudget, matchPayeeRule } from "@strictbudget/engine";
import { and, asc, eq, inArray, isNull, max, min, ne } from "drizzle-orm";
import { keepAttachment } from "../routes/transactions/attachments";
import {
  type AccountRow,
  assertOpen,
  reconciledStays,
  resolveCategory,
  usesCategory,
} from "../routes/transactions/rules";
import { budgetCurrencyOf, type FxDeps, syncBases, toBase } from "./base-amount";
import { AppError } from "./errors";
import { type Db, findOrCreatePayee, insertTransaction, internalCategoryId } from "./ledger";
import { payeeCategories } from "./payee-categories";

/**
 * Where a file import's "dated before the account's start date or last reconciliation" line falls:
 * the account's oldest transaction, or the newest reconciled one if that's later.
 * Rows dated before it are skipped unless the import includes them.
 */
export async function importCutoff(db: Db, accountId: string) {
  const [row] = await db
    .select({
      start: min(transaction.date),
      reconciled: max(
        sql<string>`case when ${transaction.cleared} = 'reconciled' then ${transaction.date} end`,
      ),
    })
    .from(transaction)
    .where(eq(transaction.accountId, accountId));
  return { startDate: row?.start ?? null, reconciledThrough: row?.reconciled ?? null };
}

export interface ImportResult {
  transactionIds: string[];
  /** Entered transactions the file's rows were matched to. */
  matchedIds: string[];
  /** Rows the account had already taken in (same import id), so skipped. */
  duplicates: number;
}

/**
 * Adds a bank file's rows to `account`, cleared and unapproved, with the memo kept. A row whose
 * import id the account has seen before (`account_import_id`, deleted transactions included) is
 * skipped. The payee goes through the budget's renaming rules, and the category is the payee's
 * usual one; an inflow from a payee without one goes to Ready to Assign in a cash account.
 */
export async function importTransactions(
  tx: Db,
  fx: FxDeps,
  budgetId: string,
  account: AccountRow,
  rows: readonly ImportRow[],
): Promise<ImportResult> {
  const ids = importIds(rows);
  // Claim the ids before adding anything: a concurrent import of the same rows waits on this
  // transaction's insert and then conflicts, so each id is taken in once.
  const unique = [...new Set(ids)];
  const claimed = new Set(
    unique.length === 0
      ? []
      : (
          await tx
            .insert(accountImportId)
            .values(unique.map((importId) => ({ accountId: account.id, importId })))
            .onConflictDoNothing()
            .returning({ id: accountImportId.importId })
        ).map((r) => r.id),
  );
  const fresh = rows.flatMap((row, i) => {
    const importId = ids[i] as string;
    if (!claimed.delete(importId)) return [];
    return [{ row, importId }];
  });
  if (fresh.length === 0) return { transactionIds: [], matchedIds: [], duplicates: rows.length };

  // Matches first, so matched rows make no payees.
  const dates = fresh.map(({ row }) => row.date).sort();
  const candidates = await matchCandidates(
    tx,
    account.id,
    dates[0] as string,
    dates.at(-1) as string,
  );
  const taken = new Set<string>();
  const plan = fresh.map((item) => {
    const target = pickMatch(candidates, item.row, taken);
    if (target) taken.add(target.id);
    return { ...item, target };
  });

  const rules = await tx
    .select({ payeeId: payeeRule.payeeId, operator: payeeRule.operator, text: payeeRule.text })
    .from(payeeRule)
    .where(eq(payeeRule.budgetId, budgetId))
    .orderBy(asc(payeeRule.createdAt), asc(payeeRule.id));
  const payeeIds: (string | null)[] = [];
  for (const { row, target } of plan) {
    const name = row.payee.trim();
    const rule = !target && name ? matchPayeeRule(rules, name) : undefined;
    payeeIds.push(
      target
        ? null
        : rule
          ? rule.payeeId
          : name
            ? await findOrCreatePayee(tx, budgetId, name)
            : null,
    );
  }

  const known = [...new Set(payeeIds.filter((id): id is string => id !== null))];
  const settings = known.length
    ? await tx
        .select({
          id: payee.id,
          categorization: payee.categorization,
          defaultCategoryId: payee.defaultCategoryId,
          carriedCategoryId: payee.carriedCategoryId,
          autoCategoryId: payee.autoCategoryId,
          autoCategorySaved: payee.autoCategorySaved,
        })
        .from(payee)
        .where(inArray(payee.id, known))
    : [];
  const categories = await payeeCategories(tx, budgetId, settings);
  const cash =
    isOnBudget(account.type) && !["credit_card", "line_of_credit"].includes(account.type);
  const readyToAssign = cash ? await internalCategoryId(tx, budgetId, "ready_to_assign") : null;

  const transactionIds: string[] = [];
  const matchedIds: string[] = [];
  for (const [i, { row, importId, target }] of plan.entries()) {
    if (target) {
      await foldImport(tx, target, { ...row, importId, importedPayee: row.payee });
      matchedIds.push(target.id);
      continue;
    }
    const payeeId = payeeIds[i] ?? null;
    const usual = payeeId ? (categories.get(payeeId)?.prefillCategoryId ?? null) : null;
    const wanted = usual ?? (row.amount > 0n ? readyToAssign : null);
    const id = await insertTransaction(tx, {
      budgetId,
      accountId: account.id,
      date: row.date,
      amount: row.amount,
      currency: account.currency,
      fx,
      payeeId,
      categoryId: usesCategory(account, null)
        ? await resolveCategory(tx, budgetId, account, null, wanted)
        : null,
      memo: row.memo,
      cleared: "cleared",
      flag: null,
      approved: false,
      importId,
      importedPayee: row.payee,
    });
    await syncBases(tx, id);
    transactionIds.push(id);
  }
  return { transactionIds, matchedIds, duplicates: rows.length - fresh.length };
}

/** How far apart an import and an entered transaction may be dated and still match. */
const MATCH_DAYS = 10;

type TransactionRow = typeof transaction.$inferSelect;

/** What the imported side of a match brings. */
interface ImportedSide {
  date: string;
  amount: bigint;
  payee: string;
  memo: string;
  importId: string;
  importedPayee: string | null;
}

/**
 * Entered transactions in the account an import could match: not imported, not
 * matched already, not reconciled, dated within ten days of `from`…`to`.
 */
async function matchCandidates(tx: Db, accountId: string, from: string, to: string) {
  return tx
    .select()
    .from(transaction)
    .where(
      and(
        eq(transaction.accountId, accountId),
        isNull(transaction.importId),
        isNull(transaction.matchedImport),
        ne(transaction.cleared, "reconciled"),
        sql`${transaction.date} between (${from}::date - ${MATCH_DAYS}::int) and (${to}::date + ${MATCH_DAYS}::int)`,
      ),
    )
    .orderBy(asc(transaction.createdAt), asc(transaction.id));
}

const dayNumber = (iso: string) =>
  Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

/**
 * The entered transaction an imported row matches: the exact amount, dated within ten days; the
 * nearest date wins, then the oldest entry.
 */
function pickMatch(candidates: readonly TransactionRow[], row: ImportRow, taken: Set<string>) {
  let best: TransactionRow | undefined;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (taken.has(c.id) || c.amount !== row.amount) continue;
    const gap = Math.abs(dayNumber(c.date) - dayNumber(row.date));
    if (gap <= MATCH_DAYS && gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

async function isSplit(tx: Db, transactionId: string) {
  const lines = await tx
    .select({ id: subTransaction.id })
    .from(subTransaction)
    .where(eq(subTransaction.transactionId, transactionId))
    .limit(1);
  return lines.length > 0;
}

/**
 * Folds an imported transaction into an entered one: the entered date,
 * payee, memo and category stay, the bank's amount is taken, and the result is cleared and
 * approved. What the entered one was is kept for Unmatch.
 */
async function foldImport(tx: Db, target: TransactionRow, imported: ImportedSide) {
  const amountChanges = imported.amount !== target.amount;
  if (amountChanges) {
    if (
      target.transferTransactionId ||
      target.transferSubTransactionId ||
      (await isSplit(tx, target.id))
    ) {
      throw new AppError(
        400,
        "MATCH_AMOUNT",
        "A transfer or split can only be matched to an import of the same amount",
      );
    }
  }
  const matchedImport: MatchedImport = {
    date: imported.date,
    amount: imported.amount.toString(),
    payee: imported.payee,
    memo: imported.memo,
    importId: imported.importId,
    importedPayee: imported.importedPayee,
    previousAmount: target.amount.toString(),
    previousCleared: target.cleared,
    previousApproved: target.approved,
  };
  const budgetCurrency = await budgetCurrencyOf(tx, target.budgetId);
  await tx
    .update(transaction)
    .set({
      amount: imported.amount,
      ...(amountChanges
        ? { baseAmount: toBase(imported.amount, target.currency, target.fxRate, budgetCurrency) }
        : {}),
      cleared: "cleared",
      approved: true,
      importId: imported.importId,
      importedPayee: imported.importedPayee,
      matchedImport,
    })
    .where(eq(transaction.id, target.id));
  if (amountChanges) await syncBases(tx, target.id);
}

/**
 * Manual Match: an imported transaction that isn't matched yet and an
 * entered one in the same account become one, the entered one keeping its details with the
 * bank's amount. Returns the merged transaction's id (the entered one's).
 */
export async function matchTransactions(tx: Db, budgetId: string, ids: readonly [string, string]) {
  const rows = await tx
    .select()
    .from(transaction)
    .where(and(eq(transaction.budgetId, budgetId), inArray(transaction.id, [...ids])));
  const imported = rows.filter((r) => r.importId !== null && r.matchedImport === null);
  const entered = rows.filter((r) => r.importId === null && r.matchedImport === null);
  const [source] = imported;
  const [target] = entered;
  if (rows.length !== 2 || imported.length !== 1 || !source || !target) {
    throw new AppError(
      400,
      "NOT_MATCHABLE",
      "Match takes one imported transaction and one entered transaction",
    );
  }
  if (source.accountId !== target.accountId) {
    throw new AppError(400, "NOT_MATCHABLE", "Matched transactions must be in the same account");
  }
  if (target.cleared === "reconciled" || source.cleared === "reconciled") {
    throw new AppError(400, "NOT_MATCHABLE", "A reconciled transaction can't be matched");
  }
  // Match removes the imported row outright, so it has to be a plain one: deleting a transfer or
  // a split here would leave its other sides behind.
  if (
    source.transferTransactionId ||
    source.transferSubTransactionId ||
    (await isSplit(tx, source.id))
  ) {
    throw new AppError(
      400,
      "NOT_MATCHABLE",
      "An imported transfer or split can't be matched; undo the transfer or split first",
    );
  }
  const [named] = source.payeeId
    ? await tx.select({ name: payee.name }).from(payee).where(eq(payee.id, source.payeeId))
    : [];
  // An attachment added to the imported row comes along, unless the entered one has its own.
  await keepAttachment(tx, source.id, target.id);
  await tx.delete(transaction).where(eq(transaction.id, source.id));
  await foldImport(tx, target, {
    date: source.date,
    amount: source.amount,
    payee: named?.name ?? "",
    memo: source.memo,
    importId: source.importId as string,
    importedPayee: source.importedPayee,
  });
  return target.id;
}

/**
 * Unmatch: the imported transaction comes back on its own (its date, amount,
 * payee and memo, cleared, unapproved, Uncategorized) and the entered one returns to its amount,
 * cleared state and approval from before the match. Returns both ids.
 */
export async function unmatchTransaction(tx: Db, budgetId: string, id: string) {
  const [target] = await tx
    .select()
    .from(transaction)
    .where(and(eq(transaction.budgetId, budgetId), eq(transaction.id, id)));
  if (!target) throw new AppError(404, "NOT_FOUND", "No such transaction");
  const matched = target.matchedImport;
  if (!matched) throw new AppError(400, "NOT_MATCHED", "This transaction isn't matched");
  const [account] = await tx
    .select()
    .from(budgetAccount)
    .where(eq(budgetAccount.id, target.accountId));
  if (!account) throw new AppError(404, "NOT_FOUND", "No such account");
  assertOpen(account);
  if (target.cleared === "reconciled") reconciledStays();
  // A transfer or split was only ever matched at its own amount (foldImport), so it keeps the
  // amount it has now: putting back an older one would undo a later edit on one side only.
  const keepsAmount =
    target.transferTransactionId !== null ||
    target.transferSubTransactionId !== null ||
    (await isSplit(tx, target.id));
  const previousAmount = keepsAmount ? target.amount : BigInt(matched.previousAmount);
  const budgetCurrency = await budgetCurrencyOf(tx, budgetId);
  await tx
    .update(transaction)
    .set({
      amount: previousAmount,
      baseAmount: keepsAmount
        ? target.baseAmount
        : toBase(previousAmount, target.currency, target.fxRate, budgetCurrency),
      cleared: matched.previousCleared,
      approved: matched.previousApproved,
      importId: null,
      importedPayee: null,
      matchedImport: null,
    })
    .where(eq(transaction.id, target.id));
  await syncBases(tx, target.id);
  const payeeName = matched.payee.trim();
  const importedId = await insertTransaction(tx, {
    budgetId,
    accountId: target.accountId,
    date: matched.date,
    amount: BigInt(matched.amount),
    currency: target.currency,
    fxRate: target.fxRate,
    baseAmount: toBase(BigInt(matched.amount), target.currency, target.fxRate, budgetCurrency),
    payeeId: payeeName ? await findOrCreatePayee(tx, budgetId, payeeName) : null,
    categoryId: usesCategory(account, null)
      ? await resolveCategory(tx, budgetId, account, null, null)
      : null,
    memo: matched.memo,
    cleared: "cleared",
    flag: null,
    approved: false,
    importId: matched.importId,
    importedPayee: matched.importedPayee,
  });
  return { transactionId: target.id, importedTransactionId: importedId };
}

/**
 * The automatic renaming rule: changing an imported transaction's
 * payee adds "Is <imported name>" to the new payee's renaming rules, unless it has that rule or
 * the new payee is the imported name itself.
 */
export async function rememberRename(
  tx: Db,
  budgetId: string,
  payeeId: string,
  importedName: string,
) {
  const text = importedName.trim();
  if (!text) return;
  const [target] = await tx.select({ name: payee.name }).from(payee).where(eq(payee.id, payeeId));
  if (!target || target.name.toLowerCase() === text.toLowerCase()) return;
  const rules = await tx
    .select({ operator: payeeRule.operator, text: payeeRule.text, position: payeeRule.position })
    .from(payeeRule)
    .where(eq(payeeRule.payeeId, payeeId));
  if (rules.some((r) => r.operator === "is" && r.text.toLowerCase() === text.toLowerCase())) return;
  await tx.insert(payeeRule).values({
    id: newId(),
    budgetId,
    payeeId,
    operator: "is",
    text,
    position: Math.max(-1, ...rules.map((r) => r.position)) + 1,
  });
}

/**
 * "Don't Rename as <payee>" (Bank Import Details): the transaction goes back to
 * its imported payee name, and the payee's "Is <imported name>" rule is removed.
 */
export async function dontRename(tx: Db, budgetId: string, transactionId: string) {
  const [row] = await tx
    .select()
    .from(transaction)
    .where(and(eq(transaction.budgetId, budgetId), eq(transaction.id, transactionId)));
  if (!row) throw new AppError(404, "NOT_FOUND", "No such transaction");
  const name = row.importedPayee?.trim();
  if (!name || row.matchedImport) {
    throw new AppError(400, "NOT_IMPORTED", "This transaction wasn't imported (or is matched)");
  }
  if (row.payeeId) {
    await tx
      .delete(payeeRule)
      .where(
        and(
          eq(payeeRule.payeeId, row.payeeId),
          eq(payeeRule.operator, "is"),
          sql`lower(${payeeRule.text}) = lower(${name})`,
        ),
      );
  }
  const payeeId = await findOrCreatePayee(tx, budgetId, name);
  await tx.update(transaction).set({ payeeId, approved: true }).where(eq(transaction.id, row.id));
  return payeeId;
}
