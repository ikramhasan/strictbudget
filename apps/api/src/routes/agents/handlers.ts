import { createHash } from "node:crypto";
import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import {
  agent,
  agentCapabilityGrant,
  agentHost,
  approvalRequest,
  connectedAgent,
  oauthAccessToken,
  oauthConsent,
  oauthRefreshToken,
} from "@strictbudget/db/schema";
import { and, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import type { Context } from "hono";
import { markDisconnected } from "../../lib/agents/principal";
import { AppError } from "../../lib/errors";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type { getAgentApproval, listConnectedAgents, revokeConnectedAgent } from "./routes";

type Env = AppEnv & AuthedEnv;
type Handler<R extends RouteConfig> = RouteHandler<R, Env>;

/** Managing agents is the person's own business: an agent can't connect or disconnect agents. */
function refuseAgents(c: Context<Env>) {
  if (c.var.agent) {
    throw new AppError(403, "NOT_FOR_AGENTS", "Only you can manage the agents acting for you");
  }
}

export const listConnectedAgentsHandler: Handler<typeof listConnectedAgents> = async (c) => {
  refuseAgents(c);
  const { db } = c.var.deps;
  const userId = c.var.user.id;
  const rows = await db
    .select()
    .from(connectedAgent)
    .where(
      and(
        eq(connectedAgent.userId, userId),
        isNull(connectedAgent.revokedAt),
        // The in-app assistant acts through the signed-in session, not a connection.
        ne(connectedAgent.kind, "in_app"),
      ),
    )
    .orderBy(desc(connectedAgent.createdAt));
  const mcpIds = rows.filter((r) => r.kind === "mcp").map((r) => r.externalId);
  const agentIds = rows.filter((r) => r.kind === "agent_auth").map((r) => r.externalId);
  const consents = mcpIds.length
    ? await db
        .select({ clientId: oauthConsent.clientId, scopes: oauthConsent.scopes })
        .from(oauthConsent)
        .where(and(eq(oauthConsent.userId, userId), inArray(oauthConsent.clientId, mcpIds)))
    : [];
  const grants = agentIds.length
    ? await db
        .select({
          agentId: agentCapabilityGrant.agentId,
          capability: agentCapabilityGrant.capability,
        })
        .from(agentCapabilityGrant)
        .where(
          and(
            inArray(agentCapabilityGrant.agentId, agentIds),
            eq(agentCapabilityGrant.status, "active"),
          ),
        )
    : [];
  const operations = c.var.deps.auth.agentRuntime.operations();
  return c.json(
    {
      agents: rows.map((r) => {
        const permissions =
          r.kind === "mcp"
            ? consents
                .filter((x) => x.clientId === r.externalId)
                .flatMap((x) => x.scopes)
                .filter((s) => s.startsWith("strictbudget:"))
            : grants.filter((g) => g.agentId === r.externalId).map((g) => g.capability);
        const writes =
          r.kind === "mcp"
            ? permissions.includes("strictbudget:write")
            : permissions.some((p) => operations.get(p)?.readOnly === false);
        return {
          id: r.id,
          kind: r.kind,
          name: r.name,
          access: writes ? ("write" as const) : ("read" as const),
          permissions: [...new Set(permissions)].sort(),
          connectedAt: r.createdAt.toISOString(),
          lastUsedAt: r.lastUsedAt.toISOString(),
        };
      }),
    },
    200,
  );
};

export const revokeConnectedAgentHandler: Handler<typeof revokeConnectedAgent> = async (c) => {
  refuseAgents(c);
  const { agentId } = c.req.valid("param");
  const { db, auth } = c.var.deps;
  const userId = c.var.user.id;
  const row = await markDisconnected(db, userId, agentId);
  if (!row) throw new AppError(404, "NOT_FOUND", "No such agent of yours");
  if (row.kind === "mcp") {
    // Its refresh tokens can't mint new access tokens; access tokens already out are refused by
    // the /mcp endpoint (`connected_agent.revokedAt`), and consent is asked again next time.
    const mine = (table: typeof oauthAccessToken | typeof oauthRefreshToken) =>
      and(eq(table.userId, userId), eq(table.clientId, row.externalId));
    await db.delete(oauthAccessToken).where(mine(oauthAccessToken));
    await db.delete(oauthRefreshToken).where(mine(oauthRefreshToken));
    await db
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, row.externalId)));
  } else {
    // The plugin revokes the agent and all its grants (owner-checked against the session).
    const [found] = await db
      .select({ status: agent.status })
      .from(agent)
      .where(and(eq(agent.id, row.externalId), eq(agent.userId, userId)));
    if (found && found.status !== "revoked") {
      await auth.api.revokeAgent({
        body: { agent_id: row.externalId },
        headers: c.req.raw.headers,
      });
    }
  }
  return c.body(null, 204);
};

/**
 * Agent Auth stores a device code as the base64url SHA-256 of its normalized form
 * (`XXXX-XXXX`, upper case); this matches it the same way.
 */
function userCodeHash(code: string): string {
  const stripped = code.replaceAll(/[^A-Z0-9]/gi, "").toUpperCase();
  const normalized =
    stripped.length === 8 ? `${stripped.slice(0, 4)}-${stripped.slice(4)}` : code.toUpperCase();
  return createHash("sha256").update(normalized).digest("base64url");
}

export const getAgentApprovalHandler: Handler<typeof getAgentApproval> = async (c) => {
  refuseAgents(c);
  const { agentId } = c.req.valid("param");
  const { code } = c.req.valid("query");
  const { db } = c.var.deps;
  const [request] = await db
    .select({ expiresAt: approvalRequest.expiresAt })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.agentId, agentId),
        eq(approvalRequest.method, "device_authorization"),
        eq(approvalRequest.status, "pending"),
        eq(approvalRequest.userCodeHash, userCodeHash(code)),
        gt(approvalRequest.expiresAt, new Date()),
      ),
    );
  if (!request) {
    throw new AppError(
      404,
      "NOT_FOUND",
      "That request has expired, was answered, or the code is wrong",
    );
  }
  const [found] = await db
    .select({ name: agent.name, userId: agent.userId, hostName: agentHost.name })
    .from(agent)
    .leftJoin(agentHost, eq(agentHost.id, agent.hostId))
    .where(eq(agent.id, agentId));
  // Someone else's agent asking for more: only its owner can approve.
  if (!found || (found.userId && found.userId !== c.var.user.id)) {
    throw new AppError(
      404,
      "NOT_FOUND",
      "That request has expired, was answered, or the code is wrong",
    );
  }
  const pending = await db
    .select({ capability: agentCapabilityGrant.capability, reason: agentCapabilityGrant.reason })
    .from(agentCapabilityGrant)
    .where(
      and(eq(agentCapabilityGrant.agentId, agentId), eq(agentCapabilityGrant.status, "pending")),
    );
  const operations = c.var.deps.auth.agentRuntime.operations();
  return c.json(
    {
      agentId,
      name: found.name,
      hostName: found.hostName,
      capabilities: pending.map((g) => {
        const op = operations.get(g.capability);
        return {
          name: g.capability,
          title: op?.title ?? g.capability,
          readOnly: op?.readOnly ?? false,
          reason: g.reason,
        };
      }),
      expiresAt: request.expiresAt.toISOString(),
    },
    200,
  );
};
