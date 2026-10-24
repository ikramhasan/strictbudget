import { bigint, boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "./columns";

// Better Auth core tables. Field names must match Better Auth's model fields exactly;
// column names come out snake_case via the shared `casing` setting.

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  /** Added by the two-factor plugin. */
  twoFactorEnabled: boolean().default(false),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    /** Added by the organization plugin; unused (the current budget lives in the URL). */
    activeOrganizationId: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** Better Auth's rate limiter (`rateLimit.storage: "database"`), so limits hold across restarts and instances. */
export const rateLimit = pgTable("rate_limit", {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  /** Epoch milliseconds, as Better Auth writes it. */
  lastRequest: bigint({ mode: "number" }).notNull(),
});

/**
 * Counters for limits Better Auth doesn't cover (per-recipient email sends, password checks on
 * our own routes), kept by rate-limiter-flexible's Drizzle store. Its column names are fixed.
 */
export const throttle = pgTable("throttle", {
  key: text().primaryKey(),
  points: integer().notNull().default(0),
  expire: timestamp({ withTimezone: true }),
});

/**
 * The two-factor plugin's TOTP secret and backup codes (both encrypted by Better Auth). One row per
 * user with two-step verification set up; `verified` turns true once a first code is confirmed.
 */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text().primaryKey(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean().default(true),
    failedVerificationCount: integer().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("two_factor_user_id_idx").on(t.userId),
    index("two_factor_secret_idx").on(t.secret),
  ],
);

/**
 * The api-key plugin's keys (personal API keys). `key` is the SHA-256 hash; the key
 * itself is shown once, on creation. `start` is its first characters, so a list can tell keys
 * apart. `permissions` (JSON) holds the key's scope, written and read by `lib/api-keys.ts`.
 * Better Auth's per-key rate limit is off (`rateLimitEnabled` false): ours is in `lib/throttle.ts`.
 */
export const apiKey = pgTable(
  "api_key",
  {
    id: text().primaryKey(),
    configId: text().notNull().default("default"),
    name: text(),
    start: text(),
    prefix: text(),
    key: text().notNull(),
    /** The owning user's id (`references: "user"`). */
    referenceId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    refillInterval: integer(),
    refillAmount: integer(),
    lastRefillAt: timestamp({ withTimezone: true }),
    enabled: boolean().default(true),
    rateLimitEnabled: boolean().default(true),
    rateLimitTimeWindow: integer(),
    rateLimitMax: integer(),
    requestCount: integer().default(0),
    remaining: integer(),
    lastRequest: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    permissions: text(),
    metadata: text(),
    ...timestamps,
  },
  (t) => [
    index("api_key_key_idx").on(t.key),
    index("api_key_reference_id_idx").on(t.referenceId),
    index("api_key_config_id_idx").on(t.configId),
  ],
);
