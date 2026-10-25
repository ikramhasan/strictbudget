import type { RouteHandler } from "@hono/zod-openapi";
import { newId } from "@strictbudget/db";
import { transaction, transactionAttachment } from "@strictbudget/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import type { Db } from "../../lib/ledger";
import { attachmentKey } from "../../lib/storage";
import {
  type AttachmentType,
  attachmentType,
  MAX_ATTACHMENT_BYTES,
} from "../../lib/storage/file-type";
import { requireStorage, serveStored } from "../../lib/storage/serve";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type { deleteAttachment, getAttachment, uploadAttachment } from "./routes";
import { lockTransaction } from "./rules";

type Env = AppEnv & AuthedEnv;
type Attachment = typeof transactionAttachment.$inferSelect;

function tooLarge(): never {
  throw new AppError(
    413,
    "FILE_TOO_LARGE",
    `Attachments can be at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`,
  );
}

/** The upload's whole request, multipart framing included, refused before it's read past this. */
export const attachmentBodyLimit: MiddlewareHandler<Env> = bodyLimit({
  maxSize: MAX_ATTACHMENT_BYTES + 64 * 1024,
  onError: () => tooLarge(),
});

export function attachmentJson(row: Attachment) {
  return {
    id: row.id,
    transactionId: row.transactionId,
    fileName: row.fileName,
    contentType: row.contentType as AttachmentType,
    byteSize: row.byteSize,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The attachments of these transactions, by the transaction that shows each: a transfer's two
 * sides share one, kept on the side it was added on.
 */
export async function attachmentsFor(
  db: Db,
  rows: readonly { id: string; transferPairId: string | null }[],
): Promise<Map<string, Attachment>> {
  const ids = [
    ...new Set(rows.flatMap((r) => (r.transferPairId ? [r.id, r.transferPairId] : [r.id]))),
  ];
  if (ids.length === 0) return new Map();
  const found = await db
    .select()
    .from(transactionAttachment)
    .where(inArray(transactionAttachment.transactionId, ids));
  const byOwner = new Map(found.map((a) => [a.transactionId, a]));
  const shown = new Map<string, Attachment>();
  for (const row of rows) {
    const attachment =
      byOwner.get(row.id) ?? (row.transferPairId ? byOwner.get(row.transferPairId) : undefined);
    if (attachment) shown.set(row.id, attachment);
  }
  return shown;
}

/** The transaction (in the budget) and the attachment it shows, if any. */
async function findShown(db: Db, budgetId: string, transactionId: string) {
  const [row] = await db
    .select({ id: transaction.id, transferPairId: transaction.transferTransactionId })
    .from(transaction)
    .where(and(eq(transaction.id, transactionId), eq(transaction.budgetId, budgetId)));
  if (!row) throw new AppError(404, "NOT_FOUND", "Transaction not found");
  return (await attachmentsFor(db, [row])).get(row.id) ?? null;
}

/**
 * Before `fromId` is deleted while `toId` stays (a transfer turned into a plain transaction, an
 * import matched into an entered one), its attachment moves to `toId`, unless that already shows
 * one. A transfer's attachment is otherwise lost with the side it was added on.
 */
export async function keepAttachment(tx: Db, fromId: string, toId: string): Promise<void> {
  const [kept] = await tx
    .select({ id: transactionAttachment.id })
    .from(transactionAttachment)
    .where(eq(transactionAttachment.transactionId, toId));
  if (kept) return;
  await tx
    .update(transactionAttachment)
    .set({ transactionId: toId })
    .where(eq(transactionAttachment.transactionId, fromId));
}

/** A name to save the file as: no path, no control characters, not too long. */
function cleanFileName(name: string, type: string): string {
  const base = name
    .split(/[/\\]/)
    .pop()
    ?.replace(/\p{Cc}/gu, "")
    .trim()
    .slice(-200);
  if (base) return base;
  const ext = type === "application/pdf" ? "pdf" : (type.split("/")[1]?.split("+")[0] ?? "bin");
  return `attachment.${ext}`;
}

export const uploadAttachmentHandler: RouteHandler<typeof uploadAttachment, Env> = async (c) => {
  const { budgetId, transactionId } = c.req.valid("param");
  const { file } = c.req.valid("form");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { transaction: ["update"] });
  const storage = requireStorage(c.var.deps.storage);
  if (file.size > MAX_ATTACHMENT_BYTES) tooLarge();
  if (file.size === 0) throw new AppError(400, "BAD_REQUEST", "The file is empty");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = await attachmentType(bytes);
  if (!type) {
    throw new AppError(
      415,
      "UNSUPPORTED_FILE_TYPE",
      "Attachments can be a photo (JPG, PNG, WebP, AVIF, GIF, SVG or HEIC) or a PDF",
    );
  }

  const row = await db.transaction(async (tx) => {
    const existing = await lockTransaction(tx, budgetId, transactionId);
    if (!existing) throw new AppError(404, "NOT_FOUND", "Transaction not found");
    // Both sides of a transfer, locked, so they can't each take one at once.
    if (existing.transferTransactionId) {
      await lockTransaction(tx, budgetId, existing.transferTransactionId);
    }
    const shown = await attachmentsFor(tx, [
      { id: existing.id, transferPairId: existing.transferTransactionId },
    ]);
    if (shown.size > 0) {
      throw new AppError(
        409,
        "ATTACHMENT_EXISTS",
        "This transaction already has an attachment. Delete it to add another.",
      );
    }
    const id = newId();
    const [inserted] = await tx
      .insert(transactionAttachment)
      .values({
        id,
        budgetId,
        transactionId,
        storageKey: attachmentKey(budgetId, id),
        fileName: cleanFileName(file.name, type),
        contentType: type,
        byteSize: bytes.byteLength,
      })
      .returning();
    if (!inserted) throw new Error("insert returned no row");
    // Last, so a failed upload rolls the row back; the file is only kept if this commits (a
    // commit failing after it leaves an unreferenced file, which nothing shows).
    await storage.put(inserted.storageKey, bytes, type);
    return inserted;
  });
  return c.json(attachmentJson(row), 201);
};

export const getAttachmentHandler: RouteHandler<typeof getAttachment, Env> = async (c) => {
  const { budgetId, transactionId } = c.req.valid("param");
  const download = c.req.valid("query").download === "true";
  await loadBudgetAccess(c, budgetId);
  const storage = requireStorage(c.var.deps.storage);
  const attachment = await findShown(c.var.deps.db, budgetId, transactionId);
  if (!attachment) throw new AppError(404, "NOT_FOUND", "This transaction has no attachment");
  return serveStored(c, storage, attachment.storageKey, {
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    download,
    // Kept by the browser for less time than a signed link lasts.
    maxAgeSeconds: 240,
  });
};

export const deleteAttachmentHandler: RouteHandler<typeof deleteAttachment, Env> = async (c) => {
  const { budgetId, transactionId } = c.req.valid("param");
  const { db, jobs } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { transaction: ["update"] });
  const attachment = await findShown(db, budgetId, transactionId);
  if (!attachment) throw new AppError(404, "NOT_FOUND", "This transaction has no attachment");
  // A trigger queues its file for deletion; the job deletes it once this commits.
  await db.delete(transactionAttachment).where(eq(transactionAttachment.id, attachment.id));
  await jobs.send(db, "storage.purge", null);
  return c.body(null, 204);
};
