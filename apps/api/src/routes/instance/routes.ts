import { createRoute, z } from "@hono/zod-openapi";

export const InstanceSchema = z
  .object({
    deployment: z
      .enum(["self-hosted", "cloud"])
      .describe("`cloud` is the hosted strictbudget; anything else is a self-hosted server"),
    email: z
      .boolean()
      .describe(
        "Whether the server sends email. Without it, addresses aren't confirmed, there's no " +
          "password reset link, an email change applies at once, and invitations are shared as links",
      ),
  })
  .openapi("Instance");

export const getInstance = createRoute({
  method: "get",
  path: "/instance",
  operationId: "getInstance",
  tags: ["System"],
  summary: "How this server is set up",
  description: "Public: the web app reads it before anyone signs in.",
  responses: {
    200: {
      description: "This server's setup",
      content: { "application/json": { schema: InstanceSchema } },
    },
  },
});
