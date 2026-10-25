import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { sql } from "@strictbudget/db";
import { auditEvent, transaction, user } from "@strictbudget/db/schema";
import { and, desc, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import type { Db } from "../../lib/ledger";
import { agentRefs, memberAvatarColors, pictureUrlSql } from "../../lib/member-colors";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type { listActivity, transactionHistory } from "./routes";

type Handler<R extends RouteConfig> = RouteHandler<R, AppEnv & AuthedEnv>;

/** A logged row as text values: money stays exact (bigint minor units as strings). */
const asText = (column: typeof auditEvent.before | typeof auditEvent.after) =>
  sql<Record<
    string,
    string | null
  > | null>`(select jsonb_object_agg(key, value) from jsonb_each_text(${column}))`;

/** Events matching `where`, with their actors, in the API's shape. */
async function events(
  db: Db,
  budgetId: string,
  where: SQL | undefined,
  order: "asc" | "desc",
  limit?: number,
) {
  const query = db
    .select({
      id: auditEvent.id,
      at: auditEvent.createdAt,
      // Microseconds kept, for the cursor.
      atText: sql<string>`${auditEvent.createdAt}::text`,
      actorUserId: auditEvent.actorUserId,
      actorAgentId: auditEvent.actorAgentId,
      actorName: user.name,
      actorPicture: pictureUrlSql(user.id),
      source: auditEvent.source,
      entity: auditEvent.tableName,
      rowId: auditEvent.rowId,
      op: auditEvent.op,
      before: asText(auditEvent.before),
      after: asText(auditEvent.after),
    })
    .from(auditEvent)
    .leftJoin(user, eq(user.id, auditEvent.actorUserId))
    .where(and(eq(auditEvent.budgetId, budgetId), where))
    .orderBy(
      order === "desc" ? desc(auditEvent.createdAt) : auditEvent.createdAt,
      order === "desc" ? desc(auditEvent.id) : auditEvent.id,
    );
  const rows = await (limit ? query.limit(limit) : query);
  const colors = await memberAvatarColors(db, budgetId);
  const agents = await agentRefs(
    db,
    rows.map((r) => r.actorAgentId),
  );
  return rows.map((r) => ({
    atText: r.atText,
    event: {
      id: r.id,
      at: r.at.toISOString(),
      actor: r.actorUserId
        ? {
            userId: r.actorUserId,
            name: r.actorName,
            avatarColor: colors.get(r.actorUserId)?.color ?? null,
            removed: colors.get(r.actorUserId)?.removed ?? true,
            picture: r.actorPicture,
            agent: (r.actorAgentId && agents.get(r.actorAgentId)) || null,
          }
        : null,
      source: r.source,
      entity: r.entity,
      rowId: r.rowId,
      op: r.op,
      before: r.before,
      after: r.after,
    },
  }));
}

const encodeCursor = (at: string, id: string) => Buffer.from(`${at}|${id}`).toString("base64url");
function decodeCursor(cursor: string): { at: string; id: string } {
  const [at, id, ...rest] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!at || !id || rest.length > 0 || Number.isNaN(Date.parse(at))) {
    throw new AppError(400, "INVALID_CURSOR", "That cursor isn't from this list");
  }
  return { at, id };
}

export const listActivityHandler: Handler<typeof listActivity> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { member, entity, cursor, limit } = c.req.valid("query");
  const { db } = c.var.deps;
  const { role } = await loadBudgetAccess(c, budgetId);
  const after = cursor ? decodeCursor(cursor) : null;
  const entities = entity?.split(",").filter(Boolean);
  const rows = await events(
    db,
    budgetId,
    and(
      member === "none"
        ? isNull(auditEvent.actorUserId)
        : member
          ? eq(auditEvent.actorUserId, member)
          : undefined,
      entities?.length ? inArray(auditEvent.tableName, entities) : undefined,
      // Pending invitations (who, which address) are the owner's, as on the members list.
      role === "owner" ? undefined : ne(auditEvent.tableName, "budget_invitation"),
      after
        ? sql`(${auditEvent.createdAt}, ${auditEvent.id}) < (${after.at}::timestamptz, ${after.id})`
        : undefined,
    ),
    "desc",
    limit + 1,
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return c.json(
    {
      events: page.map((r) => r.event),
      nextCursor: rows.length > limit && last ? encodeCursor(last.atText, last.event.id) : null,
    },
    200,
  );
};

export const transactionHistoryHandler: Handler<typeof transactionHistory> = async (c) => {
  const { budgetId, transactionId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  // A transfer's attachment is shared by its two sides, so either side's history shows it.
  const [pair] = await db
    .select({ id: transaction.transferTransactionId })
    .from(transaction)
    .where(and(eq(transaction.id, transactionId), eq(transaction.budgetId, budgetId)));
  const attachmentOwners = pair?.id ? [transactionId, pair.id] : [transactionId];
  const rows = await events(
    db,
    budgetId,
    sql`((${auditEvent.tableName} = 'transaction' and ${auditEvent.rowId} = ${transactionId})
      or (${auditEvent.tableName} = 'sub_transaction'
        and coalesce(${auditEvent.after}, ${auditEvent.before})->>'transaction_id' = ${transactionId})
      or (${auditEvent.tableName} = 'transaction_attachment'
        and coalesce(${auditEvent.after}, ${auditEvent.before})->>'transaction_id'
          in (${sql.join(
            attachmentOwners.map((id) => sql`${id}`),
            sql`, `,
          )})))`,
    "asc",
  );
  return c.json({ events: rows.map((r) => r.event) }, 200);
};
