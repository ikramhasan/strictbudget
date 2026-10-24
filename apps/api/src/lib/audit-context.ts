import { type Database, sql } from "@strictbudget/db";
import type { Context, Next } from "hono";
import type { AuthedEnv } from "../middleware/require-auth";
import type { AppEnv } from "../types";
import type { Db } from "./ledger";

/** Who and what a transaction's changes are logged as (migration 0038's `strictbudget.*` settings). */
export interface AuditContext {
  actorId: string | null;
  /** The agent (`connected_agent` id) making the change for the actor; null for the user's own. */
  agentId?: string | null;
  clientId?: string | null;
  requestId?: string | null;
  /** Why a change without an actor happens, e.g. "scheduled". */
  source?: string | null;
}

/**
 * Sets the transaction's audit context. Local to the transaction (`set_config(…, true)`), so it
 * only means something inside one: the triggers read it for the change log, the row versions'
 * stamps and the change notifications.
 */
export async function setAuditContext(tx: Db, ctx: AuditContext): Promise<void> {
  await tx.execute(sql`select
    set_config('strictbudget.actor_id', ${ctx.actorId ?? ""}, true),
    set_config('strictbudget.agent_id', ${ctx.agentId ?? ""}, true),
    set_config('strictbudget.client_id', ${ctx.clientId ?? ""}, true),
    set_config('strictbudget.request_id', ${ctx.requestId ?? ""}, true),
    set_config('strictbudget.source', ${ctx.source ?? ""}, true)`);
}

/** Skips the change log and stamps for the rest of the transaction (purging a deleted user). */
export async function pauseAudit(tx: Db): Promise<void> {
  await tx.execute(sql`select set_config('strictbudget.audit', 'off', true)`);
}

/**
 * Writes that call Better Auth's organization plugin, which uses its own connection: a request
 * transaction would leave the plugin's committed rows behind on a rollback, or wait on its own
 * locks. These set their audit context in their own transactions instead.
 */
const OUTSIDE = [
  /^\/v1\/me(\/|$)/,
  /^\/v1\/budgets\/?$/,
  /^\/v1\/budgets\/[^/]+\/fresh-start$/,
  /^\/v1\/budgets\/import(\/|$)/,
] as const;
/**
 * POSTs that only read, with a body too big for a query string, and stream their answer after the
 * handler returns (a request transaction would have ended by then).
 */
const READ_ONLY_POSTS = [/^\/v1\/budgets\/[^/]+\/export\//] as const;
/** Filling in a transaction from a receipt only reads, and waits on the AI: no transaction held. */
const AI_READ_POSTS = [/^\/v1\/budgets\/[^/]+\/ai\/transaction-draft$/] as const;
/**
 * The AI assistant's chat stream runs long after its handler returns. It writes only the
 * conversation's own (unaudited) records; each change it makes is a request of its own, with its
 * own transaction and audit context (`AgentRuntime.run`).
 */
const STREAMING_POSTS = [/^\/v1\/budgets\/[^/]+\/ai\/chat$/] as const;
const outsideRequestTransaction = (method: string, path: string) =>
  OUTSIDE.some((re) => re.test(path)) ||
  (method === "POST" && READ_ONLY_POSTS.some((re) => re.test(path))) ||
  (method === "POST" && AI_READ_POSTS.some((re) => re.test(path))) ||
  (method === "POST" && STREAMING_POSTS.some((re) => re.test(path))) ||
  (method === "DELETE" && /^\/v1\/budgets\/[^/]+\/?$/.test(path));

class Rollback extends Error {}

/**
 * Runs a signed-in write request in one database transaction with its audit context set: its
 * changes are logged as the user's (and the agent's, for an agent's request; and the browser tab's `X-Client-Id`), and nothing is kept if
 * it fails. Handlers see the transaction as `c.var.deps.db` (their own `db.transaction` calls
 * become savepoints). Reads run outside one.
 */
export async function inRequestTransaction(c: Context<AppEnv & AuthedEnv>, next: Next) {
  const { method, path } = c.req;
  if (method === "GET" || method === "HEAD" || outsideRequestTransaction(method, path)) {
    return next();
  }
  const deps = c.var.deps;
  try {
    await deps.db.transaction(async (tx) => {
      await setAuditContext(tx, {
        actorId: c.var.user.id,
        agentId: c.var.agent?.id ?? null,
        clientId: c.req.header("x-client-id")?.slice(0, 100) ?? null,
        requestId: c.var.requestId ?? null,
      });
      c.set("deps", { ...deps, db: tx as unknown as Database });
      try {
        await next();
      } finally {
        c.set("deps", deps);
      }
      // The error handler already answered; undo whatever the handler wrote first.
      if (c.error || c.res.status >= 500) throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
