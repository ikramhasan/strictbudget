import type { RouteHandler } from "@hono/zod-openapi";
import { newId, sql } from "@strictbudget/db";
import { budget, budgetMember, userPreference } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { keyAllowsBudget } from "../../lib/api-keys";
import { setAuditContext } from "../../lib/audit-context";
import { type BudgetAccess, loadBudgetAccess, rememberLastBudget } from "../../lib/budget-access";
import { ARCHIVED_STAMP, copyIntoFreshStart } from "../../lib/fresh-start";
import { createOrganizationAs, deleteOrganizationAs } from "../../lib/organization-calls";
import { seedStarterCategories } from "../../lib/starter-categories";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type {
  createBudget,
  deleteBudget,
  freshStartBudget,
  getBudget,
  listBudgets,
  updateBudget,
} from "./routes";

type Env = AppEnv & AuthedEnv;

export function toBudgetJson({ budget: b, role, lastUsedAt }: BudgetAccess) {
  return {
    id: b.id,
    name: b.name,
    currency: b.currency,
    numberFormat: b.numberFormat,
    currencySymbolPosition: b.currencySymbolPosition,
    dateFormat: b.dateFormat,
    role,
    archivedAt: b.archivedAt?.toISOString() ?? null,
    lastUsedAt: lastUsedAt?.toISOString() ?? null,
    savingsRateGoal: b.savingsRateGoal,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export const listBudgetsHandler: RouteHandler<typeof listBudgets, Env> = async (c) => {
  const { db } = c.var.deps;
  const userId = c.var.user.id;
  const allRows = await db
    .select({ budget, role: budgetMember.role, lastUsedAt: budgetMember.lastUsedAt })
    .from(budgetMember)
    .innerJoin(budget, eq(budget.id, budgetMember.budgetId))
    .where(eq(budgetMember.userId, userId))
    .orderBy(
      sql`${budgetMember.lastUsedAt} desc nulls last`,
      sql`lower(${budget.name})`,
      budget.id,
    );
  const rows = allRows.filter((r) => keyAllowsBudget(c.var.apiKey, r.budget.id));
  const [pref] = await db
    .select({ lastBudgetId: userPreference.lastBudgetId })
    .from(userPreference)
    .where(eq(userPreference.userId, userId));
  const lastUsed = pref?.lastBudgetId;
  return c.json(
    {
      budgets: rows.map(toBudgetJson),
      lastUsedBudgetId: rows.some((r) => r.budget.id === lastUsed) ? (lastUsed ?? null) : null,
    },
    200,
  );
};

export const createBudgetHandler: RouteHandler<typeof createBudget, Env> = async (c) => {
  const { db } = c.var.deps;
  const body = c.req.valid("json");
  const created = await createOrganizationAs(c, {
    ...body,
    slug: newId(),
    keepCurrentActiveOrganization: true,
  });
  if (!created) throw new Error("Budget creation returned nothing");
  // The plugin wrote the budget on its own connection; the starter categories are the user's.
  await db.transaction(async (tx) => {
    await setAuditContext(tx, {
      actorId: c.var.user.id,
      agentId: c.var.agent?.id ?? null,
      requestId: c.var.requestId,
    });
    await seedStarterCategories(tx, created.id);
  });
  await rememberLastBudget(db, c.var.user.id, created.id);
  return c.json(toBudgetJson(await loadBudgetAccess(c, created.id)), 201);
};

export const getBudgetHandler: RouteHandler<typeof getBudget, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const access = await loadBudgetAccess(c, budgetId);
  // Opening a budget in the app makes it the one to come back to; a script's read doesn't.
  const lastUsedAt = c.var.apiKey
    ? access.lastUsedAt
    : await rememberLastBudget(c.var.deps.db, c.var.user.id, budgetId);
  return c.json(toBudgetJson({ ...access, lastUsedAt }), 200);
};

export const updateBudgetHandler: RouteHandler<typeof updateBudget, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const data = c.req.valid("json");
  const { budget: current } = await loadBudgetAccess(c, budgetId, { organization: ["update"] });
  // Straight to the row rather than the plugin's updateOrganization (which only sets these
  // columns, on its own connection), so the change is in this request's transaction and log.
  if (Object.keys(data).length > 0) {
    await c.var.deps.db.update(budget).set(data).where(eq(budget.id, budgetId));
  }
  // Archiving is only the name's stamp: renaming it away restores the budget.
  if (current.archivedAt && data.name !== undefined && !data.name.includes(ARCHIVED_STAMP)) {
    await c.var.deps.db.update(budget).set({ archivedAt: null }).where(eq(budget.id, budgetId));
  }
  return c.json(toBudgetJson(await loadBudgetAccess(c, budgetId)), 200);
};

export const deleteBudgetHandler: RouteHandler<typeof deleteBudget, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  await loadBudgetAccess(c, budgetId, { organization: ["delete"] });
  await deleteOrganizationAs(c, budgetId);
  return c.body(null, 204);
};

export const freshStartBudgetHandler: RouteHandler<typeof freshStartBudget, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { date, name } = c.req.valid("json");
  const { db } = c.var.deps;
  const { budget: old } = await loadBudgetAccess(c, budgetId, { budget: ["fresh_start"] });

  const created = await createOrganizationAs(c, {
    name,
    currency: old.currency,
    numberFormat: old.numberFormat,
    currencySymbolPosition: old.currencySymbolPosition,
    dateFormat: old.dateFormat,
    slug: newId(),
    keepCurrentActiveOrganization: true,
  });
  if (!created) throw new Error("Budget creation returned nothing");

  try {
    await db.transaction(async (tx) => {
      await setAuditContext(tx, {
        actorId: c.var.user.id,
        agentId: c.var.agent?.id ?? null,
        requestId: c.var.requestId,
      });
      await copyIntoFreshStart(tx, { old, newBudgetId: created.id, ownerId: c.var.user.id, date });
    });
  } catch (error) {
    // The plugin created the budget outside our transaction; don't leave a half-copied one.
    await db.delete(budget).where(eq(budget.id, created.id));
    throw error;
  }
  await rememberLastBudget(db, c.var.user.id, created.id);
  return c.json(toBudgetJson(await loadBudgetAccess(c, created.id)), 201);
};
