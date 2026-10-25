import type { AgentAuthOptions } from "@better-auth/agent-auth";
import type { Database } from "@strictbudget/db";
import { agent as agentTable, connectedAgent, oauthClient } from "@strictbudget/db/schema";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import type { Env } from "../../env";
import { log } from "../log";
import { agentUser, connectAgent } from "./principal";
import type { AgentRuntime, OperationResult } from "./runtime";

/**
 * Records an agent the person just approved (an MCP client's consent, or an Agent Auth approval)
 * as connected, reconnecting one they disconnected before. Called after the plugin's endpoint
 * succeeded.
 */
export async function recordApproval(db: Database, userId: string, path: string, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  try {
    if (path === "/oauth2/consent") {
      if (b.accept !== true || typeof b.oauth_query !== "string") return;
      const clientId = new URLSearchParams(b.oauth_query).get("client_id");
      if (!clientId) return;
      const [client] = await db
        .select({ name: oauthClient.name })
        .from(oauthClient)
        .where(eq(oauthClient.clientId, clientId));
      if (!client) return;
      await connectAgent(db, {
        userId,
        kind: "mcp",
        externalId: clientId,
        name: client.name ?? "MCP client",
        authorizedAt: new Date(),
      });
    } else if (b.action === "approve" && typeof b.agent_id === "string") {
      const [row] = await db
        .select({ name: agentTable.name, userId: agentTable.userId })
        .from(agentTable)
        .where(eq(agentTable.id, b.agent_id));
      if (row?.userId !== userId) return;
      await connectAgent(db, {
        userId,
        kind: "agent_auth",
        externalId: b.agent_id,
        name: row.name,
        authorizedAt: new Date(),
      });
    }
  } catch (e) {
    log.error("Couldn't record a connected agent", { path }, e);
  }
}

function executeResult(result: OperationResult): unknown {
  if (!result.ok) {
    const body =
      result.kind === "json" && result.data && typeof result.data === "object"
        ? (result.data as Record<string, unknown>)
        : { error: { code: "ERROR", message: result.kind === "text" ? result.text : "Failed" } };
    const error = (body.error ?? body) as { code?: string; message?: string };
    throw new APIError(result.status as ConstructorParameters<typeof APIError>[0], {
      code: error.code ?? "ERROR",
      message: error.message ?? "The operation failed",
      ...body,
    });
  }
  switch (result.kind) {
    case "json":
      return result.data;
    case "text":
      return { contentType: result.contentType, text: result.text };
    case "binary":
      return { contentType: result.contentType, base64: result.base64 };
    case "redirect":
      return { url: result.location };
    case "empty":
      return { ok: true, status: result.status };
  }
}

/**
 * Agent Auth for strictbudget: delegated agents only (each acts for the person who approved it), one
 * capability per API operation, approved on the web app's /agents/approve page with the code the
 * agent shows. Capabilities run as the person's own request would, attributed to the agent.
 */
export function agentAuthOptions({
  env,
  db,
  runtime,
}: {
  env: Env;
  db: Database;
  runtime: AgentRuntime;
}): AgentAuthOptions {
  return {
    providerName: "strictbudget",
    providerDescription:
      "Zero-based budgeting: budgets, accounts, transactions (with attachments), categories, " +
      "targets, scheduled transactions, payees and reports. Money amounts are integer strings " +
      "in the currency's minor units.",
    modes: ["delegated"],
    capabilities: runtime.capabilities,
    deviceAuthorizationPage: `${env.WEB_ORIGIN}/agents/approve`,
    approvalMethods: ["device_authorization"],
    // A new agent CLI registers its host on first use; nothing is granted until the person
    // approves it (and its host is then theirs).
    allowDynamicHostRegistration: true,
    // Approving needs the person's signed-in browser and the code the agent shows them; asking
    // them to sign in again on top of that (the plugin's default) adds nothing here.
    freshSessionWindow: 0,
    validateCapabilities: (names) => {
      const ops = runtime.operations();
      return names.every((name) => ops.has(name));
    },
    async onExecute({ capability, arguments: args, agentSession }) {
      const user = await agentUser(db, agentSession.user.id);
      if (!user) throw new APIError("UNAUTHORIZED", { message: "The agent's user can't sign in" });
      const agent = await connectAgent(db, {
        userId: user.id,
        kind: "agent_auth",
        externalId: agentSession.agentId,
        name: agentSession.agent.name,
        // The plugin has checked the agent is active; a revoked one never gets here.
        authorizedAt: new Date(),
      });
      if (!agent) throw new APIError("UNAUTHORIZED", { message: "This agent was disconnected" });
      return executeResult(await runtime.run({ user, agent, canWrite: true }, capability, args));
    },
    async onEvent(event) {
      if (event.type === "agent.revoked" && event.agentId) {
        try {
          await db
            .update(connectedAgent)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(connectedAgent.kind, "agent_auth"),
                eq(connectedAgent.externalId, event.agentId),
              ),
            );
        } catch (e) {
          log.error("Couldn't mark a revoked agent disconnected", { agentId: event.agentId }, e);
        }
      }
    },
  };
}
