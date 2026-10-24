import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { session, user } from "./auth";
import { timestamps } from "./columns";

// Tables for agents: Better Auth's jwt, OAuth provider (through the MCP plugin) and Agent Auth
// plugins, then our own `connected_agent`. As in auth.ts, field names must match the plugins' model
// fields exactly; columns come out snake_case. Plugin timestamps the plugin sets itself still get a
// database default, which it overwrites.

const at = () => timestamp({ withTimezone: true });

/** The jwt plugin's signing keys (the private key encrypted by Better Auth). Signs OAuth tokens. */
export const jwks = pgTable("jwks", {
  id: text().primaryKey(),
  publicKey: text().notNull(),
  privateKey: text().notNull(),
  createdAt: at().notNull().defaultNow(),
  expiresAt: at(),
  alg: text(),
  crv: text(),
});

/** An OAuth client: an MCP client such as Claude Code, registered dynamically or by metadata URL. */
export const oauthClient = pgTable(
  "oauth_client",
  {
    id: text().primaryKey(),
    clientId: text().notNull().unique(),
    clientSecret: text(),
    clientDiscoveryId: text(),
    disabled: boolean().default(false),
    skipConsent: boolean(),
    enableEndSession: boolean(),
    subjectType: text(),
    scopes: text().array(),
    clientCredentialsScopes: text().array().default([]),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    createdAt: at().defaultNow(),
    updatedAt: at().defaultNow(),
    name: text(),
    uri: text(),
    icon: text(),
    contacts: text().array(),
    tos: text(),
    policy: text(),
    softwareId: text(),
    softwareVersion: text(),
    softwareStatement: text(),
    redirectUris: text().array().notNull(),
    postLogoutRedirectUris: text().array(),
    backchannelLogoutUri: text(),
    backchannelLogoutSessionRequired: boolean(),
    tokenEndpointAuthMethod: text(),
    applicationType: text(),
    jwks: text(),
    jwksUri: text(),
    grantTypes: text().array(),
    responseTypes: text().array(),
    requirePKCE: boolean(),
    dpopBoundAccessTokens: boolean().default(false),
    referenceId: text(),
    metadata: jsonb(),
  },
  (t) => [index("oauth_client_user_id_idx").on(t.userId)],
);

/** A protected resource tokens can be issued for (the MCP endpoint). */
export const oauthResource = pgTable("oauth_resource", {
  id: text().primaryKey(),
  identifier: text().notNull().unique(),
  name: text().notNull(),
  accessTokenTtl: integer(),
  refreshTokenTtl: integer(),
  signingAlgorithm: text(),
  signingKeyId: text(),
  allowedScopes: text().array(),
  customClaims: jsonb(),
  dpopBoundAccessTokensRequired: boolean().default(false),
  disabled: boolean().default(false),
  createdAt: at().defaultNow(),
  updatedAt: at().defaultNow(),
  policyVersion: integer().default(1),
  metadata: jsonb(),
});

export const oauthClientResource = pgTable(
  "oauth_client_resource",
  {
    id: text().primaryKey(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text()
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: jsonb(),
    createdAt: at().defaultNow(),
  },
  (t) => [
    uniqueIndex("oauth_client_resource_client_resource_idx").on(t.clientId, t.resourceId),
    index("oauth_client_resource_resource_id_idx").on(t.resourceId),
  ],
);

export const oauthRefreshToken = pgTable(
  "oauth_refresh_token",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text().references(() => session.id, { onDelete: "set null" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text(),
    authorizationCodeId: text(),
    resources: text().array(),
    requestedUserInfoClaims: text().array(),
    expiresAt: at(),
    createdAt: at().defaultNow(),
    revoked: at(),
    rotatedAt: at(),
    rotationReplayResponse: text(),
    rotationReplayExpiresAt: at(),
    authTime: at(),
    confirmation: jsonb(),
    scopes: text().array().notNull(),
  },
  (t) => [
    index("oauth_refresh_token_client_id_idx").on(t.clientId),
    index("oauth_refresh_token_user_id_idx").on(t.userId),
    index("oauth_refresh_token_authorization_code_id_idx").on(t.authorizationCodeId),
  ],
);

export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: text().primaryKey(),
    token: text().unique(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text().references(() => session.id, { onDelete: "set null" }),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    referenceId: text(),
    authorizationCodeId: text(),
    resources: text().array(),
    requestedUserInfoClaims: text().array(),
    refreshId: text().references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    expiresAt: at(),
    createdAt: at().defaultNow(),
    revoked: at(),
    confirmation: jsonb(),
    scopes: text().array().notNull(),
  },
  (t) => [
    index("oauth_access_token_client_id_idx").on(t.clientId),
    index("oauth_access_token_user_id_idx").on(t.userId),
    index("oauth_access_token_refresh_id_idx").on(t.refreshId),
  ],
);

/** What a user agreed a client may do (its scopes), so it isn't asked again. */
export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: text().primaryKey(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    referenceId: text(),
    resources: text().array(),
    requestedUserInfoClaims: text().array(),
    scopes: text().array().notNull(),
    createdAt: at().defaultNow(),
    updatedAt: at().defaultNow(),
  },
  (t) => [
    index("oauth_consent_client_id_idx").on(t.clientId),
    index("oauth_consent_user_id_idx").on(t.userId),
  ],
);

/** Client assertion ids already used (replay protection for private_key_jwt). */
export const oauthClientAssertion = pgTable("oauth_client_assertion", {
  id: text().primaryKey(),
  expiresAt: at().notNull(),
});

/** Agent Auth: a host (an agent runtime, e.g. a CLI install) that agents register under. */
export const agentHost = pgTable(
  "agent_host",
  {
    id: text().primaryKey(),
    name: text(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    /** JSON, as the plugin writes it. */
    defaultCapabilities: text(),
    publicKey: text(),
    kid: text(),
    jwksUrl: text(),
    enrollmentTokenHash: text(),
    enrollmentTokenExpiresAt: at(),
    status: text().notNull().default("active"),
    activatedAt: at(),
    expiresAt: at(),
    lastUsedAt: at(),
    ...timestamps,
  },
  (t) => [
    index("agent_host_user_id_idx").on(t.userId),
    index("agent_host_kid_idx").on(t.kid),
    index("agent_host_enrollment_token_hash_idx").on(t.enrollmentTokenHash),
    index("agent_host_status_idx").on(t.status),
  ],
);

/** Agent Auth: an agent acting for a user with the capabilities they granted it. */
export const agent = pgTable(
  "agent",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    hostId: text()
      .notNull()
      .references(() => agentHost.id, { onDelete: "cascade" }),
    status: text().notNull().default("active"),
    mode: text().notNull().default("delegated"),
    publicKey: text().notNull(),
    kid: text(),
    jwksUrl: text(),
    lastUsedAt: at(),
    activatedAt: at(),
    expiresAt: at(),
    /** JSON, as the plugin writes it. */
    metadata: text(),
    ...timestamps,
  },
  (t) => [
    index("agent_user_id_idx").on(t.userId),
    index("agent_host_id_idx").on(t.hostId),
    index("agent_kid_idx").on(t.kid),
    index("agent_status_idx").on(t.status),
  ],
);

export const agentCapabilityGrant = pgTable(
  "agent_capability_grant",
  {
    id: text().primaryKey(),
    agentId: text()
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    capability: text().notNull(),
    deniedBy: text().references(() => user.id, { onDelete: "cascade" }),
    grantedBy: text().references(() => user.id, { onDelete: "cascade" }),
    expiresAt: at(),
    status: text().notNull().default("active"),
    reason: text(),
    /** JSON, as the plugin writes it. */
    constraints: text(),
    ...timestamps,
  },
  (t) => [
    index("agent_capability_grant_agent_id_idx").on(t.agentId),
    index("agent_capability_grant_capability_idx").on(t.capability),
    index("agent_capability_grant_granted_by_idx").on(t.grantedBy),
    index("agent_capability_grant_status_idx").on(t.status),
  ],
);

/** Agent Auth: a pending request for a user to approve an agent's capabilities. */
export const approvalRequest = pgTable(
  "approval_request",
  {
    id: text().primaryKey(),
    method: text().notNull(),
    agentId: text().references(() => agent.id, { onDelete: "cascade" }),
    hostId: text().references(() => agentHost.id, { onDelete: "cascade" }),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    capabilities: text(),
    status: text().notNull().default("pending"),
    userCodeHash: text(),
    loginHint: text(),
    bindingMessage: text(),
    clientNotificationToken: text(),
    clientNotificationEndpoint: text(),
    deliveryMode: text(),
    interval: integer().notNull(),
    lastPolledAt: at(),
    expiresAt: at().notNull(),
    ...timestamps,
  },
  (t) => [
    index("approval_request_agent_id_idx").on(t.agentId),
    index("approval_request_host_id_idx").on(t.hostId),
    index("approval_request_user_id_idx").on(t.userId),
    index("approval_request_status_idx").on(t.status),
  ],
);

/** `in_app`: the budget AI assistant in strictbudget itself, acting for the signed-in person. */
export const CONNECTED_AGENT_KINDS = ["mcp", "agent_auth", "in_app"] as const;
export type ConnectedAgentKind = (typeof CONNECTED_AGENT_KINDS)[number];

/**
 * An agent acting for a user, whichever way it signed in: an MCP client (an OAuth client, by
 * client id), an Agent Auth agent (by agent id), or the in-app AI assistant (`in_app`). Changes it
 * makes are attributed to it and its user (`audit_event.actor_agent_id`,
 * `transaction.created_by_agent_id`), so its name and kind are
 * kept here even once the client or agent is revoked. Deleted with its user.
 */
export const connectedAgent = pgTable(
  "connected_agent",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text({ enum: CONNECTED_AGENT_KINDS }).notNull(),
    /** The OAuth client id (`mcp`), the Agent Auth agent id (`agent_auth`), or `strictbudget` (`in_app`). */
    externalId: text().notNull(),
    name: text().notNull(),
    lastUsedAt: at().notNull().defaultNow(),
    /** Set when the user disconnects it; its grants and tokens are gone by then. */
    revokedAt: at(),
    ...timestamps,
  },
  (t) => [uniqueIndex("connected_agent_user_kind_external_idx").on(t.userId, t.kind, t.externalId)],
);
