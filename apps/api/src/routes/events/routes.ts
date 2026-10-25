import { createRoute, z } from "@hono/zod-openapi";
import { jsonError } from "../../lib/errors";
import { authSecurity, requireAuth } from "../../middleware/require-auth";

export const budgetEvents = createRoute({
  method: "get",
  path: "/budgets/{budgetId}/events",
  operationId: "streamBudgetEvents",
  tags: ["Activity"],
  security: authSecurity,
  middleware: [requireAuth] as const,
  summary: "Live changes to the budget (server-sent events)",
  description:
    "A " +
    "`text/event-stream` that sends a `change` event, data `{ table, actorId, agentId, clientId }` (`agentId`: the connected agent that made it for the actor, or null), " +
    "after every committed change to the budget's data (a request's identical changes once), " +
    "so a client can refetch what it shows; `clientId` is the `X-Client-Id` of the tab that " +
    "made it. A `ping` comment every 25 seconds keeps the connection open. The stream ends when " +
    "the caller is no longer a member.",
  request: {
    params: z.object({
      budgetId: z.string().openapi({ param: { name: "budgetId", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description: "The event stream",
      content: { "text/event-stream": { schema: z.string() } },
    },
    401: jsonError("Not signed in"),
    403: jsonError("The account's email address isn't confirmed"),
    404: jsonError("No such budget, or the caller isn't a member"),
  },
});
