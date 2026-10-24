import { createRoute, z } from "@hono/zod-openapi";
import { CONNECTED_AGENT_KINDS } from "@strictbudget/db/schema";
import { jsonError } from "../../lib/errors";
import { requireSession, sessionSecurity } from "../../middleware/require-auth";

const AgentSchema = z
  .object({
    id: z.string(),
    kind: z
      .enum(CONNECTED_AGENT_KINDS)
      .describe("`mcp`: an MCP client (Claude, Cursor, …); `agent_auth`: an Agent Auth agent"),
    name: z.string().describe("As the client or agent named itself"),
    access: z
      .enum(["read", "write"])
      .describe("`read`: it can only look; `write`: it can also make changes"),
    permissions: z
      .array(z.string())
      .describe(
        "What it was granted: OAuth scopes for an MCP client, capabilities (API operations) " +
          "for an Agent Auth agent",
      ),
    connectedAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime(),
  })
  .openapi("ConnectedAgent");

export const listConnectedAgents = createRoute({
  method: "get",
  path: "/me/agents",
  operationId: "listConnectedAgents",
  tags: ["Users"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "The agents acting for you",
  description:
    "MCP clients and Agent Auth agents you've connected, newest first. Their changes show as " +
    "theirs on your behalf. Not available to agents.",
  responses: {
    200: {
      description: "Connected agents",
      content: {
        "application/json": {
          schema: z.object({ agents: z.array(AgentSchema) }).openapi("ConnectedAgentList"),
        },
      },
    },
    401: jsonError("Not signed in"),
    403: jsonError(
      "An agent's request, the account's email address isn't confirmed, or the request used an API key (SESSION_REQUIRED)",
    ),
  },
});

const AgentParams = z.object({
  agentId: z.string().openapi({ param: { name: "agentId", in: "path" } }),
});

export const revokeConnectedAgent = createRoute({
  method: "delete",
  path: "/me/agents/{agentId}",
  operationId: "revokeConnectedAgent",
  tags: ["Users"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "Disconnect an agent",
  description:
    "Ends its access at once: an MCP client's tokens and consent, or an Agent Auth agent and its " +
    "grants. Its past changes stay attributed to it. Not available to agents.",
  request: { params: AgentParams },
  responses: {
    204: { description: "Disconnected" },
    401: jsonError("Not signed in"),
    403: jsonError(
      "An agent's request, the account's email address isn't confirmed, or the request used an API key (SESSION_REQUIRED)",
    ),
    404: jsonError("No such agent of yours"),
  },
});

const CapabilitySchema = z
  .object({
    name: z.string().describe("The API operation (its operationId)"),
    title: z.string(),
    readOnly: z.boolean().describe("Changes nothing"),
    reason: z.string().nullable().describe("Why the agent says it needs it"),
  })
  .openapi("AgentCapability");

export const getAgentApproval = createRoute({
  method: "get",
  path: "/me/agent-approvals/{agentId}",
  operationId: "getAgentApproval",
  tags: ["Users"],
  security: sessionSecurity,
  middleware: [requireSession] as const,
  summary: "An agent's request for your approval",
  description:
    "What an Agent Auth agent asks to do, for the approval page it sends you to. Shown only with " +
    "the code the agent gave you, while the request is pending. Approve or deny it with Better " +
    "Auth's `POST /api/auth/agent/approve-capability`. Not available to agents.",
  request: {
    params: AgentParams,
    query: z.object({
      code: z.string().min(1).max(20).describe("The code the agent shows, e.g. `ABCD-2345`"),
    }),
  },
  responses: {
    200: {
      description: "The pending request",
      content: {
        "application/json": {
          schema: z
            .object({
              agentId: z.string(),
              name: z.string(),
              hostName: z.string().nullable(),
              capabilities: z.array(CapabilitySchema),
              expiresAt: z.iso.datetime(),
            })
            .openapi("AgentApproval"),
        },
      },
    },
    400: jsonError("Invalid input"),
    401: jsonError("Not signed in"),
    403: jsonError(
      "An agent's request, the account's email address isn't confirmed, or the request used an API key (SESSION_REQUIRED)",
    ),
    404: jsonError("No pending request with that code (wrong, expired or already answered)"),
  },
});
