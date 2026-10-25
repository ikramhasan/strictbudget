import type { Database } from "@strictbudget/db";
import { aiChatInterrupt, aiChatRun, aiChatThread } from "@strictbudget/db/schema";
import type { ModelMessage, RunRecord, RunStatus, RunStore, TokenUsage } from "@tanstack/ai";
import {
  type ChatWithInterruptsPersistence,
  defineAIPersistence,
  defineInterruptStore,
  defineMessageStore,
  type InterruptRecord,
} from "@tanstack/ai-persistence";
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";

// TanStack AI's chat persistence (`withPersistence`) over our tables: the transcript, run records
// and pending approvals of each AI conversation. Written to the store contracts in TanStack's
// store reference (tanstack.com/ai/latest/docs/persistence/store-reference): `saveThread` is a
// full overwrite, run and interrupt creates are insert-if-absent, and records omit absent
// optional fields. Thread access is authorized by the routes, not here.

type RunRow = typeof aiChatRun.$inferSelect;
type InterruptRow = typeof aiChatInterrupt.$inferSelect;

function runRecord(row: RunRow): RunRecord {
  return {
    runId: row.runId,
    threadId: row.threadId,
    status: row.status as RunStatus,
    startedAt: row.startedAt,
    ...(row.finishedAt != null ? { finishedAt: row.finishedAt } : {}),
    ...(row.error != null
      ? { error: { message: row.error, ...(row.errorCode != null ? { code: row.errorCode } : {}) } }
      : {}),
    ...(row.usage != null ? { usage: row.usage as TokenUsage } : {}),
    ...(row.parentRunId != null ? { parentRunId: row.parentRunId } : {}),
    ...(row.subagentRunId != null ? { subagentRunId: row.subagentRunId } : {}),
    ...(row.name != null ? { name: row.name } : {}),
  };
}

function interruptRecord(row: InterruptRow): InterruptRecord {
  return {
    interruptId: row.interruptId,
    runId: row.runId,
    threadId: row.threadId,
    status: row.status,
    requestedAt: row.requestedAt,
    payload: row.payload,
    ...(row.resolvedAt != null ? { resolvedAt: row.resolvedAt } : {}),
    ...(row.response != null ? { response: row.response } : {}),
  };
}

function messageStore(db: Database) {
  return defineMessageStore({
    async loadThread(threadId) {
      const [row] = await db
        .select({ messages: aiChatThread.messages })
        .from(aiChatThread)
        .where(eq(aiChatThread.threadId, threadId));
      // An unknown thread is [], never null.
      return (row?.messages ?? []) as ModelMessage[];
    },
    async saveThread(threadId, messages) {
      const updatedAt = Date.now();
      await db
        .insert(aiChatThread)
        .values({ threadId, messages, updatedAt })
        .onConflictDoUpdate({ target: aiChatThread.threadId, set: { messages, updatedAt } });
    },
  });
}

function runStore(db: Database): RunStore {
  async function get(runId: string) {
    const [row] = await db.select().from(aiChatRun).where(eq(aiChatRun.runId, runId));
    return row ? runRecord(row) : null;
  }
  return {
    get,
    async createOrResume(input) {
      await db
        .insert(aiChatRun)
        .values({
          runId: input.runId,
          threadId: input.threadId,
          status: input.status ?? "running",
          startedAt: input.startedAt,
          parentRunId: input.parentRunId,
          subagentRunId: input.subagentRunId,
          name: input.name,
        })
        .onConflictDoNothing({ target: aiChatRun.runId });
      // Re-read: an existing run (or a concurrent create that won) is returned unchanged.
      const stored = await get(input.runId);
      if (!stored) throw new Error(`AI run ${input.runId} was not stored`);
      return stored;
    },
    async update(runId, patch) {
      const set: Partial<typeof aiChatRun.$inferInsert> = {};
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.finishedAt !== undefined) set.finishedAt = patch.finishedAt;
      // Together, so a later failure without a code can't keep an earlier one's code.
      if (patch.error !== undefined) {
        set.error = patch.error.message;
        set.errorCode = patch.error.code ?? null;
      }
      if (patch.usage !== undefined) set.usage = patch.usage;
      // The sandbox and host-session fields aren't used by a chat app (store reference).
      if (Object.keys(set).length === 0) return;
      await db.update(aiChatRun).set(set).where(eq(aiChatRun.runId, runId));
    },
    async findActiveRun(threadId) {
      const [row] = await db
        .select()
        .from(aiChatRun)
        .where(and(eq(aiChatRun.threadId, threadId), eq(aiChatRun.status, "running")))
        .orderBy(desc(aiChatRun.startedAt))
        .limit(1);
      return row ? runRecord(row) : null;
    },
    async listByThread(threadId) {
      const rows = await db
        .select()
        .from(aiChatRun)
        .where(eq(aiChatRun.threadId, threadId))
        .orderBy(asc(aiChatRun.startedAt));
      return rows.map(runRecord);
    },
    async listByParentRun(parentRunId) {
      const rows = await db
        .select()
        .from(aiChatRun)
        .where(eq(aiChatRun.parentRunId, parentRunId))
        .orderBy(asc(aiChatRun.startedAt));
      return rows.map(runRecord);
    },
  };
}

function interruptStore(db: Database) {
  const list = async (where: SQL | undefined) =>
    (
      await db.select().from(aiChatInterrupt).where(where).orderBy(asc(aiChatInterrupt.requestedAt))
    ).map(interruptRecord);
  return defineInterruptStore({
    async create(record) {
      // Insert-if-absent: a duplicate never moves a resolved interrupt back to pending.
      await db
        .insert(aiChatInterrupt)
        .values({
          interruptId: record.interruptId,
          runId: record.runId,
          threadId: record.threadId,
          status: "pending",
          requestedAt: record.requestedAt,
          payload: record.payload,
          response: record.response,
        })
        .onConflictDoNothing({ target: aiChatInterrupt.interruptId });
    },
    async resolve(interruptId, response) {
      await db
        .update(aiChatInterrupt)
        .set({
          status: "resolved",
          resolvedAt: Date.now(),
          ...(response !== undefined ? { response } : {}),
        })
        .where(eq(aiChatInterrupt.interruptId, interruptId));
    },
    async cancel(interruptId) {
      await db
        .update(aiChatInterrupt)
        .set({ status: "cancelled", resolvedAt: Date.now() })
        .where(eq(aiChatInterrupt.interruptId, interruptId));
    },
    // All or nothing: a duplicate id, an unknown one or one that isn't pending rejects the batch.
    async commitBatch(entries) {
      const ids = entries.map((e) => e.interruptId);
      if (new Set(ids).size !== ids.length) throw new Error("Duplicate interrupt in batch");
      await db.transaction(async (tx) => {
        const rows = await tx
          .select({ id: aiChatInterrupt.interruptId, status: aiChatInterrupt.status })
          .from(aiChatInterrupt)
          .where(inArray(aiChatInterrupt.interruptId, ids))
          .for("update");
        const pending = new Set(rows.filter((r) => r.status === "pending").map((r) => r.id));
        if (ids.some((id) => !pending.has(id))) {
          throw new Error("Interrupt batch names an unknown or already settled interrupt");
        }
        const resolvedAt = Date.now();
        for (const entry of entries) {
          await tx
            .update(aiChatInterrupt)
            .set(
              entry.status === "resolved"
                ? { status: "resolved", resolvedAt, response: entry.response ?? null }
                : { status: "cancelled", resolvedAt },
            )
            .where(eq(aiChatInterrupt.interruptId, entry.interruptId));
        }
      });
    },
    async get(interruptId) {
      const [row] = await db
        .select()
        .from(aiChatInterrupt)
        .where(eq(aiChatInterrupt.interruptId, interruptId));
      return row ? interruptRecord(row) : null;
    },
    list: (threadId) => list(eq(aiChatInterrupt.threadId, threadId)),
    listPending: (threadId) =>
      list(and(eq(aiChatInterrupt.threadId, threadId), eq(aiChatInterrupt.status, "pending"))),
    listByRun: (runId) => list(eq(aiChatInterrupt.runId, runId)),
    listPendingByRun: (runId) =>
      list(and(eq(aiChatInterrupt.runId, runId), eq(aiChatInterrupt.status, "pending"))),
  });
}

export function chatPersistence(db: Database): ChatWithInterruptsPersistence {
  return defineAIPersistence({
    stores: { messages: messageStore(db), runs: runStore(db), interrupts: interruptStore(db) },
  });
}
