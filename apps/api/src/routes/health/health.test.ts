import { createDb } from "@strictbudget/db";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createTestApp, testEnv } from "../../../test/helpers";
import { createApp } from "../../app";
import { createAuth } from "../../lib/auth";
import { ChangeBus } from "../../lib/change-bus";
import { MemoryEmailSender } from "../../lib/email/sender";
import { Jobs } from "../../lib/jobs";

const { app, close } = createTestApp();
afterAll(close);

describe("GET /v1/health", () => {
  it("reports ok when the database is reachable", async () => {
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("returns 503 in the standard error shape when the database is down", async () => {
    const env = testEnv();
    const broken = createDb("postgres://nobody:nothing@127.0.0.1:1/none", { max: 1 });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const email = new MemoryEmailSender();
    const res = await createApp({
      db: broken.db,
      env,
      email,
      jobs: new Jobs("postgres://nobody:nothing@127.0.0.1:1/none", { worker: false }),
      auth: createAuth(broken.db, env, email),
      changes: new ChangeBus(broken.listen),
      fxProviders: [],
      storage: null,
    }).request("/v1/health");
    spy.mockRestore();
    await broken.close();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("DATABASE_UNAVAILABLE");
  });
});

describe("app wiring", () => {
  it("serves the OpenAPI document including /v1/health", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, { get?: { operationId?: string } }>;
    };
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.paths["/v1/health"]?.get?.operationId).toBe("getHealth");
  });

  it("serves the API reference UI", async () => {
    const res = await app.request("/docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("allows credentialed CORS from the web origin", async () => {
    const res = await app.request("/v1/health", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "GET" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("returns JSON 404s for unknown routes", async () => {
    const res = await app.request("/v1/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("tags responses with a request id", async () => {
    const res = await app.request("/v1/health");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});
