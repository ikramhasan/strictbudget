import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { sql } from "@strictbudget/db";
import {
  budget,
  budgetEmailPreference,
  budgetMember,
  user,
  userPreference,
} from "@strictbudget/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { aiSettings } from "../../lib/ai/settings";
import { AppError } from "../../lib/errors";
import type { Db } from "../../lib/ledger";
import { unsubscribeTokenUser } from "../../lib/summary/unsubscribe";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppDeps, AppEnv } from "../../types";
import type { getNotifications, unsubscribeEmail, updateNotifications } from "./routes";

type Handler<R extends RouteConfig> = RouteHandler<R, AppEnv & AuthedEnv>;

async function notificationsOf(deps: AppDeps, userId: string) {
  const { db, env } = deps;
  const [prefs] = await db
    .select({
      monthlySummary: userPreference.monthlySummaryEmail,
      monthlySummaryAi: userPreference.monthlySummaryAi,
    })
    .from(userPreference)
    .where(eq(userPreference.userId, userId));
  const budgets = await db
    .select({
      budgetId: budget.id,
      name: budget.name,
      aiEnabled: budget.aiEnabled,
      aiAssistantButton: budget.aiAssistantButton,
      monthlySummary: sql<boolean>`coalesce(${budgetEmailPreference.monthlySummary}, true)`,
    })
    .from(budgetMember)
    .innerJoin(budget, eq(budget.id, budgetMember.budgetId))
    .leftJoin(
      budgetEmailPreference,
      and(eq(budgetEmailPreference.userId, userId), eq(budgetEmailPreference.budgetId, budget.id)),
    )
    .where(and(eq(budgetMember.userId, userId), isNull(budget.archivedAt)))
    .orderBy(asc(budget.name), asc(budget.id));
  return {
    monthlySummary: prefs?.monthlySummary ?? true,
    monthlySummaryAi: prefs?.monthlySummaryAi ?? true,
    budgets: budgets.map((b) => ({
      budgetId: b.budgetId,
      name: b.name,
      monthlySummary: b.monthlySummary,
      aiEnabled: aiSettings(env, b).enabled,
    })),
  };
}

async function savePreferences(
  db: Db,
  userId: string,
  set: { monthlySummaryEmail?: boolean; monthlySummaryAi?: boolean },
) {
  const changes = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
  if (Object.keys(changes).length === 0) return;
  await db
    .insert(userPreference)
    .values({ userId, ...changes })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: { ...changes, updatedAt: sql`now()` },
    });
}

export const getNotificationsHandler: Handler<typeof getNotifications> = async (c) =>
  c.json(await notificationsOf(c.var.deps, c.var.user.id), 200);

export const updateNotificationsHandler: Handler<typeof updateNotifications> = async (c) => {
  const { db } = c.var.deps;
  const userId = c.var.user.id;
  const input = c.req.valid("json");
  await db.transaction(async (tx) => {
    await savePreferences(tx, userId, {
      monthlySummaryEmail: input.monthlySummary,
      monthlySummaryAi: input.monthlySummaryAi,
    });
    for (const { budgetId, monthlySummary } of input.budgets ?? []) {
      const [member] = await tx
        .select({ id: budgetMember.id })
        .from(budgetMember)
        .where(and(eq(budgetMember.userId, userId), eq(budgetMember.budgetId, budgetId)));
      if (!member) throw new AppError(404, "NOT_FOUND", "Budget not found");
      await tx
        .insert(budgetEmailPreference)
        .values({ userId, budgetId, monthlySummary })
        .onConflictDoUpdate({
          target: [budgetEmailPreference.userId, budgetEmailPreference.budgetId],
          set: { monthlySummary, updatedAt: sql`now()` },
        });
    }
  });
  return c.json(await notificationsOf(c.var.deps, userId), 200);
};

export const unsubscribeEmailHandler: RouteHandler<typeof unsubscribeEmail, AppEnv> = async (c) => {
  const { db, env } = c.var.deps;
  const userId = unsubscribeTokenUser(c.req.valid("query").token, env.BETTER_AUTH_SECRET);
  if (!userId) throw new AppError(404, "INVALID_TOKEN", "This unsubscribe link isn't valid.");
  // A deleted account's link has nothing left to turn off.
  const [account] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
  if (account) await savePreferences(db, userId, { monthlySummaryEmail: false });
  return c.body(null, 204);
};
