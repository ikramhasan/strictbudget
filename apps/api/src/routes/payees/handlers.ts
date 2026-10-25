import type { RouteHandler } from "@hono/zod-openapi";
import { newId, sql } from "@strictbudget/db";
import {
  budgetAccount,
  category,
  categoryGroup,
  payee,
  payeeRule,
  scheduledSubTransaction,
  scheduledTransaction,
  subTransaction,
  transaction,
} from "@strictbudget/db/schema";
import type { PayeeCategorization } from "@strictbudget/engine";
import { and, asc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import type { Db } from "../../lib/ledger";
import {
  type PayeeCategories,
  type PayeeCategorySettings,
  payeeCategories,
} from "../../lib/payee-categories";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type {
  combinePayees,
  createPayeeRule,
  deletePayeeRule,
  deletePayees,
  listPayeeRules,
  listPayees,
  listPayeeTransactions,
  restorePayees,
  setPayeesHidden,
  updatePayee,
  updatePayeeRule,
} from "./routes";

type Env = AppEnv & AuthedEnv;
/** Payees are part of editing transactions, so they take the same permission. */
const EDIT = { transaction: ["update"] } as const;

const NAME_TAKEN = () =>
  new AppError(409, "PAYEE_NAME_TAKEN", "Another payee already exists with this name");

interface PayeeUses {
  payeeId: string;
  transactionIds: string[];
  subTransactionIds: string[];
  scheduledTransactionIds: string[];
  scheduledSubTransactionIds: string[];
}

interface RuleSnapshot {
  id: string;
  payeeId: string;
  operator: "contains" | "is";
  text: string;
  position: number;
  createdAt: string;
}

interface SnapshotPayee {
  id: string;
  name: string;
  hidden: boolean;
  categorization?: PayeeCategorization;
  defaultCategoryId?: string | null;
  carriedCategoryId?: string | null;
  autoCategoryId?: string | null;
  autoCategorySaved?: boolean;
}

interface PayeeSnapshot {
  payees: SnapshotPayee[];
  uses: PayeeUses[];
  rules: RuleSnapshot[];
}

/** These payees' renaming rules, each payee's in order, so a change can be undone. */
async function rulesOf(db: Db, payeeIds: readonly string[]): Promise<RuleSnapshot[]> {
  if (payeeIds.length === 0) return [];
  const rows = await db
    .select()
    .from(payeeRule)
    .where(inArray(payeeRule.payeeId, payeeIds))
    .orderBy(asc(payeeRule.position), asc(payeeRule.createdAt), asc(payeeRule.id));
  return payeeIds.flatMap((id) =>
    rows
      .filter((r) => r.payeeId === id)
      .map((r) => ({
        id: r.id,
        payeeId: r.payeeId,
        operator: r.operator,
        text: r.text,
        position: r.position,
        createdAt: r.createdAt.toISOString(),
      })),
  );
}

function snapshotOf(p: typeof payee.$inferSelect): SnapshotPayee {
  return {
    id: p.id,
    name: p.name,
    hidden: p.hidden,
    categorization: p.categorization,
    defaultCategoryId: p.defaultCategoryId,
    carriedCategoryId: p.carriedCategoryId,
    autoCategoryId: p.autoCategoryId,
    autoCategorySaved: p.autoCategorySaved,
  };
}

function payeeColumns() {
  const useCount = sql<number>`(
    (select count(*) from ${transaction} t where t.payee_id = ${payee}.id)
    + (select count(*) from ${subTransaction} s where s.payee_id = ${payee}.id)
    + (select count(*) from ${scheduledTransaction} st where st.payee_id = ${payee}.id)
    + (select count(*) from ${scheduledSubTransaction} ss where ss.payee_id = ${payee}.id)
  )::int`;
  return {
    id: payee.id,
    name: payee.name,
    hidden: payee.hidden,
    useCount,
    categorization: payee.categorization,
    defaultCategoryId: payee.defaultCategoryId,
    carriedCategoryId: payee.carriedCategoryId,
    autoCategoryId: payee.autoCategoryId,
    autoCategorySaved: payee.autoCategorySaved,
  };
}

async function withCategories<T extends PayeeCategorySettings>(
  db: Db,
  budgetId: string,
  rows: T[],
) {
  const categories = await payeeCategories(db, budgetId, rows);
  return rows.map(
    ({ carriedCategoryId: _, autoCategoryId: __, autoCategorySaved: ___, ...row }) => ({
      ...row,
      ...(categories.get(row.id) as PayeeCategories),
    }),
  );
}

/** People's payees: not a transfer payee or a built-in one like "Starting Balance". */
const peoplesPayee = (budgetId: string) =>
  and(eq(payee.budgetId, budgetId), isNull(payee.internalKind), isNull(payee.transferAccountId));

/**
 * The budget's payees with these ids, locked for the change. Unknown ids are 404; transfer and
 * built-in payees are created for you and can't be changed.
 */
async function lockPayees(db: Db, budgetId: string, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const rows = await db
    .select()
    .from(payee)
    .where(and(eq(payee.budgetId, budgetId), inArray(payee.id, unique)))
    .orderBy(asc(payee.id))
    .for("update");
  if (rows.length !== unique.length) throw new AppError(404, "NOT_FOUND", "Payee not found");
  if (rows.some((p) => p.internalKind || p.transferAccountId)) {
    throw new AppError(
      409,
      "PAYEE_LOCKED",
      "Transfer payees are used to move money between accounts and are created for you, so they " +
        "can't be edited or deleted.",
    );
  }
  const byId = new Map(rows.map((p) => [p.id, p]));
  return unique.map((id) => byId.get(id) as (typeof rows)[number]);
}

/** Another of the budget's payees (transfer ones aside) already called `name`, case aside. */
async function payeeNamed(db: Db, budgetId: string, name: string, notId?: string) {
  const [row] = await db
    .select()
    .from(payee)
    .where(
      and(
        eq(payee.budgetId, budgetId),
        isNull(payee.transferAccountId),
        sql`lower(${payee.name}) = lower(${name})`,
        notId ? ne(payee.id, notId) : undefined,
      ),
    );
  return row;
}

/** The rows pointing at each of these payees, so a change can be undone. */
async function usesOf(db: Db, budgetId: string, payeeIds: readonly string[]): Promise<PayeeUses[]> {
  if (payeeIds.length === 0) return [];
  const [txns, lines, scheduled, scheduledLines] = await Promise.all([
    db
      .select({ id: transaction.id, payeeId: transaction.payeeId })
      .from(transaction)
      .where(and(eq(transaction.budgetId, budgetId), inArray(transaction.payeeId, payeeIds))),
    db
      .select({ id: subTransaction.id, payeeId: subTransaction.payeeId })
      .from(subTransaction)
      .where(inArray(subTransaction.payeeId, payeeIds)),
    db
      .select({ id: scheduledTransaction.id, payeeId: scheduledTransaction.payeeId })
      .from(scheduledTransaction)
      .where(
        and(
          eq(scheduledTransaction.budgetId, budgetId),
          inArray(scheduledTransaction.payeeId, payeeIds),
        ),
      ),
    db
      .select({ id: scheduledSubTransaction.id, payeeId: scheduledSubTransaction.payeeId })
      .from(scheduledSubTransaction)
      .where(inArray(scheduledSubTransaction.payeeId, payeeIds)),
  ]);
  return payeeIds.map((payeeId) => ({
    payeeId,
    transactionIds: txns.filter((r) => r.payeeId === payeeId).map((r) => r.id),
    subTransactionIds: lines.filter((r) => r.payeeId === payeeId).map((r) => r.id),
    scheduledTransactionIds: scheduled.filter((r) => r.payeeId === payeeId).map((r) => r.id),
    scheduledSubTransactionIds: scheduledLines
      .filter((r) => r.payeeId === payeeId)
      .map((r) => r.id),
  }));
}

/** Points every row using `from` at `to` (null: no payee). */
async function repoint(db: Db, budgetId: string, from: readonly string[], to: string | null) {
  if (from.length === 0) return;
  const set = { payeeId: to, updatedAt: sql`now()` };
  await db
    .update(transaction)
    .set(set)
    .where(and(eq(transaction.budgetId, budgetId), inArray(transaction.payeeId, from)));
  await db.update(subTransaction).set(set).where(inArray(subTransaction.payeeId, from));
  await db
    .update(scheduledTransaction)
    .set(set)
    .where(
      and(eq(scheduledTransaction.budgetId, budgetId), inArray(scheduledTransaction.payeeId, from)),
    );
  await db
    .update(scheduledSubTransaction)
    .set(set)
    .where(inArray(scheduledSubTransaction.payeeId, from));
}

async function readPayee(db: Db, budgetId: string, id: string) {
  const rows = await db.select(payeeColumns()).from(payee).where(eq(payee.id, id));
  const [row] = await withCategories(db, budgetId, rows);
  if (!row) throw new Error(`Payee ${id} missing`);
  return row;
}

export const listPayeesHandler: RouteHandler<typeof listPayees, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { include } = c.req.valid("query");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  const rows = await db
    .select(payeeColumns())
    .from(payee)
    .where(include === "all" ? eq(payee.budgetId, budgetId) : peoplesPayee(budgetId))
    .orderBy(asc(sql`lower(${payee.name})`), asc(payee.id));
  return c.json({ payees: await withCategories(db, budgetId, rows) }, 200);
};

/**
 * The categorization columns to set for an update, if it changes them. "Always use my choice"
 * needs a category the category list offers; the other two settings forget it.
 */
async function categorizationChange(
  db: Db,
  budgetId: string,
  current: { categorization: PayeeCategorization; defaultCategoryId: string | null } | undefined,
  input: {
    categorization?: PayeeCategorization;
    defaultCategoryId?: string | null;
    restore?: boolean;
  },
) {
  if (input.categorization === undefined && input.defaultCategoryId === undefined) return {};
  const categorization = input.categorization ?? current?.categorization ?? "auto";
  if (categorization !== "always") return { categorization, defaultCategoryId: null };
  const defaultCategoryId =
    input.defaultCategoryId === undefined
      ? (current?.defaultCategoryId ?? null)
      : input.defaultCategoryId;
  if (defaultCategoryId === null) {
    throw new AppError(400, "CATEGORY_REQUIRED", "Choose the category to always use");
  }
  // A new choice must be one the category list offers: hidden categories aren't listed. Undo
  // (`restore`) may bring back a category that has been hidden since it was chosen.
  const choosing =
    input.defaultCategoryId !== undefined &&
    !input.restore &&
    input.defaultCategoryId !== current?.defaultCategoryId;
  const [row] = await db
    .select({ id: category.id })
    .from(category)
    .innerJoin(categoryGroup, eq(categoryGroup.id, category.groupId))
    .where(
      and(
        eq(category.id, defaultCategoryId),
        eq(category.budgetId, budgetId),
        sql`${category.internalKind} is distinct from 'uncategorized'`,
        isNull(category.linkedAccountId),
        choosing ? eq(category.hidden, false) : undefined,
        choosing ? eq(categoryGroup.hidden, false) : undefined,
      ),
    );
  if (!row) {
    throw new AppError(400, "INVALID_CATEGORY", "That category can't be a payee's default");
  }
  return { categorization, defaultCategoryId };
}

export const updatePayeeHandler: RouteHandler<typeof updatePayee, Env> = async (c) => {
  const { budgetId, payeeId } = c.req.valid("param");
  const input = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, EDIT);
  const row = await db.transaction(async (tx) => {
    const [current] = await lockPayees(tx, budgetId, [payeeId]);
    if (input.name !== undefined && (await payeeNamed(tx, budgetId, input.name, payeeId))) {
      throw NAME_TAKEN();
    }
    await tx
      .update(payee)
      .set({
        name: input.name,
        hidden: input.hidden,
        ...(await categorizationChange(tx, budgetId, current, input)),
        updatedAt: sql`now()`,
      })
      .where(eq(payee.id, payeeId));
    return readPayee(tx, budgetId, payeeId);
  });
  return c.json(row, 200);
};

export const setPayeesHiddenHandler: RouteHandler<typeof setPayeesHidden, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { payeeIds, hidden } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, EDIT);
  await db.transaction(async (tx) => {
    await lockPayees(tx, budgetId, payeeIds);
    await tx
      .update(payee)
      .set({ hidden, updatedAt: sql`now()` })
      .where(inArray(payee.id, payeeIds));
  });
  return c.body(null, 204);
};

export const combinePayeesHandler: RouteHandler<typeof combinePayees, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { payeeIds, name } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, EDIT);
  const result = await db.transaction(async (tx) => {
    const selected = await lockPayees(tx, budgetId, payeeIds);
    // A payee that already has the name keeps it (even when it wasn't selected);
    // otherwise the first one selected takes the name.
    const named = await payeeNamed(tx, budgetId, name);
    if (named && (named.internalKind || named.transferAccountId)) throw NAME_TAKEN();
    const target = named ? (await lockPayees(tx, budgetId, [named.id]))[0] : selected[0];
    if (!target) throw new Error("No payee to combine into");
    const others = selected.filter((p) => p.id !== target.id);
    const affected = [target, ...others];
    const snapshot: PayeeSnapshot = {
      payees: affected.map(snapshotOf),
      uses: await usesOf(
        tx,
        budgetId,
        others.map((p) => p.id),
      ),
      rules: await rulesOf(
        tx,
        affected.map((p) => p.id),
      ),
    };
    // The others' renaming rules move to the target, after its own.
    const targetRules = snapshot.rules.filter((r) => r.payeeId === target.id);
    let position = Math.max(-1, ...targetRules.map((r) => r.position));
    for (const rule of snapshot.rules.filter((r) => r.payeeId !== target.id)) {
      position += 1;
      await tx
        .update(payeeRule)
        .set({ payeeId: target.id, position, updatedAt: sql`now()` })
        .where(eq(payeeRule.id, rule.id));
    }
    // The target keeps its own Categorization and default: its default is saved as it stands,
    // so the moved history doesn't change it.
    const kept = (await payeeCategories(tx, budgetId, [target])).get(target.id);
    await tx
      .update(payee)
      .set({ autoCategoryId: kept?.autoCategoryId ?? null, autoCategorySaved: true })
      .where(eq(payee.id, target.id));
    await repoint(
      tx,
      budgetId,
      others.map((p) => p.id),
      target.id,
    );
    if (others.length > 0) {
      await tx.delete(payee).where(
        inArray(
          payee.id,
          others.map((p) => p.id),
        ),
      );
    }
    await tx.update(payee).set({ name, updatedAt: sql`now()` }).where(eq(payee.id, target.id));
    return { payee: await readPayee(tx, budgetId, target.id), snapshot };
  });
  return c.json(result, 200);
};

export const deletePayeesHandler: RouteHandler<typeof deletePayees, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { payeeIds, replacementPayeeId } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, EDIT);
  const snapshot = await db.transaction(async (tx) => {
    const doomed = await lockPayees(tx, budgetId, payeeIds);
    const ids = doomed.map((p) => p.id);
    if (replacementPayeeId !== null) {
      const [replacement] = await tx
        .select({ id: payee.id })
        .from(payee)
        .where(and(eq(payee.id, replacementPayeeId), peoplesPayee(budgetId)));
      if (!replacement || ids.includes(replacementPayeeId)) {
        throw new AppError(
          409,
          "INVALID_REPLACEMENT",
          "The new payee must be another of the budget's payees",
        );
      }
    }
    // Their renaming rules go with them.
    const snapshot: PayeeSnapshot = {
      payees: doomed.map(snapshotOf),
      uses: await usesOf(tx, budgetId, ids),
      rules: await rulesOf(tx, ids),
    };
    await repoint(tx, budgetId, ids, replacementPayeeId);
    await tx.delete(payee).where(inArray(payee.id, ids));
    return snapshot;
  });
  return c.json({ snapshot }, 200);
};

/**
 * A snapshot's categorization settings, for putting a payee back. Categories that are gone or
 * belong to another budget are dropped (a snapshot comes from the client).
 */
async function restorableCategories(db: Db, budgetId: string, p: SnapshotPayee) {
  if (p.categorization === undefined) return {};
  const ids = [p.defaultCategoryId, p.carriedCategoryId, p.autoCategoryId].filter(
    (id): id is string => typeof id === "string",
  );
  const known =
    ids.length === 0
      ? []
      : await db
          .select({ id: category.id })
          .from(category)
          .where(and(eq(category.budgetId, budgetId), inArray(category.id, ids)));
  const keep = (id: string | null | undefined) =>
    id && known.some((k) => k.id === id) ? id : null;
  const defaultCategoryId = keep(p.defaultCategoryId);
  const categorization: PayeeCategorization =
    p.categorization === "always" && !defaultCategoryId ? "auto" : p.categorization;
  return {
    categorization,
    defaultCategoryId,
    carriedCategoryId: keep(p.carriedCategoryId),
    // Snapshots from before the stored default leave it out: the history is replayed then.
    autoCategoryId: keep(p.autoCategoryId),
    autoCategorySaved: p.autoCategorySaved ?? false,
  };
}

export const restorePayeesHandler: RouteHandler<typeof restorePayees, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const snapshot = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, EDIT);
  await db.transaction(async (tx) => {
    const ids = snapshot.payees.map((p) => p.id);
    const existing =
      ids.length === 0
        ? []
        : await tx.select().from(payee).where(inArray(payee.id, ids)).for("update");
    if (existing.some((p) => p.budgetId !== budgetId)) {
      throw new AppError(404, "NOT_FOUND", "Payee not found");
    }
    if (existing.some((p) => p.internalKind || p.transferAccountId)) {
      throw new AppError(409, "PAYEE_LOCKED", "Transfer payees can't be edited");
    }
    // Free every name first, so payees can swap names back (combining renames the target).
    for (const p of snapshot.payees) {
      const clash = await payeeNamed(tx, budgetId, p.name, p.id);
      if (clash && !ids.includes(clash.id)) throw NAME_TAKEN();
    }
    if (existing.length > 0) {
      await tx
        .update(payee)
        .set({ name: sql`${payee.id}`, updatedAt: sql`now()` })
        .where(
          inArray(
            payee.id,
            existing.map((p) => p.id),
          ),
        );
    }
    for (const p of snapshot.payees) {
      const settings = await restorableCategories(tx, budgetId, p);
      await tx
        .insert(payee)
        .values({ id: p.id, budgetId, name: p.name, hidden: p.hidden, ...settings })
        .onConflictDoUpdate({
          target: payee.id,
          set: { name: p.name, hidden: p.hidden, ...settings, updatedAt: sql`now()` },
        });
    }
    if (snapshot.rules.some((r) => !ids.includes(r.payeeId))) {
      throw new AppError(400, "BAD_REQUEST", "Rules must belong to the snapshot's payees");
    }
    const ruleIds = snapshot.rules.map((r) => r.id);
    if (ruleIds.length > 0) {
      const foreign = await tx
        .select({ id: payeeRule.id })
        .from(payeeRule)
        .where(and(inArray(payeeRule.id, ruleIds), ne(payeeRule.budgetId, budgetId)));
      if (foreign.length > 0) throw new AppError(404, "NOT_FOUND", "Rule not found");
    }
    for (const rule of snapshot.rules) {
      const values = {
        payeeId: rule.payeeId,
        operator: rule.operator,
        text: rule.text,
        position: rule.position,
        createdAt: new Date(rule.createdAt),
      };
      await tx
        .insert(payeeRule)
        .values({ id: rule.id, budgetId, ...values })
        .onConflictDoUpdate({ target: payeeRule.id, set: { ...values, updatedAt: sql`now()` } });
    }
    for (const use of snapshot.uses) {
      if (!ids.includes(use.payeeId)) {
        // Only rows of payees in the snapshot are moved, so a snapshot can't re-point to others.
        throw new AppError(400, "BAD_REQUEST", "Uses must belong to the snapshot's payees");
      }
      const set = { payeeId: use.payeeId, updatedAt: sql`now()` };
      if (use.transactionIds.length > 0) {
        await tx
          .update(transaction)
          .set(set)
          .where(
            and(eq(transaction.budgetId, budgetId), inArray(transaction.id, use.transactionIds)),
          );
      }
      if (use.subTransactionIds.length > 0) {
        await tx
          .update(subTransaction)
          .set(set)
          .where(
            and(
              inArray(subTransaction.id, use.subTransactionIds),
              inArray(
                subTransaction.transactionId,
                tx
                  .select({ id: transaction.id })
                  .from(transaction)
                  .where(eq(transaction.budgetId, budgetId)),
              ),
            ),
          );
      }
      if (use.scheduledTransactionIds.length > 0) {
        await tx
          .update(scheduledTransaction)
          .set(set)
          .where(
            and(
              eq(scheduledTransaction.budgetId, budgetId),
              inArray(scheduledTransaction.id, use.scheduledTransactionIds),
            ),
          );
      }
      if (use.scheduledSubTransactionIds.length > 0) {
        await tx
          .update(scheduledSubTransaction)
          .set(set)
          .where(
            and(
              inArray(scheduledSubTransaction.id, use.scheduledSubTransactionIds),
              inArray(
                scheduledSubTransaction.scheduledTransactionId,
                tx
                  .select({ id: scheduledTransaction.id })
                  .from(scheduledTransaction)
                  .where(eq(scheduledTransaction.budgetId, budgetId)),
              ),
            ),
          );
      }
    }
  });
  return c.body(null, 204);
};

export const listPayeeTransactionsHandler: RouteHandler<typeof listPayeeTransactions, Env> = async (
  c,
) => {
  const { budgetId } = c.req.valid("param");
  const { payeeIds } = c.req.valid("query");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  const ids = payeeIds.slice(0, 1000);
  // Uncategorized shows as no category.
  const categoryName = sql<string | null>`case when ${category.internalKind} = 'uncategorized'
    then null else ${category.name} end`;
  const common = {
    accountId: budgetAccount.id,
    accountName: budgetAccount.name,
    categoryName,
  };
  const [txns, lines, scheduled, scheduledLines] = await Promise.all([
    db
      .select({
        ...common,
        id: transaction.id,
        date: transaction.date,
        memo: transaction.memo,
        amount: transaction.amount,
        currency: transaction.currency,
      })
      .from(transaction)
      .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
      .leftJoin(category, eq(category.id, transaction.categoryId))
      .where(and(eq(transaction.budgetId, budgetId), inArray(transaction.payeeId, ids))),
    db
      .select({
        ...common,
        id: subTransaction.id,
        date: transaction.date,
        memo: subTransaction.memo,
        amount: subTransaction.amount,
        currency: subTransaction.currency,
      })
      .from(subTransaction)
      .innerJoin(transaction, eq(transaction.id, subTransaction.transactionId))
      .innerJoin(budgetAccount, eq(budgetAccount.id, transaction.accountId))
      .leftJoin(category, eq(category.id, subTransaction.categoryId))
      .where(and(eq(transaction.budgetId, budgetId), inArray(subTransaction.payeeId, ids))),
    db
      .select({
        ...common,
        id: scheduledTransaction.id,
        date: scheduledTransaction.dateNext,
        memo: scheduledTransaction.memo,
        amount: scheduledTransaction.amount,
        currency: scheduledTransaction.currency,
      })
      .from(scheduledTransaction)
      .innerJoin(budgetAccount, eq(budgetAccount.id, scheduledTransaction.accountId))
      .leftJoin(category, eq(category.id, scheduledTransaction.categoryId))
      .where(
        and(
          eq(scheduledTransaction.budgetId, budgetId),
          inArray(scheduledTransaction.payeeId, ids),
        ),
      ),
    db
      .select({
        ...common,
        id: scheduledSubTransaction.id,
        date: scheduledTransaction.dateNext,
        memo: scheduledSubTransaction.memo,
        amount: scheduledSubTransaction.amount,
        currency: scheduledSubTransaction.currency,
      })
      .from(scheduledSubTransaction)
      .innerJoin(
        scheduledTransaction,
        eq(scheduledTransaction.id, scheduledSubTransaction.scheduledTransactionId),
      )
      .innerJoin(budgetAccount, eq(budgetAccount.id, scheduledTransaction.accountId))
      .leftJoin(category, eq(category.id, scheduledSubTransaction.categoryId))
      .where(
        and(
          eq(scheduledTransaction.budgetId, budgetId),
          inArray(scheduledSubTransaction.payeeId, ids),
        ),
      ),
  ]);
  const rows = [
    ...txns.map((r) => ({ ...r, kind: "transaction" as const, splitLine: false })),
    ...lines.map((r) => ({ ...r, kind: "transaction" as const, splitLine: true })),
    ...scheduled.map((r) => ({ ...r, kind: "scheduled" as const, splitLine: false })),
    ...scheduledLines.map((r) => ({ ...r, kind: "scheduled" as const, splitLine: true })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .map((r) => ({ ...r, amount: r.amount.toString() }));
  return c.json({ transactions: rows }, 200);
};

const ruleColumns = {
  id: payeeRule.id,
  payeeId: payeeRule.payeeId,
  operator: payeeRule.operator,
  text: payeeRule.text,
};

async function findRule(db: Db, budgetId: string, ruleId: string) {
  const [row] = await db
    .select(ruleColumns)
    .from(payeeRule)
    .where(and(eq(payeeRule.id, ruleId), eq(payeeRule.budgetId, budgetId)));
  if (!row) throw new AppError(404, "NOT_FOUND", "Rule not found");
  return row;
}

export const listPayeeRulesHandler: RouteHandler<typeof listPayeeRules, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  const [rules, transferPayees] = await Promise.all([
    db
      .select(ruleColumns)
      .from(payeeRule)
      .where(eq(payeeRule.budgetId, budgetId))
      .orderBy(asc(payeeRule.payeeId), asc(payeeRule.position), asc(payeeRule.createdAt)),
    db
      .select({ payeeId: payee.id, accountId: payee.transferAccountId })
      .from(payee)
      .where(and(eq(payee.budgetId, budgetId), isNotNull(payee.transferAccountId))),
  ]);
  return c.json(
    {
      rules,
      transferPayees: transferPayees.map((p) => ({
        payeeId: p.payeeId,
        accountId: p.accountId as string,
      })),
    },
    200,
  );
};

export const createPayeeRuleHandler: RouteHandler<typeof createPayeeRule, Env> = async (c) => {
  const { budgetId, payeeId } = c.req.valid("param");
  const { operator, text, position } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, EDIT);
  const row = await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(payee)
      .where(and(eq(payee.id, payeeId), eq(payee.budgetId, budgetId)))
      .for("update");
    if (!target) throw new AppError(404, "NOT_FOUND", "Payee not found");
    // Transfer payees take rules; built-in ones like Starting Balance aren't listed.
    if (target.internalKind) {
      throw new AppError(409, "PAYEE_LOCKED", "Built-in payees can't have renaming rules");
    }
    // `position` is the index among the payee's rules as listed (undoing a removal puts the rule
    // back there); stored positions can have gaps after deletes, so the list is renumbered.
    const ordered = await tx
      .select({ id: payeeRule.id })
      .from(payeeRule)
      .where(eq(payeeRule.payeeId, payeeId))
      .orderBy(asc(payeeRule.position), asc(payeeRule.createdAt), asc(payeeRule.id));
    const id = newId();
    const at = Math.min(position ?? ordered.length, ordered.length);
    await tx.insert(payeeRule).values({ id, budgetId, payeeId, operator, text, position: at });
    const ids = ordered.map((r) => r.id);
    ids.splice(at, 0, id);
    for (const [index, ruleId] of ids.entries()) {
      await tx.update(payeeRule).set({ position: index }).where(eq(payeeRule.id, ruleId));
    }
    return findRule(tx, budgetId, id);
  });
  return c.json(row, 201);
};

export const updatePayeeRuleHandler: RouteHandler<typeof updatePayeeRule, Env> = async (c) => {
  const { budgetId, ruleId } = c.req.valid("param");
  const { operator, text } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, EDIT);
  await findRule(db, budgetId, ruleId);
  if (operator !== undefined || text !== undefined) {
    await db
      .update(payeeRule)
      .set({ operator, text, updatedAt: sql`now()` })
      .where(eq(payeeRule.id, ruleId));
  }
  return c.json(await findRule(db, budgetId, ruleId), 200);
};

export const deletePayeeRuleHandler: RouteHandler<typeof deletePayeeRule, Env> = async (c) => {
  const { budgetId, ruleId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, EDIT);
  await findRule(db, budgetId, ruleId);
  await db.delete(payeeRule).where(eq(payeeRule.id, ruleId));
  return c.body(null, 204);
};
