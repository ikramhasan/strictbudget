import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { apiBaseUrl } from "./api";
import { sessionQueryOptions } from "./session";

/**
 * The OAuth parameters Better Auth signs onto its login and consent redirects (`…&exp&ba_iat&
 * ba_param&sig`). The consent call sends the query back as it came (`oauth_query`); signing in
 * again restarts authorization with the client's own parameters, without them.
 */
const SIGNATURE_PARAMS = ["exp", "ba_iat", "ba_param", "sig"];

/** The client's authorization request again, for the API's /oauth2/authorize, once signed in. */
export function authorizeUrl(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of SIGNATURE_PARAMS) params.delete(key);
  // Signed in now: asking to sign in again would come straight back here.
  const prompt = (params.get("prompt") ?? "").split(" ").filter((p) => p && p !== "login");
  if (prompt.length) params.set("prompt", prompt.join(" "));
  else params.delete("prompt");
  return `${apiBaseUrl}/api/auth/oauth2/authorize?${params}`;
}

/** Sends a signed-out person to sign in first, then back to this page (query included). */
export async function requireSignIn(queryClient: QueryClient, href: string) {
  const session = await queryClient.ensureQueryData(sessionQueryOptions);
  if (!session) throw redirect({ to: "/sign-in", search: { redirect: href } });
  return session;
}

/** A Better Auth endpoint under /api/auth, as JSON; throws its message on failure. */
export async function authPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl}/api/auth${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const message =
      (data && (data.message ?? data.error_description ?? data.error)) || "Something went wrong";
    throw new Error(String(message));
  }
  return data as T;
}

export async function authGet<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBaseUrl}/api/auth${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export const mcpServerUrl = () => `${apiBaseUrl}/mcp`;

/**
 * What a person pastes into their agent to connect it: the MCP server to add (with the Claude
 * Code command, the most common client), the sign-in it should expect, and a first call that
 * proves it works. Agent Auth agents get the discovery document instead.
 */
export function agentSetupPrompt(origin: string = apiBaseUrl): string {
  const mcp = `${origin}/mcp`;
  return [
    "Connect yourself to my strictbudget budget so you can help me with it.",
    "",
    `1. Add strictbudget as a remote MCP server (Streamable HTTP, OAuth sign-in) named "strictbudget" at ${mcp}`,
    `   - Claude Code: run \`claude mcp add --transport http strictbudget ${mcp}\`, then open /mcp and authenticate.`,
    "   - Other clients: add it to your MCP settings as a remote/HTTP server with that URL.",
    `   - If your client limits how many tools a server may have (Cursor warns past about 40), use ${mcp}?tools=compact instead: three tools to search, describe and call strictbudget's operations.`,
    "2. When a browser opens, I'll sign in to strictbudget and choose whether you can make changes.",
    "3. Then call listBudgets and tell me which budgets you can see.",
    "",
    `If you support the Agent Auth protocol instead of MCP, start from ${origin}/.well-known/agent-configuration and send me the approval link it gives you.`,
    "",
    'Money amounts in strictbudget are integer strings in the currency\'s minor units ("-1250" is -12.50). Your changes show as yours, made on my behalf.',
  ].join("\n");
}
