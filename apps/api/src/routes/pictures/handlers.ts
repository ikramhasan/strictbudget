import type { RouteHandler } from "@hono/zod-openapi";
import { newId } from "@strictbudget/db";
import {
  accountLogo,
  budgetAccount,
  budgetMember,
  user,
  userAvatar,
} from "@strictbudget/db/schema";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { loadBudgetAccess } from "../../lib/budget-access";
import { AppError } from "../../lib/errors";
import type { Db } from "../../lib/ledger";
import { accountLogoKey, userAvatarKey } from "../../lib/storage";
import {
  MAX_PICTURE_BYTES,
  PICTURE_CACHE_SECONDS,
  PICTURE_LINK_SECONDS,
  readPicture,
} from "../../lib/storage/images";
import { requireStorage, serveStored } from "../../lib/storage/serve";
import type { AuthedEnv } from "../../middleware/require-auth";
import type { AppEnv } from "../../types";
import type {
  deleteAccountLogo,
  deleteProfilePicture,
  getAccountLogo,
  getProfilePicture,
  setAccountLogo,
  setProfilePicture,
} from "./routes";

type Env = AppEnv & AuthedEnv;

/** The whole request, multipart framing included, refused before it's read past this. */
export const pictureBodyLimit: MiddlewareHandler<Env> = bodyLimit({
  maxSize: MAX_PICTURE_BYTES + 64 * 1024,
  onError: () => {
    throw new AppError(413, "FILE_TOO_LARGE", "Pictures can be at most 2 MB");
  },
});

export const profilePictureUrl = (userId: string, avatarId: string) =>
  `/v1/users/${userId}/picture?v=${avatarId}`;

export const accountLogoUrl = (budgetId: string, accountId: string, logoId: string) =>
  `/v1/budgets/${budgetId}/accounts/${accountId}/logo?v=${logoId}`;

export async function accountLogoUrls(db: Db, budgetId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: accountLogo.id, accountId: accountLogo.accountId })
    .from(accountLogo)
    .where(eq(accountLogo.budgetId, budgetId));
  return new Map(rows.map((r) => [r.accountId, accountLogoUrl(budgetId, r.accountId, r.id)]));
}

const pictureName = (type: string) => `picture.${type.split("/")[1]}`;

export const setProfilePictureHandler: RouteHandler<typeof setProfilePicture, Env> = async (c) => {
  const { file } = c.req.valid("form");
  const { db } = c.var.deps;
  const storage = requireStorage(c.var.deps.storage);
  const { bytes, type } = await readPicture(file);
  const userId = c.var.user.id;
  const id = newId();
  const key = userAvatarKey(userId, id);
  await storage.put(key, bytes, type);
  const url = profilePictureUrl(userId, id);
  try {
    await db.transaction(async (tx) => {
      // The old one's file is queued for deletion by the trigger.
      await tx.delete(userAvatar).where(eq(userAvatar.userId, userId));
      await tx.insert(userAvatar).values({
        id,
        userId,
        storageKey: key,
        contentType: type,
        byteSize: bytes.byteLength,
      });
      await tx.update(user).set({ image: url }).where(eq(user.id, userId));
    });
  } catch (e) {
    await storage.delete([key]);
    throw e;
  }
  await c.var.deps.jobs.send(db, "storage.purge", null);
  return c.json({ url }, 200);
};

export const deleteProfilePictureHandler: RouteHandler<typeof deleteProfilePicture, Env> = async (
  c,
) => {
  const { db } = c.var.deps;
  const userId = c.var.user.id;
  await db.transaction(async (tx) => {
    await tx.delete(userAvatar).where(eq(userAvatar.userId, userId));
    await tx.update(user).set({ image: null }).where(eq(user.id, userId));
  });
  await c.var.deps.jobs.send(db, "storage.purge", null);
  return c.body(null, 204);
};

export const getProfilePictureHandler: RouteHandler<typeof getProfilePicture, Env> = async (c) => {
  const { userId } = c.req.valid("param");
  const { db } = c.var.deps;
  const storage = requireStorage(c.var.deps.storage);
  const me = c.var.user.id;
  if (userId !== me) {
    // Only people you share a budget with: theirs show in its Activity and moves.
    const mine = alias(budgetMember, "mine");
    const [shared] = await db
      .select({ id: budgetMember.id })
      .from(budgetMember)
      .innerJoin(mine, and(eq(mine.budgetId, budgetMember.budgetId), eq(mine.userId, me)))
      .where(eq(budgetMember.userId, userId))
      .limit(1);
    if (!shared) throw new AppError(404, "NOT_FOUND", "No such picture");
  }
  const [picture] = await db.select().from(userAvatar).where(eq(userAvatar.userId, userId));
  if (!picture) throw new AppError(404, "NOT_FOUND", "No such picture");
  return serveStored(c, storage, picture.storageKey, {
    fileName: pictureName(picture.contentType),
    contentType: picture.contentType,
    download: false,
    expiresInSeconds: PICTURE_LINK_SECONDS,
    maxAgeSeconds: PICTURE_CACHE_SECONDS,
  });
};

async function findAccountId(db: Db, budgetId: string, accountId: string) {
  const [account] = await db
    .select({ id: budgetAccount.id })
    .from(budgetAccount)
    .where(and(eq(budgetAccount.id, accountId), eq(budgetAccount.budgetId, budgetId)));
  if (!account) throw new AppError(404, "NOT_FOUND", "Account not found");
  return account.id;
}

export const setAccountLogoHandler: RouteHandler<typeof setAccountLogo, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { file } = c.req.valid("form");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { account: ["update"] });
  const storage = requireStorage(c.var.deps.storage);
  await findAccountId(db, budgetId, accountId);
  const { bytes, type } = await readPicture(file);
  const id = newId();
  const key = accountLogoKey(budgetId, accountId, id);
  // The old logo's file is queued for deletion by the trigger.
  await db.delete(accountLogo).where(eq(accountLogo.accountId, accountId));
  await db.insert(accountLogo).values({
    id,
    accountId,
    budgetId,
    storageKey: key,
    contentType: type,
    byteSize: bytes.byteLength,
  });
  // Last, so a failed upload rolls the rows back (this request is one database transaction).
  await storage.put(key, bytes, type);
  await c.var.deps.jobs.send(db, "storage.purge", null);
  return c.json({ url: accountLogoUrl(budgetId, accountId, id) }, 200);
};

export const deleteAccountLogoHandler: RouteHandler<typeof deleteAccountLogo, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId, { account: ["update"] });
  await findAccountId(db, budgetId, accountId);
  await db.delete(accountLogo).where(eq(accountLogo.accountId, accountId));
  await c.var.deps.jobs.send(db, "storage.purge", null);
  return c.body(null, 204);
};

export const getAccountLogoHandler: RouteHandler<typeof getAccountLogo, Env> = async (c) => {
  const { budgetId, accountId } = c.req.valid("param");
  const { db } = c.var.deps;
  await loadBudgetAccess(c, budgetId);
  const storage = requireStorage(c.var.deps.storage);
  const [logo] = await db
    .select()
    .from(accountLogo)
    .where(and(eq(accountLogo.accountId, accountId), eq(accountLogo.budgetId, budgetId)));
  if (!logo) throw new AppError(404, "NOT_FOUND", "This account has no logo");
  return serveStored(c, storage, logo.storageKey, {
    fileName: pictureName(logo.contentType),
    contentType: logo.contentType,
    download: false,
    expiresInSeconds: PICTURE_LINK_SECONDS,
    maxAgeSeconds: PICTURE_CACHE_SECONDS,
  });
};
