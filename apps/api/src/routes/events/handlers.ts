import type { RouteHandler } from "@hono/zod-openapi";
import { budgetMember } from "@strictbudget/db/schema";
import { and, eq } from "drizzle-orm";
import { streamSSE } from "hono/streaming";
import { loadBudgetAccess } from "../../lib/budget-access";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type { budgetEvents } from "./routes";

const HEARTBEAT_MS = 25_000;

export const budgetEventsHandler: RouteHandler<typeof budgetEvents, AppEnv & AuthedEnv> = async (
  c,
) => {
  const { budgetId } = c.req.valid("param");
  const { db, changes } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  const userId = c.var.user.id;
  const stillMember = async () => {
    const [row] = await db
      .select({ id: budgetMember.id })
      .from(budgetMember)
      .where(and(eq(budgetMember.budgetId, budgetId), eq(budgetMember.userId, userId)));
    return Boolean(row);
  };

  return streamSSE(c, async (stream) => {
    let closed = false;
    let wake: () => void = () => {};
    // Changes are handled one at a time, in order, and each checks the membership first, so a
    // change is never written to a stream whose member is already gone, whatever happened to
    // the removal's own notification.
    let queue = Promise.resolve();
    const unsubscribe = await changes.subscribe(budgetId, (change) => {
      // Never left unhandled: a failed write (the client just left) or check ends the stream.
      const end = () => {
        closed = true;
        wake();
      };
      queue = queue
        .then(async () => {
          if (closed) return;
          // Removed from the budget, left it, or the budget was deleted: nothing more to hear.
          if (!(await stillMember())) return end();
          await stream.writeSSE({
            event: "change",
            data: JSON.stringify({
              table: change.table,
              actorId: change.actorId,
              agentId: change.agentId ?? null,
              clientId: change.clientId,
            }),
          });
        })
        .catch(end);
    });
    stream.onAbort(() => {
      closed = true;
      wake();
    });
    try {
      // The client's EventSource reconnects itself; this says it's still connected.
      await stream.write(": connected\n\n");
      while (!closed) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, HEARTBEAT_MS);
        });
        if (!closed) await stream.write(": ping\n\n");
      }
    } finally {
      unsubscribe();
    }
  }) as never;
};
