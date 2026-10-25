import { fileURLToPath } from "node:url";
import { createDb } from "@strictbudget/db";
import { createApp } from "./app";
import { parseEnv } from "./env";
import { createAuth } from "./lib/auth";
import { ChangeBus } from "./lib/change-bus";
import { buildOpenApiDocument } from "./lib/docs";
import { MemoryEmailSender } from "./lib/email/sender";
import { Jobs } from "./lib/jobs";

export const OPENAPI_FILE = fileURLToPath(new URL("../openapi.json", import.meta.url));

/**
 * Builds the OpenAPI document from a fully wired app without any real config or DB access
 * (postgres.js connects lazily, and building the doc never queries).
 */
export function generateOpenApiDocument() {
  const env = parseEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://spec:spec@127.0.0.1:1/spec",
    BETTER_AUTH_SECRET: "openapi-spec-generation-placeholder-secret",
    BETTER_AUTH_URL: "http://localhost:3000",
    WEB_ORIGIN: "http://localhost:5173",
  });
  const { db, listen } = createDb(env.DATABASE_URL, { max: 1 });
  const email = new MemoryEmailSender();
  return buildOpenApiDocument(
    createApp({
      db,
      env,
      email,
      // Never started: building the document sends no jobs.
      jobs: new Jobs(env.DATABASE_URL, { worker: false }),
      auth: createAuth(db, env, email),
      changes: new ChangeBus(listen),
      fxProviders: [],
      storage: null,
    }),
  );
}

export function serializeOpenApi(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
