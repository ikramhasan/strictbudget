import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encrypts JSON for storage the app writes and reads back itself (queued emails, whose links carry
 * sign-in and reset tokens). AES-256-GCM with a key derived from the app secret, so a database
 * dump alone doesn't reveal them. `purpose` separates keys, so one sealed value can't be opened as
 * another kind.
 *
 * Not jose's JWE: the key derivation (HKDF from the app secret) would still be ours, and the
 * values are internal and short-lived (a queued email lives minutes), so no token format needs
 * to interoperate. node:crypto does the cryptography; this only frames IV, tag and ciphertext.
 */
export function seal(value: unknown, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Opens a value from `seal`; throws if it was sealed with another secret or purpose, or altered. */
export function unseal<T>(sealed: string, secret: string, purpose: string): T {
  const raw = Buffer.from(sealed, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(secret, purpose), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const body = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  return JSON.parse(body.toString("utf8")) as T;
}

function key(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "strictbudget.sealed", purpose, 32));
}
