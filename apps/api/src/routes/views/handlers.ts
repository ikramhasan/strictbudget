import type { RouteHandler } from "@hono/zod-openapi";
import { newId, sql } from "@strictbudget/db";
import {
  budget,
  budgetView,
  category,
  MAX_CUSTOM_VIEWS,
  PRESET_BUDGET_VIEWS,
} from "@strictbudget/db/schema";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import type { Db } from "../../lib/ledger";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type { createView, deleteView, listViews, reorderViews, updateView } from "./routes";

type Env = AppEnv & AuthedEnv;

/** Views are part of the plan's setup, which everyone it's shared with can change. */
const EDIT = { category: ["update"] } as const;

const PRESET_NAMES = [
  "All",
  "Overspent",
  "Underfunded",
  "Overfunded",
  "Money Available",
  "Snoozed",
];

type ViewRow = typeof budgetView.$inferSelect;

/** The budget's custom views (oldest first), with ids of deleted categories dropped. */
async function loadViews(db: Db, budgetId: string) {
  const [rows, categories] = await Promise.all([
    db
      .select()
      .from(budgetView)
      .where(eq(budgetView.budgetId, budgetId))
      .orderBy(asc(budgetView.createdAt), asc(budgetView.id)),
    db.select({ id: category.id }).from(category).where(eq(category.budgetId, budgetId)),
  ]);
  const existing = new Set(categories.map((c) => c.id));
  return rows.map((r) => toView(r, existing));
}

function toView(row: ViewRow, existing?: ReadonlySet<string>) {
  return {
    id: row.id,
    name: row.name,
    categoryIds: existing ? row.categoryIds.filter((id) => existing.has(id)) : row.categoryIds,
  };
}

/**
 * The rearrangeable views in order: the stored order's known entries, then any it lacks (presets
 * in their default order, then custom views oldest first), so a new view goes last.
 */
function effectiveOrder(stored: readonly string[] | null, viewIds: readonly string[]) {
  const all = [...PRESET_BUDGET_VIEWS, ...viewIds];
  const known = new Set(all);
  const order = [...new Set((stored ?? []).filter((key) => known.has(key)))];
  const placed = new Set(order);
  return [...order, ...all.filter((key) => !placed.has(key))];
}

async function viewList(db: Db, budgetId: string, stored: readonly string[] | null) {
  const views = await loadViews(db, budgetId);
  return {
    order: effectiveOrder(
      stored,
      views.map((v) => v.id),
    ),
    views,
  };
}

async function checkCategories(db: Db, budgetId: string, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const rows = await db
    .select({ id: category.id })
    .from(category)
    .where(
      and(
        eq(category.budgetId, budgetId),
        inArray(category.id, unique),
        isNull(category.internalKind),
      ),
    );
  if (rows.length !== unique.length) {
    throw new AppError(400, "INVALID_CATEGORY", "A category isn't one of this budget's");
  }
  return unique;
}

async function checkName(db: Db, budgetId: string, name: string, exceptId?: string) {
  const lower = name.toLowerCase();
  const taken =
    PRESET_NAMES.some((preset) => preset.toLowerCase() === lower) ||
    (
      await db
        .select({ id: budgetView.id })
        .from(budgetView)
        .where(
          and(
            eq(budgetView.budgetId, budgetId),
            sql`lower(${budgetView.name}) = ${lower}`,
            exceptId ? ne(budgetView.id, exceptId) : undefined,
          ),
        )
        .limit(1)
    ).length > 0;
  if (taken) throw new AppError(409, "VIEW_NAME_TAKEN", "This view name already exists.");
}

async function loadView(db: Db, budgetId: string, viewId: string) {
  const [row] = await db
    .select()
    .from(budgetView)
    .where(and(eq(budgetView.budgetId, budgetId), eq(budgetView.id, viewId)))
    .limit(1);
  if (!row) throw new AppError(404, "NOT_FOUND", "View not found");
  return row;
}

export const listViewsHandler: RouteHandler<typeof listViews, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { budget: b } = await loadBudgetAccess(c, budgetId);
  return c.json(await viewList(c.var.deps.db, budgetId, b.viewOrder), 200);
};

export const createViewHandler: RouteHandler<typeof createView, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { name, categoryIds } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, EDIT);
  const ids = await checkCategories(db, budgetId, categoryIds);
  const row = await db.transaction(async (tx) => {
    // Lock the budget row so two creates can't both pass the limit.
    const [locked] = await tx
      .select({ viewOrder: budget.viewOrder })
      .from(budget)
      .where(eq(budget.id, budgetId))
      .for("update");
    const existing = await tx
      .select({ id: budgetView.id })
      .from(budgetView)
      .where(eq(budgetView.budgetId, budgetId))
      .orderBy(asc(budgetView.createdAt), asc(budgetView.id));
    if (existing.length >= MAX_CUSTOM_VIEWS) {
      throw new AppError(
        409,
        "VIEW_LIMIT",
        "You have reached the maximum number of custom views available.",
      );
    }
    await checkName(tx, budgetId, name);
    const [created] = await tx
      .insert(budgetView)
      .values({ id: newId(), budgetId, name, categoryIds: ids })
      .returning();
    if (!created) throw new Error("insert returned nothing");
    if (locked?.viewOrder) {
      await tx
        .update(budget)
        .set({
          viewOrder: [
            ...effectiveOrder(
              locked.viewOrder,
              existing.map((v) => v.id),
            ),
            created.id,
          ],
        })
        .where(eq(budget.id, budgetId));
    }
    return created;
  });
  return c.json(toView(row), 201);
};

export const updateViewHandler: RouteHandler<typeof updateView, Env> = async (c) => {
  const { budgetId, viewId } = c.req.valid("param");
  const body = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, EDIT);
  const row = await loadView(db, budgetId, viewId);
  const ids =
    body.categoryIds === undefined
      ? undefined
      : await checkCategories(db, budgetId, body.categoryIds);
  if (body.name !== undefined && body.name !== row.name) {
    await checkName(db, budgetId, body.name, viewId);
  }
  const [updated] = await db
    .update(budgetView)
    .set({ name: body.name ?? row.name, categoryIds: ids ?? row.categoryIds })
    .where(eq(budgetView.id, viewId))
    .returning();
  if (!updated) throw new AppError(404, "NOT_FOUND", "View not found");
  const existing = await db
    .select({ id: category.id })
    .from(category)
    .where(eq(category.budgetId, budgetId));
  return c.json(toView(updated, new Set(existing.map((r) => r.id))), 200);
};

export const deleteViewHandler: RouteHandler<typeof deleteView, Env> = async (c) => {
  const { budgetId, viewId } = c.req.valid("param");
  const { db } = c.var.deps;
  const { budget: b } = await loadBudgetAccess(c, budgetId, EDIT);
  await loadView(db, budgetId, viewId);
  await db.transaction(async (tx) => {
    await tx.delete(budgetView).where(eq(budgetView.id, viewId));
    if (b.viewOrder?.includes(viewId)) {
      await tx
        .update(budget)
        .set({ viewOrder: sql`array_remove(${budget.viewOrder}, ${viewId})` })
        .where(eq(budget.id, budgetId));
    }
  });
  return c.body(null, 204);
};

export const reorderViewsHandler: RouteHandler<typeof reorderViews, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { order } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, EDIT);
  const views = await loadViews(db, budgetId);
  const expected = new Set<string>([...PRESET_BUDGET_VIEWS, ...views.map((v) => v.id)]);
  if (order.length !== expected.size || new Set(order).size !== order.length) {
    throw new AppError(400, "INVALID_ORDER", "The order must list every view once");
  }
  if (order.some((key) => !expected.has(key))) {
    throw new AppError(400, "INVALID_ORDER", "The order must list every view once");
  }
  await db.update(budget).set({ viewOrder: order }).where(eq(budget.id, budgetId));
  return c.json({ order, views }, 200);
};
