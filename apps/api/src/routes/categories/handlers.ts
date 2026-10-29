import type { RouteHandler } from "@hono/zod-openapi";
import { newId } from "@strictbudget/db";
import {
  budget,
  budgetAccount,
  category,
  categoryGroup,
  categoryTarget,
} from "@strictbudget/db/schema";
import { monthOf } from "@strictbudget/engine";
import { and, asc, eq, isNull } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import { type Db, serverToday } from "../../lib/ledger";
import { reorder, writeOrder } from "../../lib/ordering";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import {
  findCategory,
  findGroup,
  findTarget,
  insertCategory,
  insertGroup,
  listCategoryTree,
  loadCategoryJson,
  managedError,
  reassignHistory,
  toCategoryJson,
  toGroupJson,
} from "./queries";
import type {
  createCategory,
  createCategoryGroup,
  deleteCategory,
  deleteCategoryGroup,
  deleteCategoryTarget,
  listCategories,
  moveCategory,
  moveCategoryGroup,
  restoreCategoryTarget,
  setCategoryTarget,
  setSavingsSuggestion,
  snoozeCategoryTarget,
  updateCategory,
  updateCategoryGroup,
} from "./routes";

type Env = AppEnv & AuthedEnv;

export const listCategoriesHandler: RouteHandler<typeof listCategories, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  await loadBudgetAccess(c, budgetId);
  return c.json(await listCategoryTree(c.var.deps.db, budgetId), 200);
};

export const createCategoryGroupHandler: RouteHandler<typeof createCategoryGroup, Env> = async (
  c,
) => {
  const { budgetId } = c.req.valid("param");
  const { name } = c.req.valid("json");
  await loadBudgetAccess(c, budgetId, { category: ["create"] });
  const group = await insertGroup(c.var.deps.db, budgetId, name);
  return c.json(toGroupJson(group, []), 201);
};

export const updateCategoryGroupHandler: RouteHandler<typeof updateCategoryGroup, Env> = async (
  c,
) => {
  const { budgetId, groupId } = c.req.valid("param");
  const data = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { category: ["update"] });
  let group = await findGroup(db, budgetId, groupId);
  if (group.kind) throw managedError("The Credit Card Payments group can't be renamed or hidden");
  if (Object.keys(data).length > 0) {
    const [updated] = await db
      .update(categoryGroup)
      .set(data)
      .where(eq(categoryGroup.id, groupId))
      .returning();
    if (updated) group = updated;
  }
  const categories = await db
    .select()
    .from(category)
    .where(eq(category.groupId, groupId))
    .orderBy(asc(category.sortOrder), asc(category.id));
  return c.json(toGroupJson(group, categories), 200);
};

export const deleteCategoryGroupHandler: RouteHandler<typeof deleteCategoryGroup, Env> = async (
  c,
) => {
  const { budgetId, groupId } = c.req.valid("param");
  const { db } = c.var.deps;
  const { reassignToCategoryId } = c.req.valid("query");
  await loadBudgetAccess(c, budgetId, { category: ["delete"] });
  const group = await findGroup(db, budgetId, groupId);
  if (group.kind) throw managedError("The Credit Card Payments group can't be deleted");
  await db.transaction(async (tx) => {
    const members = await tx
      .select({ id: category.id })
      .from(category)
      .where(eq(category.groupId, groupId));
    await reassignHistory(
      tx,
      budgetId,
      members.map((m) => m.id),
      reassignToCategoryId,
      c.var.user.id,
    );
    await tx.delete(categoryGroup).where(eq(categoryGroup.id, groupId));
  });
  return c.body(null, 204);
};

export const moveCategoryGroupHandler: RouteHandler<typeof moveCategoryGroup, Env> = async (c) => {
  const { budgetId, groupId } = c.req.valid("param");
  const { beforeGroupId } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { category: ["update"] });
  await db.transaction(async (tx) => {
    const group = await findGroup(tx, budgetId, groupId);
    if (group.kind) throw managedError("The Credit Card Payments group always comes first");
    const groups = await tx
      .select({ id: categoryGroup.id })
      .from(categoryGroup)
      .where(
        and(
          eq(categoryGroup.budgetId, budgetId),
          eq(categoryGroup.internal, false),
          isNull(categoryGroup.kind),
        ),
      )
      .orderBy(asc(categoryGroup.sortOrder), asc(categoryGroup.id))
      .for("update");
    const order = reorder(
      groups.map((g) => g.id),
      groupId,
      beforeGroupId,
    );
    await writeOrder(tx, categoryGroup, order);
  });
  return c.json(await listCategoryTree(db, budgetId), 200);
};

export const setSavingsSuggestionHandler: RouteHandler<typeof setSavingsSuggestion, Env> = async (
  c,
) => {
  const { budgetId } = c.req.valid("param");
  const { dismissed } = c.req.valid("json");
  await loadBudgetAccess(c, budgetId, { category: ["update"] });
  await c.var.deps.db
    .update(budget)
    .set({ savingsSuggestionDismissed: dismissed })
    .where(eq(budget.id, budgetId));
  return c.json({ dismissed }, 200);
};

export const createCategoryHandler: RouteHandler<typeof createCategory, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { groupId, name, savings } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { category: ["create"] });
  const group = await findGroup(db, budgetId, groupId);
  if (group.kind) {
    throw managedError(
      "Payment categories are created automatically when you add a credit account",
    );
  }
  const created = await insertCategory(db, budgetId, groupId, name, savings);
  return c.json(toCategoryJson(created), 201);
};

export const updateCategoryHandler: RouteHandler<typeof updateCategory, Env> = async (c) => {
  const { budgetId, categoryId } = c.req.valid("param");
  const data = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { category: ["update"] });
  let row = await findCategory(db, budgetId, categoryId);
  if (row.linkedAccountId && data.name !== undefined && data.name !== row.name) {
    throw managedError(
      "A payment category is named after its account. Rename the account instead.",
    );
  }
  if (row.linkedAccountId && data.savings) {
    throw managedError("A payment category pays its card, so it can't be a savings category.");
  }
  if (data.savings && !row.savings) {
    const [loan] = await db
      .select({ id: budgetAccount.id })
      .from(budgetAccount)
      .where(eq(budgetAccount.pairedCategoryId, categoryId));
    if (loan) {
      throw managedError("This category pays a loan, so it can't be a savings category.");
    }
  }
  if (Object.keys(data).length > 0) {
    const [updated] = await db
      .update(category)
      .set(data)
      .where(eq(category.id, categoryId))
      .returning();
    if (updated) row = updated;
  }
  return c.json(await loadCategoryJson(db, budgetId, row, await findTarget(db, row.id)), 200);
};

export const deleteCategoryHandler: RouteHandler<typeof deleteCategory, Env> = async (c) => {
  const { budgetId, categoryId } = c.req.valid("param");
  const { db } = c.var.deps;
  const { reassignToCategoryId } = c.req.valid("query");
  await loadBudgetAccess(c, budgetId, { category: ["delete"] });
  const row = await findCategory(db, budgetId, categoryId);
  if (row.linkedAccountId) {
    throw managedError("Payment categories can be hidden, but not deleted");
  }
  await db.transaction(async (tx) => {
    await reassignHistory(tx, budgetId, [categoryId], reassignToCategoryId, c.var.user.id);
    await tx.delete(category).where(eq(category.id, categoryId));
  });
  return c.body(null, 204);
};

export const moveCategoryHandler: RouteHandler<typeof moveCategory, Env> = async (c) => {
  const { budgetId, categoryId } = c.req.valid("param");
  const { groupId, beforeCategoryId } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { category: ["update"] });
  await db.transaction(async (tx) => {
    const moving = await findCategory(tx, budgetId, categoryId);
    const target = await findGroup(tx, budgetId, groupId);
    if (Boolean(moving.linkedAccountId) !== (target.kind === "credit_card_payments")) {
      throw managedError("Payment categories stay in the Credit Card Payments group");
    }
    const siblings = await tx
      .select({ id: category.id })
      .from(category)
      .where(and(eq(category.groupId, groupId), isNull(category.internalKind)))
      .orderBy(asc(category.sortOrder), asc(category.id))
      .for("update");
    const targetIds = siblings.map((s) => s.id);
    if (!targetIds.includes(categoryId)) targetIds.push(categoryId);
    await tx.update(category).set({ groupId }).where(eq(category.id, categoryId));
    await writeOrder(tx, category, reorder(targetIds, categoryId, beforeCategoryId));

    if (moving.groupId !== groupId) {
      const left = await tx
        .select({ id: category.id })
        .from(category)
        .where(eq(category.groupId, moving.groupId))
        .orderBy(asc(category.sortOrder), asc(category.id));
      await writeOrder(
        tx,
        category,
        left.map((l) => l.id),
      );
    }
  });
  return c.json(await listCategoryTree(db, budgetId), 200);
};

async function pairedWithLoan(db: Db, categoryId: string) {
  const [loan] = await db
    .select({ id: budgetAccount.id })
    .from(budgetAccount)
    .where(eq(budgetAccount.pairedCategoryId, categoryId))
    .limit(1);
  return Boolean(loan);
}

/**
 * A category paired with a loan takes only a Monthly Debt Payment target, and only such categories
 * take a new one. One left on a category whose loan was unpaired or closed stays and can still be
 * edited.
 */
async function checkDebtTarget(
  db: Db,
  categoryId: string,
  cadence: string,
  existing: { cadence: string } | null | undefined,
) {
  const paired = await pairedWithLoan(db, categoryId);
  if (paired && cadence !== "debt_monthly") {
    throw managedError("A category paired with a loan takes a Monthly Debt Payment target");
  }
  if (!paired && cadence === "debt_monthly" && existing?.cadence !== "debt_monthly") {
    throw managedError("Only a category paired with a loan takes a Monthly Debt Payment target");
  }
}

export const setCategoryTargetHandler: RouteHandler<typeof setCategoryTarget, Env> = async (c) => {
  const { budgetId, categoryId } = c.req.valid("param");
  const body = c.req.valid("json");
  const { db } = c.var.deps;
  const { budget } = await loadBudgetAccess(c, budgetId, { category: ["update"] });
  const row = await findCategory(db, budgetId, categoryId);
  const paymentTarget = body.cadence === "payment_monthly" || body.cadence === "payoff_by_date";
  if (row.linkedAccountId && !paymentTarget) {
    throw managedError(
      "Payment categories take Pay Specific Amount Monthly or Pay Off Balance by Date targets",
    );
  }
  if (!row.linkedAccountId && paymentTarget) {
    throw managedError("Only credit card payment categories take payment targets");
  }
  const existing = await findTarget(db, categoryId);
  await checkDebtTarget(db, categoryId, body.cadence, existing);
  // Pay Off by Date has no amount (it pays off what the card owes) and a Monthly Debt Payment
  // follows the loan's minimum payment, so both stay in the budget's currency.
  const currency = body.currency ?? budget.currency;
  if (
    currency !== budget.currency &&
    (body.cadence === "payoff_by_date" || body.cadence === "debt_monthly")
  ) {
    throw new AppError(
      422,
      "TARGET_CURRENCY",
      "Pay Off Balance by Date and Monthly Debt Payment targets stay in the budget's currency",
    );
  }
  const start = `${body.month}-01`;
  const repeat = body.cadence === "custom" ? body.repeat : null;
  const dueDate =
    body.cadence === "yearly"
      ? body.dueDate
      : body.cadence === "payoff_by_date"
        ? `${body.dueMonth}-01`
        : body.cadence === "custom" && body.dueDate
          ? // A balance target is due by a month.
            body.behavior === "balance"
            ? `${body.dueDate.slice(0, 7)}-01`
            : body.dueDate
          : null;
  const values = {
    cadence: body.cadence,
    behavior:
      body.cadence === "payment_monthly" || body.cadence === "debt_monthly"
        ? ("set_aside" as const)
        : body.cadence === "payoff_by_date"
          ? ("balance" as const)
          : body.behavior,
    // Pay Off by Date pays off what the card owes, so it has no amount of its own.
    amount: body.cadence === "payoff_by_date" ? 0n : BigInt(body.amount),
    currency,
    dueDay:
      body.cadence === "weekly" || body.cadence === "monthly" || body.cadence === "debt_monthly"
        ? body.dueDay
        : null,
    dueDate,
    repeatEvery: repeat?.every ?? null,
    repeatUnit: repeat?.unit ?? null,
    goal: body.goal ?? null,
    goalAmount: body.goalAmount == null ? null : BigInt(body.goalAmount),
  };
  // A changed target starts in the month it's saved from; saving it unchanged only moves the
  // start back. A new due day (or weekday) alone isn't a change. A save-up goal keeps counting
  // what was put in from its start however it's edited, as long as its currency stays.
  const unchanged =
    existing &&
    ((existing.goal === "save_up" &&
      values.goal === "save_up" &&
      existing.currency === values.currency) ||
      (existing.cadence === values.cadence &&
        existing.behavior === values.behavior &&
        existing.amount === values.amount &&
        existing.currency === values.currency &&
        existing.dueDate === values.dueDate &&
        existing.repeatEvery === values.repeatEvery &&
        existing.repeatUnit === values.repeatUnit &&
        existing.goal === values.goal &&
        existing.goalAmount === values.goalAmount));
  const startMonth = unchanged && existing.startMonth < start ? existing.startMonth : start;
  // A target made weekly in the current month starts on the day it's saved (its earlier weeks
  // aren't asked for); editing a weekly target keeps its start day while its start month stays.
  const today = body.today ?? serverToday();
  const startDay =
    values.cadence !== "weekly"
      ? null
      : existing?.cadence === "weekly"
        ? existing.startMonth === startMonth
          ? existing.startDay
          : null
        : body.month === monthOf(today)
          ? Number(today.slice(8))
          : null;
  const [target] = existing
    ? await db
        .update(categoryTarget)
        .set({ ...values, startMonth, startDay })
        .where(eq(categoryTarget.id, existing.id))
        .returning()
    : await db
        .insert(categoryTarget)
        .values({ id: newId(), budgetId, categoryId, ...values, startMonth, startDay })
        .returning();
  return c.json(await loadCategoryJson(db, budgetId, row, target), 200);
};

/**
 * Undo and redo of target edits: the target goes back exactly as it was, start month and start
 * day included, or away when there was none.
 */
export const restoreCategoryTargetHandler: RouteHandler<typeof restoreCategoryTarget, Env> = async (
  c,
) => {
  const { budgetId, categoryId } = c.req.valid("param");
  const { target: snapshot } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { category: ["update"] });
  const row = await findCategory(db, budgetId, categoryId);
  if (!snapshot) {
    await db.delete(categoryTarget).where(eq(categoryTarget.categoryId, categoryId));
    return c.json(await loadCategoryJson(db, budgetId, row, null), 200);
  }
  const paymentTarget =
    snapshot.cadence === "payment_monthly" || snapshot.cadence === "payoff_by_date";
  if (Boolean(row.linkedAccountId) !== paymentTarget) {
    throw managedError("Payment categories take only payment targets, other categories none");
  }
  if (!row.linkedAccountId) {
    await checkDebtTarget(db, categoryId, snapshot.cadence, snapshot);
  }
  const values = {
    cadence: snapshot.cadence,
    behavior: snapshot.behavior,
    amount: BigInt(snapshot.amount),
    currency: snapshot.currency,
    dueDay: snapshot.dueDay,
    dueDate: snapshot.dueDate,
    repeatEvery: snapshot.repeatEvery,
    repeatUnit: snapshot.repeatUnit,
    startMonth: `${snapshot.startMonth}-01`,
    startDay: snapshot.startDay,
    snoozedMonth: snapshot.snoozedMonth && `${snapshot.snoozedMonth}-01`,
    goal: snapshot.goal,
    goalAmount: snapshot.goalAmount === null ? null : BigInt(snapshot.goalAmount),
  };
  const existing = await findTarget(db, categoryId);
  const [target] = existing
    ? await db
        .update(categoryTarget)
        .set(values)
        .where(eq(categoryTarget.id, existing.id))
        .returning()
    : await db
        .insert(categoryTarget)
        .values({ id: newId(), budgetId, categoryId, ...values })
        .returning();
  return c.json(await loadCategoryJson(db, budgetId, row, target), 200);
};

export const deleteCategoryTargetHandler: RouteHandler<typeof deleteCategoryTarget, Env> = async (
  c,
) => {
  const { budgetId, categoryId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { category: ["update"] });
  const row = await findCategory(db, budgetId, categoryId);
  await db.delete(categoryTarget).where(eq(categoryTarget.categoryId, categoryId));
  return c.json(await loadCategoryJson(db, budgetId, row, null), 200);
};

export const snoozeCategoryTargetHandler: RouteHandler<typeof snoozeCategoryTarget, Env> = async (
  c,
) => {
  const { budgetId, categoryId } = c.req.valid("param");
  const { month, snoozed, today = serverToday() } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { category: ["update"] });
  const row = await findCategory(db, budgetId, categoryId);
  const existing = await findTarget(db, categoryId);
  if (!existing) throw new AppError(404, "NOT_FOUND", "The category has no target");
  if (row.linkedAccountId) throw managedError("Credit card payment targets can't be snoozed");
  if (month !== monthOf(today)) {
    throw new AppError(
      400,
      "SNOOZE_CURRENT_MONTH",
      "Only the current month's target can be snoozed",
    );
  }
  const [target] = await db
    .update(categoryTarget)
    .set({ snoozedMonth: snoozed ? `${month}-01` : null })
    .where(eq(categoryTarget.id, existing.id))
    .returning();
  return c.json(await loadCategoryJson(db, budgetId, row, target), 200);
};
