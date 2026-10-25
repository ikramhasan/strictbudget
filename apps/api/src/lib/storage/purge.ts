import { aiAttachment, storageDeletion } from "@strictbudget/db/schema";
import { and, asc, inArray, isNull, lt, sql } from "drizzle-orm";
import type { JobHandler } from "../jobs";
import { log } from "../log";

const BATCH = 500;

/** Files uploaded for the AI assistant but never sent are kept this long. */
const UNSENT_AI_FILE_HOURS = 24;

/**
 * Deletes the files of deleted attachments (queued in `storage_deletion` by a trigger) from object
 * storage, then their queue rows. Deleting is idempotent, so a key two runs both take is fine.
 * Without storage (attachments off), the queue waits for it. AI files never sent are deleted first.
 */
export const purgeStorage: JobHandler<"storage.purge"> = async ({ db, storage }) => {
  if (!storage) return;
  // Files picked for an AI message that was never sent; their trigger queues them below.
  await db
    .delete(aiAttachment)
    .where(
      and(
        isNull(aiAttachment.conversationId),
        lt(aiAttachment.createdAt, sql`now() - ${`${UNSENT_AI_FILE_HOURS} hours`}::interval`),
      ),
    );
  for (;;) {
    const rows = await db
      .select({ key: storageDeletion.storageKey })
      .from(storageDeletion)
      .orderBy(asc(storageDeletion.createdAt))
      .limit(BATCH);
    if (rows.length === 0) return;
    const keys = rows.map((r) => r.key);
    await storage.delete(keys);
    await db.delete(storageDeletion).where(inArray(storageDeletion.storageKey, keys));
    log.info("Deleted stored files", { count: keys.length });
    if (rows.length < BATCH) return;
  }
};
