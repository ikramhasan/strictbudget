import { apiKey, throttle } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  shareBudget,
  signUp,
} from "../../../test/helpers";
import { API_KEY_REQUESTS_PER_HOUR } from "../../lib/api-keys";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

interface ApiKeyJson {
  id: string;
  name: string;
  start: string;
  access: "read" | "write";
  budgetIds: string[] | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

async function createKey(
  cookie: string,
  input: Partial<{
    name: string;
    access: "read" | "write";
    budgetIds: string[] | null;
    expiresInDays: number | null;
  }> = {},
) {
  const res = await app.request("/v1/me/api-keys", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Script",
      access: "write",
      budgetIds: null,
      expiresInDays: 90,
      ...input,
    }),
  });
  if (res.status !== 201) throw new Error(`create key failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { apiKey: ApiKeyJson; key: string };
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

async function listKeys(cookie: string) {
  const res = await app.request("/v1/me/api-keys", { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { apiKeys: ApiKeyJson[] }).apiKeys;
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("creating and listing API keys", () => {
  it("shows the key once, then only its start", async () => {
    const { cookie } = await signUp(app);
    const before = Date.now();
    const { apiKey: created, key } = await createKey(cookie, { name: "  Home Assistant  " });

    expect(key).toMatch(/^ec_[A-Za-z0-9]{40,}$/);
    expect(created).toMatchObject({
      name: "Home Assistant",
      start: key.slice(0, 10),
      access: "write",
      budgetIds: null,
      lastUsedAt: null,
    });
    const expires = new Date(created.expiresAt ?? "").getTime();
    expect(expires - before).toBeGreaterThanOrEqual(90 * DAY - 1000);
    expect(expires - before).toBeLessThan(90 * DAY + 60_000);

    const listed = await listKeys(cookie);
    expect(listed).toEqual([created]);
    expect(JSON.stringify(listed)).not.toContain(key);
    // The database keeps only a hash of the key.
    const [row] = await db.select().from(apiKey).where(eq(apiKey.id, created.id));
    expect(row?.key).not.toBe(key);
    expect(row?.key).not.toContain(key.slice(10));
  });

  it("takes no expiration, read-only access and chosen budgets", async () => {
    const { cookie } = await signUp(app);
    const budget = await createBudget(app, cookie);
    const { apiKey: created } = await createKey(cookie, {
      access: "read",
      budgetIds: [budget.id, budget.id],
      expiresInDays: null,
    });
    expect(created).toMatchObject({ access: "read", budgetIds: [budget.id], expiresAt: null });
  });

  it("lists newest first and only the account's own active keys", async () => {
    const { cookie } = await signUp(app);
    const other = await signUp(app);
    const first = await createKey(cookie, { name: "First" });
    const second = await createKey(cookie, { name: "Second" });
    await createKey(other.cookie, { name: "Not mine" });
    const expired = await createKey(cookie, { name: "Expired" });
    await db
      .update(apiKey)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiKey.id, expired.apiKey.id));

    expect((await listKeys(cookie)).map((k) => k.id)).toEqual([second.apiKey.id, first.apiKey.id]);
  });

  it("refuses budgets the user doesn't belong to, and bad input", async () => {
    const { cookie } = await signUp(app);
    const stranger = await signUp(app);
    const theirs = await createBudget(app, stranger.cookie);
    const post = (body: unknown) =>
      app.request("/v1/me/api-keys", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const base = { name: "x", access: "write", budgetIds: null, expiresInDays: 30 };

    const res = await post({ ...base, budgetIds: [theirs.id] });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("UNKNOWN_BUDGET");
    for (const bad of [
      { ...base, name: "   " },
      { ...base, name: "x".repeat(51) },
      { ...base, access: "admin" },
      { ...base, budgetIds: [] },
      { ...base, expiresInDays: 0 },
      { ...base, expiresInDays: 5 * 365 + 1 },
    ]) {
      const r = await post(bad);
      expect(r.status).toBe(400);
      expect(await errorCode(r)).toBe("VALIDATION_ERROR");
    }
    expect(await listKeys(cookie)).toEqual([]);
  });

  it("needs a signed-in session", async () => {
    const res = await app.request("/v1/me/api-keys");
    expect(res.status).toBe(401);
  });

  it("keeps the plugin's own endpoints closed", async () => {
    const { cookie } = await signUp(app);
    for (const path of ["create", "list", "get", "update", "delete", "verify"]) {
      const res = await app.request(`/api/auth/api-key/${path}`, {
        method: path === "list" || path === "get" ? "GET" : "POST",
        headers: { cookie, "content-type": "application/json", origin: "http://localhost:5173" },
        ...(path === "list" || path === "get" ? {} : { body: JSON.stringify({ name: "x" }) }),
      });
      expect(res.status).toBe(404);
    }
    expect(await listKeys(cookie)).toEqual([]);
  });
});

describe("requests made with an API key", () => {
  it("act as the key's owner, sent either way", async () => {
    const { cookie, email } = await signUp(app);
    const { key } = await createKey(cookie);
    for (const headers of [bearer(key), { "x-api-key": key }]) {
      const res = await app.request("/v1/me", { headers });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ email });
    }
    const [listed] = await listKeys(cookie);
    expect(listed?.lastUsedAt).not.toBeNull();
  });

  it("are refused with an unknown, revoked or expired key", async () => {
    const { cookie } = await signUp(app);
    const unknown = await app.request("/v1/me", { headers: bearer(`ec_${"a".repeat(64)}`) });
    expect(unknown.status).toBe(401);
    expect(await errorCode(unknown)).toBe("INVALID_API_KEY");

    const revoked = await createKey(cookie);
    const del = await app.request(`/v1/me/api-keys/${revoked.apiKey.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(204);
    expect((await app.request("/v1/me", { headers: bearer(revoked.key) })).status).toBe(401);

    const expired = await createKey(cookie);
    await db
      .update(apiKey)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiKey.id, expired.apiKey.id));
    const res = await app.request("/v1/me", { headers: bearer(expired.key) });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("INVALID_API_KEY");
  });

  it("leave other bearer tokens alone", async () => {
    const res = await app.request("/v1/me", { headers: { authorization: "Bearer something" } });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("can't reach account, sharing or budget-lifecycle routes", async () => {
    const { cookie } = await signUp(app);
    const budget = await createBudget(app, cookie);
    const { key } = await createKey(cookie);
    const json = { ...bearer(key), "content-type": "application/json" };
    const attempts: [string, string, unknown?][] = [
      ["GET", "/v1/me/sessions"],
      ["GET", "/v1/me/api-keys"],
      [
        "POST",
        "/v1/me/api-keys",
        { name: "x", access: "write", budgetIds: null, expiresInDays: 1 },
      ],
      ["GET", "/v1/me/preferences"],
      ["POST", "/v1/me/delete", { password: "x" }],
      ["POST", "/v1/budgets", { name: "New" }],
      ["DELETE", `/v1/budgets/${budget.id}`],
      ["POST", `/v1/budgets/${budget.id}/leave`],
      ["POST", `/v1/budgets/${budget.id}/invitations`, { name: "x", email: "x@example.com" }],
      ["POST", `/v1/budgets/${budget.id}/transfer-ownership`, { userId: "someone" }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await app.request(path, {
        method,
        headers: json,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      expect([path, res.status]).toEqual([path, 403]);
      expect(await errorCode(res)).toBe("SESSION_REQUIRED");
    }
    expect(await listKeys(cookie)).toHaveLength(1);
  });

  it("with read-only access can read but not write", async () => {
    const { cookie } = await signUp(app);
    const budget = await createBudget(app, cookie);
    const { key } = await createKey(cookie, { access: "read" });

    expect((await app.request(`/v1/budgets/${budget.id}`, { headers: bearer(key) })).status).toBe(
      200,
    );
    const res = await app.request(`/v1/budgets/${budget.id}`, {
      method: "PATCH",
      headers: { ...bearer(key), "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("READ_ONLY_KEY");
    // A POST that only reads is still allowed.
    const selection = await app.request(`/v1/budgets/${budget.id}/transactions/selection`, {
      method: "POST",
      headers: { ...bearer(key), "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(selection.status).not.toBe(403);
  });

  it("with write access can change a budget, within the owner's role", async () => {
    const { cookie } = await signUp(app);
    const budget = await createBudget(app, cookie);
    const { key } = await createKey(cookie);
    const res = await app.request(`/v1/budgets/${budget.id}`, {
      method: "PATCH",
      headers: { ...bearer(key), "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "Renamed" });

    // A viewer's write key is still a viewer's.
    const viewer = await shareBudget(app, cookie, budget.id, { role: "viewer" });
    const viewerKey = await createKey(viewer.cookie);
    const refused = await app.request(`/v1/budgets/${budget.id}`, {
      method: "PATCH",
      headers: { ...bearer(viewerKey.key), "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(refused.status).toBe(403);
  });

  it("limited to some budgets see only those", async () => {
    const { cookie } = await signUp(app);
    const allowed = await createBudget(app, cookie, { name: "Allowed" });
    const hidden = await createBudget(app, cookie, { name: "Hidden" });
    const { key } = await createKey(cookie, { budgetIds: [allowed.id] });

    const list = await app.request("/v1/budgets", { headers: bearer(key) });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { budgets: { id: string }[]; lastUsedBudgetId: string };
    expect(body.budgets.map((b) => b.id)).toEqual([allowed.id]);
    // The last budget opened in the app was Hidden, which this key can't see.
    expect(body.lastUsedBudgetId).toBeNull();

    expect((await app.request(`/v1/budgets/${allowed.id}`, { headers: bearer(key) })).status).toBe(
      200,
    );
    for (const path of [`/v1/budgets/${hidden.id}`, `/v1/budgets/${hidden.id}/accounts`]) {
      const res = await app.request(path, { headers: bearer(key) });
      expect(res.status).toBe(404);
    }
  });

  it("don't change which budget the app opens next", async () => {
    const { cookie } = await signUp(app);
    const first = await createBudget(app, cookie, { name: "First" });
    const second = await createBudget(app, cookie, { name: "Second" });
    const { key } = await createKey(cookie);
    await app.request(`/v1/budgets/${first.id}`, { headers: bearer(key) });
    const list = await app.request("/v1/budgets", { headers: { cookie } });
    expect(((await list.json()) as { lastUsedBudgetId: string }).lastUsedBudgetId).toBe(second.id);
  });

  it(`are limited to ${API_KEY_REQUESTS_PER_HOUR} an hour per key`, async () => {
    const { cookie } = await signUp(app);
    const { apiKey: created, key } = await createKey(cookie);
    const other = await createKey(cookie);
    // As if the hour's allowance were already spent.
    await db.insert(throttle).values({
      key: `api-key:${created.id}`,
      points: API_KEY_REQUESTS_PER_HOUR,
      expire: new Date(Date.now() + 30 * 60 * 1000),
    });
    const res = await app.request("/v1/me", { headers: bearer(key) });
    expect(res.status).toBe(429);
    expect(await errorCode(res)).toBe("RATE_LIMITED");
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(29 * 60);
    expect(retryAfter).toBeLessThanOrEqual(30 * 60);
    // Other keys, and the signed-in app, aren't affected.
    expect((await app.request("/v1/me", { headers: bearer(other.key) })).status).toBe(200);
    expect((await app.request("/v1/me", { headers: { cookie } })).status).toBe(200);
  });

  it("stop working when the account is deleted", async () => {
    const { cookie, password } = await signUp(app);
    const { key } = await createKey(cookie);
    const del = await app.request("/v1/me/delete", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    expect(del.status).toBeLessThan(300);
    expect((await app.request("/v1/me", { headers: bearer(key) })).status).toBe(401);
    expect(await db.select().from(apiKey)).toEqual([]);
  });
});

describe("revoking a key", () => {
  it("is 404 for another account's key", async () => {
    const { cookie } = await signUp(app);
    const other = await signUp(app);
    const theirs = await createKey(other.cookie);
    const res = await app.request(`/v1/me/api-keys/${theirs.apiKey.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect((await app.request("/v1/me", { headers: bearer(theirs.key) })).status).toBe(200);
  });
});
