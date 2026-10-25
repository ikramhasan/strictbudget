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

  app.get("/openapi.json", (c) => c.json(buildOpenApiDocument(app)));
  app.get("/docs", Scalar({ url: "/openapi.json", pageTitle: "strictbudget API" }));
}

const CURRENCY_REF = { $ref: "#/components/schemas/CurrencyCode" };

function isNullableCurrencyRef(allOf: unknown): boolean {
  if (!Array.isArray(allOf) || allOf.length !== 2) return false;
  const [first, second] = allOf as Record<string, unknown>[];
  return (
    first?.$ref === CURRENCY_REF.$ref && Array.isArray(second?.type) && second.type.includes("null")
  );
}

/**
 * Zod keeps a schema that was given its own `.describe()` or `.nullable()` apart from the named
 * `CurrencyCode` one and writes its ~160 values out again. Point every such copy back at the
 * component, keeping its description and nullability.
 */
function refCurrencyCodes(node: unknown, values: string): void {
  if (Array.isArray(node)) {
    for (const item of node) refCurrencyCodes(item, values);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const schema = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(schema)) {
    if (key === "enum" || key === "CurrencyCode" || typeof value !== "object" || value === null)
      continue;
    const child = value as Record<string, unknown>;
    if (
      Array.isArray(child.enum) &&
      JSON.stringify(child.enum.filter((v) => v !== null)) === values
    ) {
      const ref = CURRENCY_REF;
      const type = child.type;
      const nullable = Array.isArray(type) && type.includes("null");
      schema[key] = {
        ...(nullable ? { anyOf: [ref, { type: "null" }] } : ref),
        ...(typeof child.description === "string" ? { description: child.description } : {}),
      };
    } else if (isNullableCurrencyRef(child.allOf)) {
      // A bare `.nullable()` on the named schema comes out as an intersection that rules out null.
      const { allOf: _, ...rest } = child;
      schema[key] = { ...rest, anyOf: [CURRENCY_REF, { type: "null" }] };
    } else {
      refCurrencyCodes(child, values);
    }
  }
}

export function buildOpenApiDocument(app: OpenAPIHono<AppEnv>) {
  const doc = app.getOpenAPI31Document(OPENAPI_CONFIG);
  const named = doc.components?.schemas?.CurrencyCode as { enum?: string[] } | undefined;
  if (named?.enum) {
    const values = JSON.stringify(named.enum);
    refCurrencyCodes(doc.paths, values);
    refCurrencyCodes(doc.components?.schemas, values);
  }
  return doc;
}
