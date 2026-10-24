import { type Database, newId } from "@strictbudget/db";
import { type ConnectedAgentKind, connectedAgent, user } from "@strictbudget/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import type { AuthUser } from "../auth";

/** An agent acting for a user, as `requireAuth` sees it (`c.var.agent`). */
export interface AgentActor {
  /** The `connected_agent` id: what changes are attributed to. */
  id: string;
  kind: ConnectedAgentKind;
  name: string;
}

/**
 * Who an in-process agent request is from, handed to the app as the request's environment
 * (`app.fetch(request, { [AGENT_PRINCIPAL]: … })`) once the MCP endpoint or Agent Auth has
 * verified the agent. Only server code can set the environment, so a request from outside can
 * never claim to be an agent.
 */
export interface AgentPrincipal {
  user: AuthUser;
  agent: AgentActor;
  /** False for read-only access: only operations that change nothing are run. */
  canWrite: boolean;
}

export const AGENT_PRINCIPAL = Symbol("strictbudget.agentPrincipal");

export function principalFromEnv(env: unknown): AgentPrincipal | null {
  if (!env || typeof env !== "object") return null;
  return (env as { [AGENT_PRINCIPAL]?: AgentPrincipal })[AGENT_PRINCIPAL] ?? null;
}

/** `lastUsedAt` is written at most this often, not on every call. */
const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * The user's `connected_agent` row for an MCP client or Agent Auth agent, created on its first
 * request and renamed when its name changes. Null when the user disconnected it after
 * `authorizedAt` (an MCP access token is a signed JWT that stays valid until it expires, so one
 * issued before the disconnect is refused here); a later authorization connects it again.
 */
export async function connectAgent(
  db: Database,
  input: {
    userId: string;
    kind: ConnectedAgentKind;
    externalId: string;
    name: string;
    authorizedAt: Date;
  },
): Promise<AgentActor | null> {
  const name = input.name.trim().slice(0, 200) || "Agent";
  const [row] = await db
    .insert(connectedAgent)
    .values({
      id: newId(),
      userId: input.userId,
      kind: input.kind,
      externalId: input.externalId,
      name,
    })
    .onConflictDoUpdate({
      target: [connectedAgent.userId, connectedAgent.kind, connectedAgent.externalId],
      set: {
        // Reconnected by an authorization made after the disconnect.
        revokedAt: sql`case when ${connectedAgent.revokedAt} < ${input.authorizedAt.toISOString()}::timestamptz then null else ${connectedAgent.revokedAt} end`,
        name,
        lastUsedAt: sql`case when ${connectedAgent.lastUsedAt} < now() - ${`${LAST_USED_RESOLUTION_MS} milliseconds`}::interval then now() else ${connectedAgent.lastUsedAt} end`,
      },
    })
    .returning({
      id: connectedAgent.id,
      kind: connectedAgent.kind,
      name: connectedAgent.name,
      revokedAt: connectedAgent.revokedAt,
    });
  if (!row || row.revokedAt) return null;
  return { id: row.id, kind: row.kind, name: row.name };
}

/** The user an agent acts for, as Better Auth's session user; null if gone or unconfirmed. */
export async function agentUser(db: Database, userId: string): Promise<AuthUser | null> {
  const [row] = await db.select().from(user).where(eq(user.id, userId));
  if (!row?.emailVerified) return null;
  return row as AuthUser;
}

/** Marks the user's agent disconnected (its tokens or grants are revoked by the caller). */
export async function markDisconnected(db: Database, userId: string, id: string) {
  const [row] = await db
    .update(connectedAgent)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(connectedAgent.id, id),
        eq(connectedAgent.userId, userId),
        // The in-app assistant isn't connected, so there's nothing to disconnect.
        ne(connectedAgent.kind, "in_app"),
      ),
    )
    .returning({ kind: connectedAgent.kind, externalId: connectedAgent.externalId });
  return row ?? null;
}
