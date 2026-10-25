import type { RouteHandler } from "@hono/zod-openapi";
import { newId, sql } from "@strictbudget/db";
import { fxRateOverride } from "@strictbudget/db/schema";
import { normalizeRate } from "@strictbudget/engine";
import { and, asc, desc, eq } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import { resolveRate } from "../../lib/fx";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type {
  deleteFxRateOverride,
  getFxRate,
  listFxRateOverrides,
  putFxRateOverride,
} from "./routes";

type Env = AppEnv & AuthedEnv;
type OverrideRow = typeof fxRateOverride.$inferSelect;

function overrideJson(row: OverrideRow) {
  return {
    id: row.id,
    date: row.date,
    currency: row.currency,
    rate: normalizeRate(row.rate),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const getFxRateHandler: RouteHandler<typeof getFxRate, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { from, to, date, today } = c.req.valid("query");
  const { budget } = await loadBudgetAccess(c, budgetId);
  const target = to ?? budget.currency;
  const resolved = await resolveRate(c.var.deps.db, c.var.deps, {
    budgetId,
    from,
    to: target,
    date,
    today,
  });
  return c.json({ from, to: target, ...resolved }, 200);
};

export const listFxRateOverridesHandler: RouteHandler<typeof listFxRateOverrides, Env> = async (
  c,
) => {
  const { budgetId } = c.req.valid("param");
  await loadBudgetAccess(c, budgetId);
  const rows = await c.var.deps.db
    .select()
    .from(fxRateOverride)
    .where(eq(fxRateOverride.budgetId, budgetId))
    .orderBy(desc(fxRateOverride.date), asc(fxRateOverride.currency));
  return c.json({ overrides: rows.map(overrideJson) }, 200);
};

export const putFxRateOverrideHandler: RouteHandler<typeof putFxRateOverride, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { date, currency, rate } = c.req.valid("json");
  // Exchange rates are a budget setting, so they take the permission the settings page does.
  const { budget } = await loadBudgetAccess(c, budgetId, { organization: ["update"] });
  if (currency === budget.currency) {
    throw new AppError(400, "SAME_CURRENCY", "The budget's own currency always has a rate of 1");
  }
  const value = normalizeRate(rate);
  const [row] = await c.var.deps.db
    .insert(fxRateOverride)
    .values({ id: newId(), budgetId, date, currency, rate: value })
    .onConflictDoUpdate({
      target: [fxRateOverride.budgetId, fxRateOverride.date, fxRateOverride.currency],
      set: { rate: value, updatedAt: sql`now()` },
    })
    .returning();
  if (!row) throw new Error("override upsert returned no row");
  return c.json(overrideJson(row), 200);
};

export const deleteFxRateOverrideHandler: RouteHandler<typeof deleteFxRateOverride, Env> = async (
  c,
) => {
  const { budgetId, overrideId } = c.req.valid("param");
  await loadBudgetAccess(c, budgetId, { organization: ["update"] });
  const deleted = await c.var.deps.db
    .delete(fxRateOverride)
    .where(and(eq(fxRateOverride.budgetId, budgetId), eq(fxRateOverride.id, overrideId)))
    .returning({ id: fxRateOverride.id });
  if (deleted.length === 0) throw new AppError(404, "NOT_FOUND", "Exchange rate not found");
  return c.body(null, 204);
};
