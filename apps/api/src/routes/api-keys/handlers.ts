import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { apiKey, budgetMember } from "@strictbudget/db/schema";
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { permissionsToScope, scopeToPermissions } from "../../lib/api-keys";
import { AppError } from "../../lib/errors";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type { createApiKey, deleteApiKey, listApiKeys } from "./routes";

type Handler<R extends RouteConfig> = RouteHandler<R, AppEnv & AuthedEnv>;

type ApiKeyRow = Pick<
  typeof apiKey.$inferSelect,
  "id" | "name" | "start" | "permissions" | "createdAt" | "expiresAt" | "lastRequest"
>;

function toApiKeyJson(row: ApiKeyRow) {
  const scope = permissionsToScope(row.permissions ? JSON.parse(row.permissions) : null);
  return {
    id: row.id,
    name: row.name ?? "",
    start: row.start ?? "",
    ...scope,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastRequest?.toISOString() ?? null,
  };
}

export const listApiKeysHandler: Handler<typeof listApiKeys> = async (c) => {
  const rows = await c.var.deps.db
    .select()
    .from(apiKey)
    .where(
      and(
        eq(apiKey.referenceId, c.var.user.id),
        or(isNull(apiKey.expiresAt), gt(apiKey.expiresAt, new Date())),
      ),
    )
    .orderBy(desc(apiKey.createdAt), desc(apiKey.id));
  return c.json({ apiKeys: rows.map(toApiKeyJson) }, 200);
};

export const createApiKeyHandler: Handler<typeof createApiKey> = async (c) => {
  const { auth, db } = c.var.deps;
  const { name, access, budgetIds, expiresInDays } = c.req.valid("json");
  const userId = c.var.user.id;
  if (budgetIds) {
    const ids = [...new Set(budgetIds)];
    const member = await db
      .select({ budgetId: budgetMember.budgetId })
      .from(budgetMember)
      .where(and(eq(budgetMember.userId, userId), inArray(budgetMember.budgetId, ids)));
    if (member.length !== ids.length) {
      throw new AppError(400, "UNKNOWN_BUDGET", "Choose budgets you belong to");
    }
  }
  // A server call (no headers), so the server-only `permissions` can be set; `userId` owns it.
  const created = await auth.api.createApiKey({
    body: {
      name,
      userId,
      expiresIn: expiresInDays === null ? null : expiresInDays * 24 * 60 * 60,
      permissions: scopeToPermissions({
        access,
        budgetIds: budgetIds ? [...new Set(budgetIds)] : null,
      }),
    },
  });
  const [row] = await db.select().from(apiKey).where(eq(apiKey.id, created.id));
  if (!row) throw new Error("API key creation returned nothing");
  return c.json({ apiKey: toApiKeyJson(row), key: created.key }, 201);
};

export const deleteApiKeyHandler: Handler<typeof deleteApiKey> = async (c) => {
  const { keyId } = c.req.valid("param");
  const [deleted] = await c.var.deps.db
    .delete(apiKey)
    .where(and(eq(apiKey.id, keyId), eq(apiKey.referenceId, c.var.user.id)))
    .returning({ id: apiKey.id });
  if (!deleted) throw new AppError(404, "NOT_FOUND", "No such API key");
  return c.body(null, 204);
};
