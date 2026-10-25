import type { RouteHandler } from "@hono/zod-openapi";
import { sql } from "@strictbudget/db";
import { errorBody } from "../../lib/errors";
import { log } from "../../lib/log";
import type { AppEnv } from "../../types";
import type { getHealth } from "./routes";

export const getHealthHandler: RouteHandler<typeof getHealth, AppEnv> = async (c) => {
  try {
    await c.var.deps.db.execute(sql`select 1`);
  } catch (err) {
    log.error("Health check: database unreachable", {}, err);
    return c.json(errorBody("DATABASE_UNAVAILABLE", "Database is unreachable"), 503);
  }
  return c.json({ status: "ok", database: "ok" } as const, 200);
};
