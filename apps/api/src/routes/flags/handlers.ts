import type { RouteHandler } from "@hono/zod-openapi";
import { newId, sql } from "@strictbudget/db";
import { FLAG_COLORS, flagName } from "@strictbudget/db/schema";
import { and, eq } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type { listFlags, renameFlag } from "./routes";

type Env = AppEnv & AuthedEnv;

export const listFlagsHandler: RouteHandler<typeof listFlags, Env> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  const rows = await db.select().from(flagName).where(eq(flagName.budgetId, budgetId));
  const names = new Map(rows.map((r) => [r.color, r.name]));
  return c.json(
    { flags: FLAG_COLORS.map((color) => ({ color, name: names.get(color) ?? "" })) },
    200,
  );
};

export const renameFlagHandler: RouteHandler<typeof renameFlag, Env> = async (c) => {
  const { budgetId, color } = c.req.valid("param");
  const { name } = c.req.valid("json");
  const { db } = c.var.deps;
  // Naming flags is part of editing transactions, so it takes the same permission.
  await loadBudgetAccess(c, budgetId, { transaction: ["update"] });
  if (name === "") {
    await db
      .delete(flagName)
      .where(and(eq(flagName.budgetId, budgetId), eq(flagName.color, color)));
  } else {
    await db
      .insert(flagName)
      .values({ id: newId(), budgetId, color, name })
      .onConflictDoUpdate({
        target: [flagName.budgetId, flagName.color],
        set: { name, updatedAt: sql`now()` },
      });
  }
  return c.json({ color, name }, 200);
};
