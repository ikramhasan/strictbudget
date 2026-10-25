import type { RouteHandler } from "@hono/zod-openapi";
import { type Database, newId } from "@strictbudget/db";
import { aiAttachment, budgetAccount } from "@strictbudget/db/schema";
import type { CurrencyCode } from "@strictbudget/engine";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { anthropicAdapter } from "../../lib/ai/assistant";
import { MAX_AI_FILE_BYTES, readAiFile } from "../../lib/ai/files";
import { draftTransaction } from "../../lib/ai/transaction-draft";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import { log } from "../../lib/log";
import { aiAttachmentKey } from "../../lib/storage";
import { requireStorage, serveStored } from "../../lib/storage/serve";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import { aiBudget, refuseAgents } from "./handlers";
import type {
  deleteAiAttachment,
  draftTransactionFromFile,
  getAiAttachment,
  uploadAiAttachment,
} from "./routes";

type Env = AppEnv & AuthedEnv;
type AttachmentRow = typeof aiAttachment.$inferSelect;

/** The whole request, multipart framing included, refused before it's read past this. */
export const aiFileBodyLimit: MiddlewareHandler<Env> = bodyLimit({
  maxSize: MAX_AI_FILE_BYTES + 64 * 1024,
  onError: () => {
    throw new AppError(413, "FILE_TOO_LARGE", "Files can be at most 15 MB");
  },
});

const attachmentJson = (row: AttachmentRow) => ({
  id: row.id,
  fileName: row.fileName,
  contentType: row.contentType,
  byteSize: row.byteSize,
  createdAt: row.createdAt.toISOString(),
});

/** The caller's own attachment in this budget; anyone else's reads as not there. */
async function ownAttachment(db: Database, budgetId: string, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(aiAttachment)
    .where(
      and(
        eq(aiAttachment.id, id),
        eq(aiAttachment.budgetId, budgetId),
        eq(aiAttachment.userId, userId),
      ),
    );
  if (!row) throw new AppError(404, "NOT_FOUND", "No such file");
  return row;
}

export const uploadAiAttachmentHandler: RouteHandler<typeof uploadAiAttachment, Env> = async (
  c,
) => {
  const { budgetId } = c.req.valid("param");
  const { file } = c.req.valid("form");
  const { db } = c.var.deps;
  await aiBudget(c, budgetId);
  const storage = requireStorage(c.var.deps.storage);
  const read = await readAiFile(file);
  const id = newId();
  const [row] = await db
    .insert(aiAttachment)
    .values({
      id,
      budgetId,
      userId: c.var.user.id,
      storageKey: aiAttachmentKey(budgetId, id),
      fileName: read.fileName,
      contentType: read.contentType,
      byteSize: read.bytes.byteLength,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  // Last, so a failed upload rolls the row back (the request is one transaction).
  await storage.put(row.storageKey, read.bytes, read.contentType);
  return c.json(attachmentJson(row), 201);
};

/** Text files (CSV, OFX, JSON, XML…) are shown as plain text, never as a page of the app's origin. */
const servedType = (stored: string) =>
  stored.startsWith("image/") ||
  stored === "application/pdf" ||
  stored.startsWith("application/vnd.")
    ? stored
    : "text/plain; charset=utf-8";

export const getAiAttachmentHandler: RouteHandler<typeof getAiAttachment, Env> = async (c) => {
  const { budgetId, attachmentId } = c.req.valid("param");
  const download = c.req.valid("query").download === "true";
  await aiBudget(c, budgetId);
  const storage = requireStorage(c.var.deps.storage);
  const row = await ownAttachment(c.var.deps.db, budgetId, c.var.user.id, attachmentId);
  return serveStored(c, storage, row.storageKey, {
    fileName: row.fileName,
    contentType: servedType(row.contentType),
    download,
    // A file never changes, so it can be kept as long as its signed link lasts (less a minute).
    maxAgeSeconds: 240,
  });
};

export const deleteAiAttachmentHandler: RouteHandler<typeof deleteAiAttachment, Env> = async (
  c,
) => {
  const { budgetId, attachmentId } = c.req.valid("param");
  const { db, jobs } = c.var.deps;
  await aiBudget(c, budgetId);
  const row = await ownAttachment(db, budgetId, c.var.user.id, attachmentId);
  if (row.conversationId) {
    throw new AppError(409, "ATTACHMENT_SENT", "This file is part of a conversation");
  }
  // A trigger queues its file for deletion; the job deletes it once this commits.
  await db.delete(aiAttachment).where(eq(aiAttachment.id, row.id));
  await jobs.send(db, "storage.purge", null);
  return c.body(null, 204);
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const draftTransactionFromFileHandler: RouteHandler<
  typeof draftTransactionFromFile,
  Env
> = async (c) => {
  const { budgetId } = c.req.valid("param");
  const { file, accountId, today } = c.req.valid("form");
  const { db, env } = c.var.deps;
  refuseAgents(c);
  // Someone who can add the transaction it fills in.
  await loadBudgetAccess(c, budgetId, { transaction: ["create"] });
  await aiBudget(c, budgetId);
  const [account] = await db
    .select({ name: budgetAccount.name, currency: budgetAccount.currency })
    .from(budgetAccount)
    .where(and(eq(budgetAccount.id, accountId), eq(budgetAccount.budgetId, budgetId)));
  if (!account) throw new AppError(400, "BAD_REQUEST", "No such account");
  const read = await readAiFile(file);
  const adapter = c.var.deps.aiAdapter ?? anthropicAdapter(env);
  if (!adapter) {
    throw new AppError(503, "AI_UNAVAILABLE", "AI features aren't set up on this server.");
  }
  let draft: Awaited<ReturnType<typeof draftTransaction>>;
  try {
    draft = await draftTransaction({
      adapter,
      db,
      budgetId,
      account: { name: account.name, currency: account.currency as CurrencyCode },
      file: read,
      today: today && ISO_DATE.test(today) ? today : new Date().toISOString().slice(0, 10),
    });
  } catch (error) {
    log.warn("AI couldn't draft a transaction", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError(502, "AI_FAILED", "The AI couldn't read this file. Try again.");
  }
  return c.json(
    {
      ...draft,
      amount: draft.amount === null ? null : draft.amount.toString(),
      lines: draft.lines.map((l) => ({ ...l, amount: l.amount.toString() })),
    },
    200,
  );
};
