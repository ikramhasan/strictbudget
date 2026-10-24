import { z } from "@hono/zod-openapi";
import {
  budgetFormerMember,
  budgetMember,
  CONNECTED_AGENT_KINDS,
  connectedAgent,
  user,
  userAvatar,
} from "@strictbudget/db/schema";
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { Db, Tx } from "./ledger";

/**
 * The six member avatar colours, 1-based (avatar-one … avatar-six). A budget has at most six
 * people, so the owner gets 1 and the others 2–6 by when they joined.
 */
export const zAvatarColor = z
  .number()
  .int()
  .min(1)
  .max(6)
  .describe("Member avatar colour, 1–6: the owner is 1, the others 2–6 in the order they joined");

/** A user's profile picture URL, shown as a circle; null without one. */
export const zPicture = z
  .string()
  .nullable()
  .describe("Their profile picture's URL (an API path); null without one");

/**
 * A user's profile picture URL, built from their `user_avatar` row (`/v1/users/{id}/picture?v=`,
 * as `profilePictureUrl` writes it). Never `user.image`: Better Auth's own endpoints accept any
 * string there, and other members' browsers would load it.
 */
export function pictureUrlSql(userId: SQL | typeof user.id): SQL<string | null> {
  return sql<
    string | null
  >`(select '/v1/users/' || ${userAvatar.userId} || '/picture?v=' || ${userAvatar.id}
    from ${userAvatar} where ${userAvatar.userId} = ${userId})`;
}

/** An agent (MCP client or Agent Auth agent) that made a change for a member. */
export const zAgentRef = z
  .object({
    id: z.string(),
    name: z.string().describe("As the client or agent named itself, e.g. 'Claude Code'"),
    kind: z.enum(CONNECTED_AGENT_KINDS),
  })
  .openapi("AgentRef");

/** Someone who made a change: an audit event's actor, who entered or changed a transaction. */
export const zMemberRef = z
  .object({
    userId: z.string(),
    name: z.string().nullable().describe("Null once their user is deleted"),
    avatarColor: zAvatarColor
      .nullable()
      .describe("Their colour, kept after they leave; null if their user is deleted"),
    removed: z.boolean().describe("True once they've left the budget"),
    picture: zPicture,
    agent: zAgentRef
      .nullable()
      .describe("The agent that made it on the member's behalf; null when they did it themself"),
  })
  .openapi("MemberRef");

const ids = (values: Iterable<string | null>) => [
  ...new Set([...values].filter((id): id is string => Boolean(id))),
];

/** Agents by `connected_agent` id, for `zAgentRef`s. */
export async function agentRefs(db: Db, agentIds: Iterable<string | null>) {
  const wanted = ids(agentIds);
  const rows = wanted.length
    ? await db
        .select({ id: connectedAgent.id, name: connectedAgent.name, kind: connectedAgent.kind })
        .from(connectedAgent)
        .where(inArray(connectedAgent.id, wanted))
    : [];
  return new Map(rows.map((r) => [r.id, r]));
}

/** Each user id's name and avatar colour on the budget (and the agent, if one acted), for `zMemberRef`s. */
export async function memberRefs(
  db: Db,
  budgetId: string,
  userIds: Iterable<string | null>,
  agentIds: Iterable<string | null> = [],
) {
  const userIdList = ids(userIds);
  const colors = await memberAvatarColors(db, budgetId);
  const names = userIdList.length
    ? await db
        .select({ id: user.id, name: user.name, picture: pictureUrlSql(user.id) })
        .from(user)
        .where(inArray(user.id, userIdList))
    : [];
  const agents = await agentRefs(db, agentIds);
  const byId = new Map(names.map((n) => [n.id, n]));
  return (userId: string | null, agentId: string | null = null) =>
    userId
      ? {
          userId,
          name: byId.get(userId)?.name ?? null,
          avatarColor: colors.get(userId)?.color ?? null,
          removed: colors.get(userId)?.removed ?? true,
          picture: byId.get(userId)?.picture ?? null,
          agent: (agentId && agents.get(agentId)) || null,
        }
      : null;
}

/** Current members in the order that decides their colour: the owner, then by when they joined. */
async function currentMembers(db: Db | Tx, budgetId: string) {
  return db
    .select({ userId: budgetMember.userId })
    .from(budgetMember)
    .where(eq(budgetMember.budgetId, budgetId))
    .orderBy(sql`${budgetMember.role} <> 'owner'`, asc(budgetMember.createdAt));
}

/**
 * Each member's avatar colour, by user id: current members' from their order, and former members'
 * as kept when they left (`removed`), so a removed member's past moves keep their own colour.
 */
export async function memberAvatarColors(
  db: Db,
  budgetId: string,
): Promise<Map<string, { color: number; removed: boolean }>> {
  const members = await currentMembers(db, budgetId);
  const former = await db
    .select({ userId: budgetFormerMember.userId, color: budgetFormerMember.avatarColor })
    .from(budgetFormerMember)
    .where(eq(budgetFormerMember.budgetId, budgetId));
  const colors = new Map<string, { color: number; removed: boolean }>(
    former.map((f) => [f.userId, { color: f.color, removed: true }]),
  );
  members.forEach((m, i) => {
    colors.set(m.userId, { color: Math.min(i + 1, 6), removed: false });
  });
  return colors;
}

/** Keeps a member's current colour as they leave; call before deleting their `budget_member` row. */
export async function keepFormerMemberColor(tx: Tx, budgetId: string, userId: string) {
  const members = await currentMembers(tx, budgetId);
  const i = members.findIndex((m) => m.userId === userId);
  if (i < 0) return;
  const avatarColor = Math.min(i + 1, 6);
  await tx
    .insert(budgetFormerMember)
    .values({ budgetId, userId, avatarColor })
    .onConflictDoUpdate({
      target: [budgetFormerMember.budgetId, budgetFormerMember.userId],
      set: { avatarColor, removedAt: new Date() },
    });
}

/** Forgets a kept colour when the member rejoins; they get a fresh one from their new place. */
export async function forgetFormerMemberColor(tx: Tx, budgetId: string, userId: string) {
  await tx
    .delete(budgetFormerMember)
    .where(and(eq(budgetFormerMember.budgetId, budgetId), eq(budgetFormerMember.userId, userId)));
}
