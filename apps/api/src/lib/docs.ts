import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { AppEnv } from "../types";
import { API_KEY_REQUESTS_PER_HOUR } from "./api-keys";

export const OPENAPI_CONFIG = {
  openapi: "3.1.0",
  info: {
    title: "strictbudget API",
    version: "0.1.0",
    description:
      "Zero-based budgeting API. Money amounts are integer strings in the currency's minor units.\n\n" +
      "**Authentication:** create a personal API key in the web app (Account settings → API Keys) and send it as `Authorization: Bearer ec_…`. Choose it under *Authentication* to try requests here.",
  },
} as const;

export function registerDocs(app: OpenAPIHono<AppEnv>): void {
  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description: "Session cookie set by the Better Auth endpoints under /api/auth",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "apiKeyAuth", {
    type: "http",
    scheme: "bearer",
    description: `A personal API key (\`ec_…\`), created in the web app under Account → API keys and sent as \`Authorization: Bearer <key>\` (or an \`x-api-key\` header). A key acts as its owner within its scope: read-only or read & write, on every budget or chosen ones. It can't reach account or security routes, create, delete or import budgets, or manage sharing; those take a signed-in session. Each key may make ${API_KEY_REQUESTS_PER_HOUR} requests an hour.`,
  });

  app.doc31("/openapi.json", OPENAPI_CONFIG);
  app.get("/docs", Scalar({ url: "/openapi.json", pageTitle: "strictbudget API" }));
}

export function buildOpenApiDocument(app: OpenAPIHono<AppEnv>) {
  return app.getOpenAPI31Document(OPENAPI_CONFIG);
}
