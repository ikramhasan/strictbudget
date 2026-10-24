import { createHash, randomBytes, randomUUID } from "node:crypto";
import { newId } from "@strictbudget/db";
import { auditEvent, connectedAgent, oauthResource } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, one, resetDatabase, signUp } from "../../../test/helpers";
import { MemoryStorage } from "../../lib/storage";

/** Like a bucket: browsers are sent signed links. Agents must still get the bytes. */
class SigningStorage extends MemoryStorage {
  override async signedUrl(): Promise<string | null> {
    return "https://bucket.example/signed?X-Amz-Signature=x";
  }
}

const { app, db, env, close } = createTestApp({ storage: new SigningStorage() });
const MCP_URL = `${env.BETTER_AUTH_URL}/mcp`;
beforeEach(async () => {
  await resetDatabase(db);
  // The OAuth provider seeds its resource once per process, before the reset emptied it.
  await db
    .insert(oauthResource)
    .values({ id: newId(), identifier: MCP_URL, name: MCP_URL })
    .onConflictDoNothing();
});
afterAll(close);

const TODAY = "2026-10-01";
const REDIRECT = "http://127.0.0.1:43110/callback";
/** The smallest real PNG: a 1×1 transparent pixel. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

type MemberRef = { userId: string; agent: { id: string; name: string; kind: string } | null };
type Txn = { id: string; enteredBy: MemberRef | null; changedBy: MemberRef | null };
type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };

const json = async <T>(res: Response) => (await res.json()) as T;
function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json", origin: env.WEB_ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setup() {
  const owner = await signUp(app, { name: "Ada" });
  const budget = await createBudget(app, owner.cookie);
  const base = `/v1/budgets/${budget.id}`;
  const account = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, owner.cookie, {
      name: "Checking",
      type: "checking",
      balance: "0",
      date: TODAY,
    }),
  );
  return { owner, budget, base, account };
}

/**
 * An MCP client signing in the way Claude Code does: dynamic registration, then authorization
 * code with PKCE for the MCP resource, the person consenting in the web app.
 */
async function registerClient() {
  const registered = await json<{ client_id: string }>(
    await app.request("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test Agent",
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }),
  );
  expect(registered.client_id).toBeTruthy();
  return registered.client_id;
}

async function connectMcpClient(
  cookie: string,
  scope = "strictbudget:read strictbudget:write",
  existingClientId?: string,
) {
  const clientId = existingClientId ?? (await registerClient());
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: `openid offline_access ${scope}`,
    state: "s1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: MCP_URL,
  });
  // Signed out, the person is sent to the web app's sign-in step first.
  const signedOut = await app.request(`/api/auth/oauth2/authorize?${authorize}`);
  expect(signedOut.status).toBe(302);
  expect(signedOut.headers.get("location")).toMatch(`${env.WEB_ORIGIN}/oauth/authorize?`);
  // Signed in, to the consent page.
  const authorized = await app.request(`/api/auth/oauth2/authorize?${authorize}`, {
    headers: { cookie },
  });
  expect(authorized.status).toBe(302);
  const consentUrl = new URL(one(authorized.headers.get("location") ?? undefined, "location"));
  expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe(`${env.WEB_ORIGIN}/oauth/consent`);
  const consented = await send("POST", "/api/auth/oauth2/consent", cookie, {
    accept: true,
    scope,
    oauth_query: consentUrl.search.slice(1),
  });
  expect(consented.status).toBe(200);
  const { url } = await json<{ url: string }>(consented);
  const code = one(new URL(url).searchParams.get("code") ?? undefined, "code");
  const token = await app.request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: MCP_URL,
    }),
  });
  expect(token.status).toBe(200);
  const tokens = await json<{ access_token: string; refresh_token?: string; scope: string }>(token);
  return { clientId, accessToken: tokens.access_token };
}

/** A JSON-RPC answer, sent as JSON or as one SSE `message` event. */
async function rpc<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return JSON.parse(text) as T;
  }
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .find((line) => line.startsWith("{"));
  return JSON.parse(data ?? "null") as T;
}

let rpcId = 0;
async function mcp(accessToken: string | null, method: string, params: unknown = {}) {
  return app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
}
async function callTool(accessToken: string, name: string, args: unknown) {
  const res = await mcp(accessToken, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = await rpc<{ result: ToolResult; error?: unknown }>(res);
  return body.result;
}
const toolJson = <T>(result: ToolResult) => JSON.parse(result.content[0]?.text ?? "null") as T;

describe("MCP server", () => {
  it("asks for a token, and says where to get one", async () => {
    const res = await mcp(null, "tools/list");
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(
      `resource_metadata="${env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
    const metadata = await json<{ resource: string; authorization_servers: string[] }>(
      await app.request("/.well-known/oauth-protected-resource/mcp"),
    );
    expect(metadata.resource).toBe(MCP_URL);
    expect(metadata.authorization_servers).toEqual([`${env.BETTER_AUTH_URL}/api/auth`]);
    const server = await json<{ issuer: string; registration_endpoint: string }>(
      await app.request("/.well-known/oauth-authorization-server/api/auth"),
    );
    expect(server.issuer).toBe(`${env.BETTER_AUTH_URL}/api/auth`);
    expect(server.registration_endpoint).toBeTruthy();
  });

  it("refuses a token for another resource or a made-up one", async () => {
    expect((await mcp("not.a.jwt", "tools/list")).status).toBe(401);
  });

  it("runs the person's operations, attributed to the agent on their behalf", async () => {
    const { owner, budget, base, account } = await setup();
    const { accessToken } = await connectMcpClient(owner.cookie);

    const init = await mcp(accessToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    const tools = await rpc<{ result: { tools: { name: string; annotations: unknown }[] } }>(
      await mcp(accessToken, "tools/list"),
    );
    const names = tools.result.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["listBudgets", "createTransaction", "uploadAttachment"]),
    );
    // The person's own security and agent management aren't the agent's to run.
    for (const name of [
      "deleteMyAccount",
      "changeEmail",
      "listConnectedAgents",
      "streamBudgetEvents",
    ]) {
      expect(names).not.toContain(name);
    }

    const budgets = toolJson<{ budgets: { id: string }[] }>(
      await callTool(accessToken, "listBudgets", {}),
    );
    expect(budgets.budgets.map((b) => b.id)).toContain(budget.id);

    const created = await callTool(accessToken, "createTransaction", {
      budgetId: budget.id,
      body: {
        accountId: account.id,
        date: TODAY,
        amount: "-1250",
        categoryId: null,
        memo: "x-agent",
      },
    });
    expect(created.isError).toBeFalsy();
    const txn = toolJson<Txn>(created);
    expect(txn.enteredBy?.userId).toBe((await getMe(owner.cookie)).id);
    expect(txn.enteredBy?.agent).toMatchObject({ name: "Test Agent", kind: "mcp" });

    const attached = await callTool(accessToken, "uploadAttachment", {
      budgetId: budget.id,
      transactionId: txn.id,
      body: { file: { fileName: "receipt.png", base64: PNG_BASE64, contentType: "image/png" } },
    });
    expect(attached.isError).toBeFalsy();
    expect(toolJson<{ contentType: string }>(attached).contentType).toBe("image/png");
    const download = await callTool(accessToken, "getAttachment", {
      budgetId: budget.id,
      transactionId: txn.id,
    });
    expect(download.content[0]).toMatchObject({
      type: "image",
      data: PNG_BASE64,
      mimeType: "image/png",
    });
    // The browser gets the signed link; only agents are handed the file itself.
    const browser = await send("GET", `${base}/transactions/${txn.id}/attachment`, owner.cookie);
    expect(browser.status).toBe(302);

    // The person's own edit is theirs alone.
    const edited = await json<Txn>(
      await send("PATCH", `${base}/transactions/${txn.id}`, owner.cookie, { memo: "mine" }),
    );
    expect(edited.enteredBy?.agent?.name).toBe("Test Agent");
    expect(edited.changedBy?.agent).toBeNull();

    const events = await db.select().from(auditEvent).where(eq(auditEvent.rowId, txn.id));
    const insert = one(events.find((e) => e.op === "insert"));
    expect(insert.actorUserId).toBeTruthy();
    expect(insert.actorAgentId).toBe(txn.enteredBy?.agent?.id);
    const history = await json<{ events: { op: string; actor: MemberRef | null }[] }>(
      await send("GET", `${base}/transactions/${txn.id}/history`, owner.cookie),
    );
    expect(history.events[0]?.actor?.agent?.name).toBe("Test Agent");

    // Budgets too, though the organization plugin behind them wants a session.
    const made = await callTool(accessToken, "createBudget", {
      body: {
        name: "Agent's",
        currency: "USD",
        numberFormat: "comma_dot",
        currencySymbolPosition: "before",
        dateFormat: "MM/DD/YYYY",
      },
    });
    expect(made.isError).toBeFalsy();
    const madeId = toolJson<{ id: string; role: string }>(made).id;
    expect(toolJson<{ role: string }>(made).role).toBe("owner");
    expect((await callTool(accessToken, "deleteBudget", { budgetId: madeId })).isError).toBeFalsy();
    expect((await send("GET", `/v1/budgets/${madeId}`, owner.cookie)).status).toBe(404);

    // A missing path parameter is refused before anything runs.
    const blank = await callTool(accessToken, "listAccounts", { budgetId: "" });
    expect(toolJson<{ error: { code: string } }>(blank).error.code).toBe("INVALID_ARGUMENTS");

    // Errors come back as the API's own, as tool errors.
    const missing = await callTool(accessToken, "getBudget", { budgetId: "nope" });
    expect(missing.isError).toBe(true);
    expect(toolJson<{ error: { code: string } }>(missing).error.code).toBeTruthy();
  });

  it("gives read-only access only the operations that change nothing", async () => {
    const { owner, budget, account } = await setup();
    const { accessToken } = await connectMcpClient(owner.cookie, "strictbudget:read");
    const tools = await rpc<{ result: { tools: { name: string }[] } }>(
      await mcp(accessToken, "tools/list"),
    );
    const names = tools.result.tools.map((t) => t.name);
    expect(names).toContain("listTransactions");
    expect(names).not.toContain("createTransaction");
    const refused = await callTool(accessToken, "createTransaction", {
      budgetId: budget.id,
      body: { accountId: account.id, date: TODAY, amount: "-1", categoryId: null },
    });
    expect(refused.isError).toBe(true);
    expect(toolJson<{ error: { code: string } }>(refused).error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("lists connected agents and disconnects one at once", async () => {
    const { owner } = await setup();
    const { accessToken, clientId } = await connectMcpClient(owner.cookie);
    const listed = await json<{
      agents: { id: string; name: string; access: string; kind: string }[];
    }>(await send("GET", "/v1/me/agents", owner.cookie));
    expect(listed.agents).toEqual([
      expect.objectContaining({ name: "Test Agent", kind: "mcp", access: "write" }),
    ]);
    expect((await mcp(accessToken, "tools/list")).status).toBe(200);

    const id = one(listed.agents[0]).id;
    expect((await send("DELETE", `/v1/me/agents/${id}`, owner.cookie)).status).toBe(204);
    // The access token it still holds is refused from now on.
    expect((await mcp(accessToken, "tools/list")).status).toBe(401);
    expect(
      (await json<{ agents: unknown[] }>(await send("GET", "/v1/me/agents", owner.cookie))).agents,
    ).toEqual([]);

    const again = await connectMcpClient(owner.cookie, undefined, clientId);
    expect((await mcp(again.accessToken, "tools/list")).status).toBe(200);
    const [row] = await db.select().from(connectedAgent);
    expect(row?.revokedAt).toBeNull();
  });
});

describe("connected agents routes", () => {
  it("take a signed-in session: an API key can't list or disconnect agents", async () => {
    const { owner } = await setup();
    const created = await send("POST", "/v1/me/api-keys", owner.cookie, {
      name: "Script",
      access: "write",
      budgetIds: null,
      expiresInDays: 90,
    });
    const { key } = await json<{ key: string }>(created);
    const res = await app.request("/v1/me/agents", { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(403);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("SESSION_REQUIRED");
  });
});

async function getMe(cookie: string) {
  return json<{ id: string }>(await send("GET", "/v1/me", cookie));
}

describe("Agent Auth", () => {
  const authBase = `${env.BETTER_AUTH_URL}/api/auth`;

  async function keys() {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    return { publicKey: await exportJWK(publicKey), privateKey };
  }

  it("registers, is approved in the web app, and runs capabilities as the person", async () => {
    const { owner, budget, account } = await setup();
    const host = await keys();
    const agentKeys = await keys();
    const now = Math.floor(Date.now() / 1000);
    const hostJwt = await new SignJWT({
      host_public_key: host.publicKey,
      agent_public_key: agentKeys.publicKey,
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "host+jwt" })
      .setIssuer(`host-${randomUUID()}`)
      .setAudience(authBase)
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(host.privateKey);

    const registered = await app.request("/api/auth/agent/register", {
      method: "POST",
      headers: { authorization: `Bearer ${hostJwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Budget Bot",
        capabilities: ["listBudgets", "createTransaction"],
        mode: "delegated",
      }),
    });
    expect(registered.status).toBe(200);
    const reg = await json<{
      agent_id: string;
      approval: { user_code: string; verification_uri_complete: string };
    }>(registered);
    expect(reg.approval.verification_uri_complete).toContain(`${env.WEB_ORIGIN}/agents/approve?`);

    // The approval page shows what it asks for, given the code.
    const wrong = await send(
      "GET",
      `/v1/me/agent-approvals/${reg.agent_id}?code=AAAA-AAAA`,
      owner.cookie,
    );
    expect(wrong.status).toBe(404);
    const details = await json<{
      name: string;
      capabilities: { name: string; readOnly: boolean }[];
    }>(
      await send(
        "GET",
        `/v1/me/agent-approvals/${reg.agent_id}?code=${encodeURIComponent(reg.approval.user_code)}`,
        owner.cookie,
      ),
    );
    expect(details.name).toBe("Budget Bot");
    expect(details.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "listBudgets", readOnly: true }),
        expect.objectContaining({ name: "createTransaction", readOnly: false }),
      ]),
    );

    const approved = await send("POST", "/api/auth/agent/approve-capability", owner.cookie, {
      agent_id: reg.agent_id,
      action: "approve",
      user_code: reg.approval.user_code,
    });
    expect(approved.status).toBe(200);

    const execute = async (capability: string, args: unknown) => {
      const t = Math.floor(Date.now() / 1000);
      const agentJwt = await new SignJWT({})
        .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
        .setSubject(reg.agent_id)
        .setAudience(`${authBase}/capability/execute`)
        .setJti(randomUUID())
        .setIssuedAt(t)
        .setExpirationTime(t + 60)
        .sign(agentKeys.privateKey);
      return app.request("/api/auth/capability/execute", {
        method: "POST",
        headers: { authorization: `Bearer ${agentJwt}`, "content-type": "application/json" },
        body: JSON.stringify({ capability, arguments: args }),
      });
    };

    const listed = await execute("listBudgets", {});
    expect(listed.status).toBe(200);
    const created = await execute("createTransaction", {
      budgetId: budget.id,
      body: { accountId: account.id, date: TODAY, amount: "-700", categoryId: null },
    });
    expect(created.status).toBe(200);
    const txn = (await json<{ data: Txn }>(created)).data;
    expect(txn.enteredBy?.agent).toMatchObject({ name: "Budget Bot", kind: "agent_auth" });

    // Not granted: refused by the plugin.
    expect((await execute("deleteBudget", { budgetId: budget.id })).status).toBeGreaterThanOrEqual(
      400,
    );

    const agents = await json<{ agents: { id: string; kind: string; permissions: string[] }[] }>(
      await send("GET", "/v1/me/agents", owner.cookie),
    );
    const bot = one(agents.agents.find((a) => a.kind === "agent_auth"));
    expect(bot.permissions).toEqual(["createTransaction", "listBudgets"]);
    expect((await send("DELETE", `/v1/me/agents/${bot.id}`, owner.cookie)).status).toBe(204);
    expect((await execute("listBudgets", {})).status).toBe(403);
  });
});
