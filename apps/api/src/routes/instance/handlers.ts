import type { RouteHandler } from "@hono/zod-openapi";
import type { AppEnv } from "../../types";
import type { getInstance } from "./routes";

export const getInstanceHandler: RouteHandler<typeof getInstance, AppEnv> = (c) => {
  const { env, email } = c.var.deps;
  return c.json({ deployment: env.STRICTBUDGET_DEPLOYMENT, email: email !== null }, 200);
};
