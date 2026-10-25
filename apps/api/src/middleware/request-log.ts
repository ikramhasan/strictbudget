import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { log } from "../lib/log";
import type { AppEnv } from "../types";

/**
 * One structured line per request: method, the matched route pattern (not the
 * raw path, which carries ids), status, latency, request id, and the budget it touched. Nothing
 * from the body or query: no amounts, names or emails.
 */
export const requestLog = createMiddleware<AppEnv>(async (c, next) => {
  const started = performance.now();
  await next();
  log.info("request", {
    method: c.req.method,
    route: routePath(c),
    status: c.res.status,
    durationMs: Math.round(performance.now() - started),
    requestId: c.get("requestId"),
    // The matched route's own parameter (after `next`, the request points at its handler).
    budgetId: c.req.param("budgetId"),
  });
});
