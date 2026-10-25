import type { RouteHandler } from "@hono/zod-openapi";
import { scheduledTransaction } from "@strictbudget/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { loadBudgetAccess } from "../../lib/budget-access";
import { type Db, serverToday } from "../../lib/ledger";
import {
  enterNow,
  prefetchScheduleRates,
  type ScheduledRowJson,
  type ScheduleInput,
  scheduledRows,
  writeSchedule,
} from "../../lib/scheduled";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { findAccount, usesCategory } from "../transactions/rules";
import type { bulkUpdateScheduledTransactions } from "./routes";

type Env = AppEnv & AuthedEnv;

/** A schedule as `writeSchedule` takes it, from its own row. */
function inputFrom(row: ScheduledRowJson): ScheduleInput {
  return {
    accountId: row.accountId,
    frequency: row.frequency,
    date: row.dateNext,
    dateFirst: row.dateFirst,
    amount: BigInt(row.amount),
    payee: row.transferAccountId
      ? { transferAccountId: row.transferAccountId }
      : { id: row.payeeId },
    categoryId: row.subtransactions.length > 0 ? null : row.categoryId,
    memo: row.memo,
    flag: row.flag,
    lines:
      row.subtransactions.length > 0
        ? row.subtransactions.map((l) => ({
            amount: l.amount,
            payeeName: l.transferAccountId ? null : l.payeeName,
            ...(l.transferAccountId ? { transferAccountId: l.transferAccountId } : {}),
            categoryId: l.categoryId,
            memo: l.memo,
          }))
        : null,
  };
}

/** Whether a schedule from `accountId` (transferring to `toId`) takes a category on either side. */
async function takesCategory(tx: Db, budgetId: string, accountId: string, toId: string | null) {
  const account = await findAccount(tx, budgetId, accountId);
  const to = toId ? await findAccount(tx, budgetId, toId) : null;
  return usesCategory(account, to) || (to !== null && usesCategory(to, account));
}

export const bulkUpdateScheduledTransactionsHandler: RouteHandler<
  typeof bulkUpdateScheduledTransactions,
  Env
> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { ids, action, today = serverToday() } = c.req.valid("json");
  const { db } = c.var.deps;
  await loadBudgetAccess(
    c,
    budgetId,
    action.type === "delete"
      ? { transaction: ["delete"] }
      : action.type === "duplicate" || action.type === "enterNow"
        ? { transaction: ["create"] }
        : { transaction: ["update"] },
  );

  // The selected rows, each schedule once, in the order given.
  const pick = (all: ScheduledRowJson[]) => {
    const byId = new Map(all.map((r) => [r.id, r]));
    const picked: { row: ScheduledRowJson; own: ScheduledRowJson }[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const row = byId.get(id);
      const own = row && byId.get(row.scheduledTransactionId);
      if (!row || !own || seen.has(own.id)) continue;
      if (row.kind === "splitTransfer" && action.type !== "enterNow") continue;
      seen.add(own.id);
      picked.push({ row, own });
    }
    return picked;
  };
  if (action.type === "enterNow") {
    // Enter Now converts at `today`: look the rates up before any schedule is locked.
    const own = pick(await scheduledRows(db, budgetId)).map((p) => p.own.id);
    await prefetchScheduleRates(db, c.var.deps, budgetId, { scheduleIds: own, dates: [today] });
  }

  const result = await db.transaction(async (tx) => {
    let picked = pick(await scheduledRows(tx, budgetId));
    if (picked.length > 0) {
      await tx
        .select({ id: scheduledTransaction.id })
        .from(scheduledTransaction)
        .where(
          and(
            eq(scheduledTransaction.budgetId, budgetId),
            inArray(
              scheduledTransaction.id,
              picked.map((p) => p.own.id),
            ),
          ),
        )
        .orderBy(scheduledTransaction.id)
        .for("update");
      // Read again under the lock: the rows are rewritten from what they hold now, not from
      // before another request (entering what came due, say) committed.
      picked = pick(await scheduledRows(tx, budgetId));
    }

    const applied: ScheduledRowJson[] = [];
    const entered: string[] = [];
    const created: string[] = [];
    const write = (own: ScheduledRowJson, input: ScheduleInput) =>
      writeSchedule(tx, budgetId, input, {
        id: own.id,
        accountId: own.accountId,
        transferAccountId: own.transferAccountId,
      });

    for (const { row, own } of picked) {
      switch (action.type) {
        case "enterNow": {
          const [schedule] = await tx
            .select()
            .from(scheduledTransaction)
            .where(eq(scheduledTransaction.id, own.id));
          if (!schedule) continue;
          entered.push(await enterNow(tx, c.var.deps, schedule, today));
          break;
        }
        case "duplicate":
          created.push(
            await writeSchedule(tx, budgetId, { ...inputFrom(own), dateFirst: own.dateNext }),
          );
          break;
        case "flag":
          await tx
            .update(scheduledTransaction)
            .set({ flag: action.flag })
            .where(eq(scheduledTransaction.id, own.id));
          break;
        case "memo":
          await tx
            .update(scheduledTransaction)
            .set({ memo: action.memo })
            .where(eq(scheduledTransaction.id, own.id));
          break;
        case "categorize": {
          const input = inputFrom(own);
          if (input.lines) {
            // As on transactions: a split with a transfer line stays split, its other lines
            // take the category; any other split is un-split.
            if (input.lines.some((l) => l.transferAccountId)) {
              input.lines = input.lines.map((l) =>
                l.transferAccountId ? l : { ...l, categoryId: action.categoryId },
              );
            } else {
              input.lines = null;
              input.categoryId = action.categoryId;
            }
          } else if (await takesCategory(tx, budgetId, own.accountId, own.transferAccountId)) {
            input.categoryId = action.categoryId;
          } else {
            continue;
          }
          await write(own, input);
          break;
        }
        case "move": {
          const target = action.accountId;
          const input = inputFrom(own);
          if (row.kind === "transfer") {
            // The other side moves: the schedule now transfers to `target`.
            if (target === row.accountId || target === own.accountId) continue;
            input.payee = { transferAccountId: target };
          } else {
            if (target === own.accountId || target === own.transferAccountId) continue;
            if (input.lines?.some((l) => l.transferAccountId === target)) continue;
            input.accountId = target;
          }
          const to = "transferAccountId" in input.payee ? input.payee.transferAccountId : null;
          if (!input.lines && !(await takesCategory(tx, budgetId, input.accountId, to))) {
            input.categoryId = null;
          }
          await write(own, input);
          break;
        }
        case "delete":
          await tx.delete(scheduledTransaction).where(eq(scheduledTransaction.id, own.id));
          break;
      }
      applied.push(own);
    }
    return { updated: applied.length, before: applied, entered, created };
  });
  return c.json(result, 200);
};
