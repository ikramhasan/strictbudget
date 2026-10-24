import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { JSONWebKeySet } from "jose";
import { McpAuth } from "./lib/agents/mcp-auth";
import { createMcpServer } from "./lib/agents/mcp-server";
import { OPENAPI_CONFIG, registerDocs } from "./lib/docs";
import { notFound, onError } from "./lib/errors";
import { createRouter } from "./lib/router";
import { serveWebApp } from "./lib/web-app";
import { requestLog } from "./middleware/request-log";
import { accountsRouter } from "./routes/accounts";
import { activityRouter } from "./routes/activity";
import { agentsRouter } from "./routes/agents";
import { aiRouter } from "./routes/ai";
import { apiKeysRouter } from "./routes/api-keys";
import { backupsRouter } from "./routes/backups";
import { budgetsRouter } from "./routes/budgets";
import { categoriesRouter } from "./routes/categories";
import { categoryTemplatesRouter } from "./routes/category-templates";
import { clientErrorsRouter } from "./routes/client-errors";
import { eventsRouter } from "./routes/events";
import { exportsRouter } from "./routes/exports";
import { externalImportRouter } from "./routes/external-import";
import { flagsRouter } from "./routes/flags";
import { fxRatesRouter } from "./routes/fx-rates";
import { healthRouter } from "./routes/health";
import { importsRouter } from "./routes/imports";
import { instanceRouter } from "./routes/instance";
import { meRouter } from "./routes/me";
import { membersRouter } from "./routes/members";
import { monthsRouter } from "./routes/months";
import { notificationsRouter } from "./routes/notifications";
import { payeesRouter } from "./routes/payees";
import { picturesRouter } from "./routes/pictures";
import { reportsRouter } from "./routes/reports";
import { scheduledRouter } from "./routes/scheduled";
import { transactionsRouter } from "./routes/transactions";
import { viewsRouter } from "./routes/views";
import type { AppDeps } from "./types";

export function createApp(deps: AppDeps) {
  const app = createRouter();

  app.use("*", requestId());
  app.use("*", httpInstrumentationMiddleware({ serviceName: "strictbudget-api" }));
  if (deps.env.NODE_ENV === "production") app.use("*", requestLog);
  else if (deps.env.NODE_ENV !== "test") app.use("*", logger());
  app.use("*", secureHeaders());
  app.use("*", cors({ origin: deps.env.WEB_ORIGIN, credentials: true }));
  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  app.onError(onError);
  app.notFound(notFound);

  // Budgets are organization-plugin records, but clients must go through /v1/budgets (our
  // validation, error shape and OpenAPI contract), so the plugin's own endpoints stay hidden.
  app.all("/api/auth/organization/*", notFound);
  // API keys are managed through /v1/me/api-keys (a session only, our scopes and error shape).
  app.all("/api/auth/api-key/*", notFound);
  // Replaced by /v1/me routes: change-email needs the current password there, and the session
  // routes return ids instead of the raw session tokens these endpoints hand to the browser.
  for (const path of [
    "/api/auth/change-email",
    "/api/auth/list-sessions",
    "/api/auth/revoke-session",
    "/api/auth/revoke-sessions",
    "/api/auth/revoke-other-sessions",
    // Two-step verification is turned off through /v1/me/two-factor, which asks for a code; there
    // are no email codes or regenerated backup codes.
    "/api/auth/two-factor/disable",
    "/api/auth/two-factor/send-otp",
    "/api/auth/two-factor/verify-otp",
    "/api/auth/two-factor/generate-backup-codes",
  ]) {
    app.all(path, notFound);
  }
  app.on(["GET", "POST"], "/api/auth/*", (c) => c.var.deps.auth.handler(c.req.raw));

  // Agents. MCP clients find the authorization server through the protected resource metadata
  // (RFC 9728) and sign in with OAuth (Better Auth's MCP plugin); Agent Auth agents start from
  // the agent configuration. Both run API operations as the person, attributed to the agent.
  const auth = deps.auth;
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server/api/auth",
  ]) {
    app.get(path, (c) => auth.handler(c.req.raw));
  }
  app.get("/.well-known/oauth-authorization-server", (c) =>
    oauthProviderAuthServerMetadata(auth)(c.req.raw),
  );
  app.get("/.well-known/openid-configuration", (c) =>
    oauthProviderOpenIdConfigMetadata(auth)(c.req.raw),
  );
  app.get("/.well-known/agent-configuration", async (c) =>
    c.json(await auth.api.getAgentConfiguration()),
  );
  const mcpAuth = new McpAuth(deps.env, deps.db, async () => {
    const res = await auth.handler(new Request(`${deps.env.BETTER_AUTH_URL}/api/auth/jwks`));
    return (await res.json()) as JSONWebKeySet;
  });
  const mcpServer = createMcpServer(auth.agentRuntime, OPENAPI_CONFIG.info.version);
  app.all("/mcp", async (c) => {
    const verified = await mcpAuth.verify(c.req.raw);
    if (!verified.ok) return verified.response;
    const { principal } = verified;
    return mcpServer.fetch(c.req.raw, {
      authInfo: {
        token: "",
        clientId: principal.agent.id,
        scopes: [],
        extra: { principal, compact: c.req.query("tools") === "compact" },
      },
    });
  });

  app.route("/v1", healthRouter);
  app.route("/v1", instanceRouter);
  app.route("/v1", clientErrorsRouter);
  app.route("/v1", meRouter);
  app.route("/v1", notificationsRouter);
  app.route("/v1", agentsRouter);
  app.route("/v1", apiKeysRouter);
  app.route("/v1", picturesRouter);
  app.route("/v1", externalImportRouter);
  app.route("/v1", backupsRouter);
  app.route("/v1", budgetsRouter);
  app.route("/v1", membersRouter);
  app.route("/v1", categoriesRouter);
  app.route("/v1", categoryTemplatesRouter);
  app.route("/v1", accountsRouter);
  app.route("/v1", transactionsRouter);
  app.route("/v1", payeesRouter);
  app.route("/v1", scheduledRouter);
  app.route("/v1", flagsRouter);
  app.route("/v1", aiRouter);
  app.route("/v1", importsRouter);
  app.route("/v1", viewsRouter);
  app.route("/v1", monthsRouter);
  app.route("/v1", fxRatesRouter);
  app.route("/v1", activityRouter);
  app.route("/v1", reportsRouter);
  app.route("/v1", eventsRouter);
  app.route("/v1", exportsRouter);

  registerDocs(app);
  auth.agentRuntime.attach(app);
  if (deps.env.WEB_DIST_DIR) serveWebApp(app, deps.env.WEB_DIST_DIR);
  return app;
}

export type App = ReturnType<typeof createApp>;
