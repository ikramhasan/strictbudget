import type { Database } from "@strictbudget/db";
import { oauthClient } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { createLocalJWKSet, type JSONWebKeySet, type JWTPayload, jwtVerify } from "jose";
import type { Env } from "../../env";
import { type AgentPrincipal, agentUser, connectAgent } from "./principal";

/**
 * What an MCP client may ask for: reading the person's budgets, and changing them. Consent can
 * grant read alone; every write operation needs `strictbudget:write`.
 */
export const MCP_READ_SCOPE = "strictbudget:read";
export const MCP_WRITE_SCOPE = "strictbudget:write";
export const MCP_SCOPES = [MCP_READ_SCOPE, MCP_WRITE_SCOPE] as const;

/** The MCP endpoint's URL: the OAuth resource its access tokens are issued for. */
export const mcpResource = (env: Pick<Env, "BETTER_AUTH_URL">) =>
  `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/mcp`;

/** Where MCP clients find out how to get a token (RFC 9728), from a 401's challenge. */
export const mcpResourceMetadataUrl = (env: Pick<Env, "BETTER_AUTH_URL">) =>
  `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/.well-known/oauth-protected-resource/mcp`;

type Verified = { ok: true; principal: AgentPrincipal } | { ok: false; response: Response };

/**
 * Verifies MCP requests' bearer tokens: JWTs signed with the jwt plugin's keys, for this resource,
 * from this issuer, for a user who can still sign in and a client they haven't disconnected.
 */
export class McpAuth {
  #jwks: ReturnType<typeof createLocalJWKSet> | null = null;

  constructor(
    private readonly env: Env,
    private readonly db: Database,
    /** Reads the jwt plugin's public keys (`GET /api/auth/jwks`), in-process. */
    private readonly fetchJwks: () => Promise<JSONWebKeySet>,
  ) {}

  #challenge(status: 401 | 403, error: string, description: string): Response {
    const params = [
      `error="${error}"`,
      `error_description="${description}"`,
      `resource_metadata="${mcpResourceMetadataUrl(this.env)}"`,
      `scope="${MCP_SCOPES.join(" ")}"`,
    ];
    return Response.json(
      { error, error_description: description },
      { status, headers: { "www-authenticate": `Bearer ${params.join(", ")}` } },
    );
  }

  async #verify(token: string): Promise<JWTPayload> {
    const options = {
      issuer: `${this.env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/auth`,
      audience: mcpResource(this.env),
    };
    if (!this.#jwks) this.#jwks = createLocalJWKSet(await this.fetchJwks());
    try {
      return (await jwtVerify(token, this.#jwks, options)).payload;
    } catch (error) {
      // A key made since the set was read (keys rotate): read it again once.
      if ((error as { code?: string }).code !== "ERR_JWKS_NO_MATCHING_KEY") throw error;
      this.#jwks = createLocalJWKSet(await this.fetchJwks());
      return (await jwtVerify(token, this.#jwks, options)).payload;
    }
  }

  async verify(request: Request): Promise<Verified> {
    const header = request.headers.get("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
    if (!token) {
      return {
        ok: false,
        response: this.#challenge(401, "invalid_token", "Sign in to strictbudget"),
      };
    }
    let claims: JWTPayload;
    try {
      claims = await this.#verify(token);
    } catch {
      return {
        ok: false,
        response: this.#challenge(401, "invalid_token", "The access token isn't valid"),
      };
    }
    const scopes = new Set(typeof claims.scope === "string" ? claims.scope.split(" ") : []);
    const clientId = typeof claims.client_id === "string" ? claims.client_id : claims.azp;
    if (!claims.sub || typeof clientId !== "string") {
      return { ok: false, response: this.#challenge(401, "invalid_token", "Not a user's token") };
    }
    if (!scopes.has(MCP_READ_SCOPE) && !scopes.has(MCP_WRITE_SCOPE)) {
      return {
        ok: false,
        response: this.#challenge(
          403,
          "insufficient_scope",
          "Access to strictbudget wasn't granted",
        ),
      };
    }
    const user = await agentUser(this.db, claims.sub);
    if (!user) {
      return { ok: false, response: this.#challenge(401, "invalid_token", "The user is gone") };
    }
    const [client] = await this.db
      .select({ name: oauthClient.name, disabled: oauthClient.disabled })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId));
    if (!client || client.disabled) {
      return { ok: false, response: this.#challenge(401, "invalid_token", "Unknown client") };
    }
    const agent = await connectAgent(this.db, {
      userId: user.id,
      kind: "mcp",
      externalId: clientId,
      name: client.name ?? clientName(clientId),
      authorizedAt: new Date((claims.iat ?? 0) * 1000),
    });
    if (!agent) {
      return {
        ok: false,
        response: this.#challenge(
          401,
          "invalid_token",
          "This app was disconnected from strictbudget",
        ),
      };
    }
    return { ok: true, principal: { user, agent, canWrite: scopes.has(MCP_WRITE_SCOPE) } };
  }
}

/** A client without a name: its metadata URL's host, or its id. */
function clientName(clientId: string): string {
  try {
    return new URL(clientId).host;
  } catch {
    return "MCP client";
  }
}
