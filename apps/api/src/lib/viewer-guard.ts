import { budgetMember } from "@strictbudget/db/schema";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AuthedEnv } from "../middleware/require-auth";
import type { AppEnv } from "../types";
import { AppError } from "./errors";

/** Budget-scoped POSTs that only read (path after the budget id). */
const READ_ONLY_POSTS = [
  /^accounts\/[^/]+\/reconcile\/preview$/,
  /^transactions\/selection$/,
  /^export\/transactions$/,
] as const;

/** Budget-scoped writes a viewer may still make: they change nothing in the budget. */
const VIEWER_ALLOWED = [/^leave$/, ...READ_ONLY_POSTS] as const;

/** A budget-scoped path: the budget id, then the rest of the path. */
export const BUDGET_PATH = /^\/v1\/budgets\/([^/]+)(?:\/(.*))?$/;

export const onlyReads = (rest: string) => READ_ONLY_POSTS.some((re) => re.test(rest));

/**
 * Refuses every write a viewer sends to their budget: 403 READ_ONLY, before the
 * route validates anything, so no write route can forget it. Reads, and the few POSTs that only
 * read, pass. Non-members pass through to the route's own 404.
 */
export async function viewerGuard(c: Context<AppEnv & AuthedEnv>) {
  if (c.req.method === "GET" || c.req.method === "HEAD") return;
  const match = BUDGET_PATH.exec(c.req.path);
  if (!match) return;
  const [, budgetId, rest = ""] = match;
  if (VIEWER_ALLOWED.some((re) => re.test(rest))) return;
  const [row] = await c.var.deps.db
    .select({ role: budgetMember.role })
    .from(budgetMember)
    .where(and(eq(budgetMember.budgetId, budgetId ?? ""), eq(budgetMember.userId, c.var.user.id)));
  if (row?.role === "viewer") {
    throw new AppError(403, "READ_ONLY", "You can view this budget but not change it");
  }
}
