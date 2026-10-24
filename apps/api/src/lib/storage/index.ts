import { resolve } from "node:path";
import type { Env } from "../../env";
import { DiskStorage } from "./disk";
import { MemoryStorage } from "./memory";
import { S3Storage } from "./s3";

export { DiskStorage } from "./disk";
export { MemoryStorage } from "./memory";
export { S3Storage } from "./s3";

export interface ServeOptions {
  fileName: string;
  contentType: string;
  /** Save it (Content-Disposition: attachment) rather than show it inline. */
  download: boolean;
  /** How long a signed link works (default 5 minutes). */
  expiresInSeconds?: number;
}

/**
 * Where uploaded files (transaction attachments) live: an S3-compatible bucket in production
 * (Railway Buckets), a directory on local disk in development, memory in tests. Keys are ours
 * (`attachmentKey`), never a user's file name.
 */
export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /**
   * A short-lived URL the browser fetches the object from directly, or null when the API serves
   * the bytes itself (`get`).
   */
  signedUrl(key: string, options: ServeOptions): Promise<string | null>;
  /** Deletes the objects; keys with no object are fine. */
  delete(keys: readonly string[]): Promise<void>;
}

/** A transaction attachment's object key: one prefix per budget, the attachment's own id. */
export const attachmentKey = (budgetId: string, attachmentId: string) =>
  `budgets/${budgetId}/attachments/${attachmentId}`;

/** An account logo's object key (each version its own). */
export const accountLogoKey = (budgetId: string, accountId: string, logoId: string) =>
  `budgets/${budgetId}/accounts/${accountId}/logo/${logoId}`;

export const aiAttachmentKey = (budgetId: string, attachmentId: string) =>
  `budgets/${budgetId}/ai-attachments/${attachmentId}`;

/** A profile picture's object key (each version its own). */
export const userAvatarKey = (userId: string, avatarId: string) =>
  `users/${userId}/avatar/${avatarId}`;

/**
 * The bucket when `S3_*` is set; otherwise `STORAGE_DIR` on disk (development defaults to
 * `.storage` in the working directory). Production with neither has no storage: attachments are
 * turned off rather than kept on a container's disk, which a redeploy wipes.
 */
export function createStorage(env: Env): ObjectStorage | null {
  if (env.NODE_ENV === "test") return new MemoryStorage();
  if (env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    return new S3Storage({
      bucket: env.S3_BUCKET,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  if (env.STORAGE_DIR) return new DiskStorage(resolve(env.STORAGE_DIR));
  if (env.NODE_ENV === "development") return new DiskStorage(resolve(".storage"));
  return null;
}
