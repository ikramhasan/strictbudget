import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * The token in a monthly summary's unsubscribe links: the user's id and an HMAC of it under a key
 * derived from the app secret. It only turns that person's summaries off, so it doesn't expire
 * (an old email's link keeps working, as mail clients expect of `List-Unsubscribe`).
 */
const PURPOSE = "email.unsubscribe";

function mac(userId: string, secret: string) {
  const key = Buffer.from(hkdfSync("sha256", secret, "strictbudget.unsubscribe", PURPOSE, 32));
  return createHmac("sha256", key).update(userId).digest();
}

export function unsubscribeToken(userId: string, secret: string): string {
  return `${Buffer.from(userId).toString("base64url")}.${mac(userId, secret).toString("base64url")}`;
}

/** The user the token was made for, or null when it isn't one of ours. */
export function unsubscribeTokenUser(token: string, secret: string): string | null {
  const [id, sig, ...rest] = token.split(".");
  if (!id || !sig || rest.length > 0) return null;
  const userId = Buffer.from(id, "base64url").toString("utf8");
  const given = Buffer.from(sig, "base64url");
  const expected = mac(userId, secret);
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}
