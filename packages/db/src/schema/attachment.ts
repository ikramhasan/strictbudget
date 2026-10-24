import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { budgetAccount, transaction } from "./account";
import { user } from "./auth";
import { budget } from "./budget";
import { timestamps } from "./columns";

/**
 * A transaction's attachment (a photo or PDF): one per transaction, and one per transfer, shared
 * by its two sides (it hangs off the side it was added
 * on). The file itself is in object storage under `storageKey`.
 */
export const transactionAttachment = pgTable(
  "transaction_attachment",
  {
    id: text().primaryKey(),
    budgetId: text()
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    transactionId: text()
      .notNull()
      .references(() => transaction.id, { onDelete: "cascade" }),
    /** Where the file is in object storage; queued for deletion with the row (`storage_deletion`). */
    storageKey: text().notNull(),
    /** As uploaded, for downloads. */
    fileName: text().notNull(),
    contentType: text().notNull(),
    byteSize: integer().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("transaction_attachment_transaction_idx").on(t.transactionId)],
);

/**
 * Objects to delete from storage. A trigger adds a deleted attachment's key in the same database
 * transaction, however the row went (its transaction, account, budget or user deleted), so a
 * rolled-back delete keeps its file; the `storage.purge` job deletes them and their rows.
 */
export const storageDeletion = pgTable("storage_deletion", {
  storageKey: text().primaryKey(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * An account's logo: a square image shown before the account's name. Replaced by deleting the row
 * and adding another, so the old file is queued for deletion.
 * `id` names the version, for cache-safe URLs.
 */
export const accountLogo = pgTable("account_logo", {
  id: text().primaryKey(),
  accountId: text()
    .notNull()
    .unique()
    .references(() => budgetAccount.id, { onDelete: "cascade" }),
  budgetId: text()
    .notNull()
    .references(() => budget.id, { onDelete: "cascade" }),
  storageKey: text().notNull(),
  contentType: text().notNull(),
  byteSize: integer().notNull(),
  ...timestamps,
});

/**
 * A user's profile picture: a square image shown as a circle. Its URL is also kept
 * in Better Auth's `user.image`, so the session carries it.
 */
export const userAvatar = pgTable("user_avatar", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  storageKey: text().notNull(),
  contentType: text().notNull(),
  byteSize: integer().notNull(),
  ...timestamps,
});
