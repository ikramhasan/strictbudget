import { createHash } from "node:crypto";
import type { RouteHandler } from "@hono/zod-openapi";
import { loadBudgetAccess } from "../../lib/budget-access";
import { httpExternalClient } from "../../lib/external-import/client";
import { fromExternalApi } from "../../lib/external-import/from-api";
import { csvAccounts, fromExternalCsv } from "../../lib/external-import/from-csv";
import { type ExternalImportResult, importConverted } from "../../lib/external-import/import";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { toBudgetJson } from "../budgets/handlers";
import type { importExternalFiles, importExternalPlan, listExternalPlans } from "./routes";

type Env = AppEnv & AuthedEnv;

export const listExternalPlansHandler: RouteHandler<typeof listExternalPlans, Env> = async (c) => {
  const { token } = c.req.valid("json");
  const client = c.var.deps.externalPlans ?? httpExternalClient();
  const plans = await client.listPlans(token);
  return c.json(
    {
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        lastModifiedOn: p.last_modified_on ?? null,
      })),
    },
    200,
  );
};

// biome-ignore lint/suspicious/noExplicitAny: any route's context
async function report(c: Parameters<RouteHandler<any, Env>>[0], result: ExternalImportResult) {
  const access = await loadBudgetAccess(c, result.budgetId);
  return {
    budget: toBudgetJson(access),
    reused: result.reused,
    counts: result.counts,
    warnings: result.warnings,
  };
}

export const importExternalPlanHandler: RouteHandler<typeof importExternalPlan, Env> = async (
  c,
) => {
  const { token, planId, name, replace } = c.req.valid("json");
  const client = c.var.deps.externalPlans ?? httpExternalClient();
  const plan = await client.getPlan(token, planId);
  const result = await importConverted(c, fromExternalApi(plan), {
    source: `external:${plan.id}`,
    name,
    replace,
  });
  return c.json(await report(c, result), result.reused ? 200 : 201);
};

export const importExternalFilesHandler: RouteHandler<typeof importExternalFiles, Env> = async (
  c,
) => {
  const body = c.req.valid("json");
  if (body.dryRun) {
    return c.json({ accounts: csvAccounts(body.register, body.plan, body) }, 200);
  }
  const conversion = fromExternalCsv(
    { plan: body.plan, register: body.register, name: body.name },
    body,
  );
  const hash = createHash("sha256")
    .update(body.plan)
    .update("\0")
    .update(body.register)
    .digest("hex");
  const result = await importConverted(c, conversion, {
    source: `external-files:${hash}`,
    replace: body.replace,
  });
  return c.json(await report(c, result), result.reused ? 200 : 201);
};
