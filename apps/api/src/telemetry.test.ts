import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLog } from "./middleware/request-log";
import { telemetryConfigured } from "./telemetry";
import type { AppEnv } from "./types";

describe("telemetry", () => {
  it("starts only when an OTEL exporter or endpoint is set", () => {
    expect(telemetryConfigured({})).toBe(false);
    expect(telemetryConfigured({ OTEL_SERVICE_NAME: "x" })).toBe(false);
    expect(telemetryConfigured({ OTEL_TRACES_EXPORTER: "none" })).toBe(false);
    expect(telemetryConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" })).toBe(
      true,
    );
    expect(telemetryConfigured({ OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://logs" })).toBe(true);
    expect(telemetryConfigured({ OTEL_METRICS_EXPORTER: "prometheus" })).toBe(true);
    expect(
      telemetryConfigured({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
        OTEL_SDK_DISABLED: "true",
      }),
    ).toBe(false);
  });
});

describe("request log", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("writes one JSON line per request in production: route pattern, status, latency, budget", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const app = new Hono<AppEnv>()
      .use("*", requestId())
      .use("*", requestLog)
      .get("/v1/budgets/:budgetId/accounts/:accountId", (c) => c.json({ ok: true }));

    const res = await app.request("/v1/budgets/b-1/accounts/a-2?q=secret%20memo");
    expect(res.status).toBe(200);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "info",
      msg: "request",
      method: "GET",
      route: "/v1/budgets/:budgetId/accounts/:accountId",
      status: 200,
      budgetId: "b-1",
    });
    expect(typeof entry.durationMs).toBe("number");
    expect(typeof entry.requestId).toBe("string");
    // The raw path and query (ids, search text) stay out.
    expect(lines[0]).not.toContain("a-2");
    expect(lines[0]).not.toContain("secret");
  });
});
