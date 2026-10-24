import { newId } from "@strictbudget/db";
import { budgetMember } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  budgetInput,
  createBudget,
  createTestApp,
  resetDatabase,
  signUp,
  type TestBudget,
} from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type BudgetList = { budgets: TestBudget[]; lastUsedBudgetId: string | null };
type ErrorBody = { error: { code: string; message: string } };

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function list(cookie: string): Promise<BudgetList> {
  const res = await send("GET", "/v1/budgets", cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as BudgetList;
}

async function userId(cookie: string): Promise<string> {
  const res = await send("GET", "/v1/me", cookie);
  return ((await res.json()) as { id: string }).id;
}

async function share(budgetId: string, cookie: string, role: "owner" | "editor" = "editor") {
  await db
    .insert(budgetMember)
    .values({ id: newId(), budgetId, userId: await userId(cookie), role });
}

describe("budgets", () => {
  it("requires a session", async () => {
    const res = await app.request("/v1/budgets");
    expect(res.status).toBe(401);
  });

  it("creates a budget owned by the caller", async () => {
    const { cookie } = await signUp(app);
    const created = await createBudget(app, cookie, { name: "  Household  " });
    expect(created).toMatchObject({ ...budgetInput, name: "Household", role: "owner" });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
  });

  it("lists only the caller's budgets, sorted by name, with the last used one", async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    await createBudget(app, alice.cookie, { name: "zebra" });
    const apple = await createBudget(app, alice.cookie, { name: "Apple" });
    await createBudget(app, bob.cookie, { name: "Bob's" });

    const result = await list(alice.cookie);
    expect(result.budgets.map((b) => b.name)).toEqual(["Apple", "zebra"]);
    expect(result.lastUsedBudgetId).toBe(apple.id);
  });

  it("returns an empty list and no last-used budget for a new user", async () => {
    const { cookie } = await signUp(app);
    expect(await list(cookie)).toEqual({ budgets: [], lastUsedBudgetId: null });
  });

  it("lists the most recently used budgets first, with when each was last used", async () => {
    const { cookie } = await signUp(app);
    const zebra = await createBudget(app, cookie, { name: "zebra" });
    await createBudget(app, cookie, { name: "Apple" });
    expect((await list(cookie)).budgets.map((b) => b.name)).toEqual(["Apple", "zebra"]);
    await send("GET", `/v1/budgets/${zebra.id}`, cookie);
    const { budgets } = (await list(cookie)) as unknown as {
      budgets: (TestBudget & { lastUsedAt: string | null })[];
    };
    expect(budgets.map((b) => b.name)).toEqual(["zebra", "Apple"]);
    expect(Date.now() - Date.parse(budgets[0]?.lastUsedAt ?? "")).toBeLessThan(60_000);

    const partner = await signUp(app);
    const me = (await (await send("GET", "/v1/me", partner.cookie)).json()) as { id: string };
    await db
      .insert(budgetMember)
      .values({ id: newId(), budgetId: zebra.id, userId: me.id, role: "editor" });
    const shared = (await list(partner.cookie)) as unknown as {
      budgets: (TestBudget & { lastUsedAt: string | null })[];
    };
    expect(shared.budgets[0]?.lastUsedAt).toBeNull();
  });

  it("records the last-used budget when one is fetched", async () => {
    const { cookie } = await signUp(app);
    const first = await createBudget(app, cookie, { name: "First" });
    await createBudget(app, cookie, { name: "Second" });
    expect((await list(cookie)).lastUsedBudgetId).not.toBe(first.id);

    const res = await send("GET", `/v1/budgets/${first.id}`, cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as TestBudget).name).toBe("First");
    expect((await list(cookie)).lastUsedBudgetId).toBe(first.id);
  });

  it.each([
    ["an unknown currency", { currency: "XYZ" }],
    ["an unknown number format", { numberFormat: "comma" }],
    ["an unknown date format", { dateFormat: "D/M/Y" }],
    ["a blank name", { name: "   " }],
    ["a name over 100 characters", { name: "x".repeat(101) }],
  ])("rejects %s", async (_label, override) => {
    const { cookie } = await signUp(app);
    const res = await send("POST", "/v1/budgets", cookie, { ...budgetInput, ...override });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe("VALIDATION_ERROR");
  });

  it("renames and reformats a budget", async () => {
    const { cookie } = await signUp(app);
    const created = await createBudget(app, cookie);
    const res = await send("PATCH", `/v1/budgets/${created.id}`, cookie, {
      name: "Home",
      numberFormat: "dot_comma",
      currencySymbolPosition: "after",
      dateFormat: "DD.MM.YYYY",
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as TestBudget;
    expect(updated).toMatchObject({
      name: "Home",
      currency: "USD",
      numberFormat: "dot_comma",
      currencySymbolPosition: "after",
      dateFormat: "DD.MM.YYYY",
    });
    expect(updated.updatedAt >= created.updatedAt).toBe(true);
  });

  it("accepts an empty update", async () => {
    const { cookie } = await signUp(app);
    const created = await createBudget(app, cookie);
    const res = await send("PATCH", `/v1/budgets/${created.id}`, cookie, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as TestBudget).name).toBe(created.name);
  });

  it("refuses to change the currency", async () => {
    const { cookie } = await signUp(app);
    const created = await createBudget(app, cookie);
    const res = await send("PATCH", `/v1/budgets/${created.id}`, cookie, { currency: "EUR" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe("VALIDATION_ERROR");
  });

  it("hides budgets from non-members with 404", async () => {
    const owner = await signUp(app);
    const stranger = await signUp(app);
    const created = await createBudget(app, owner.cookie);
    for (const [method, body] of [["GET"], ["PATCH", { name: "Mine" }], ["DELETE"]] as const) {
      const res = await send(method, `/v1/budgets/${created.id}`, stranger.cookie, body);
      expect(res.status, method).toBe(404);
      expect(((await res.json()) as ErrorBody).error.code).toBe("NOT_FOUND");
    }
  });

  it("returns 404 for a budget id that doesn't exist", async () => {
    const { cookie } = await signUp(app);
    const res = await send("GET", `/v1/budgets/${newId()}`, cookie);
    expect(res.status).toBe(404);
  });

  it("lets an editor see and update a shared budget but not delete it", async () => {
    const owner = await signUp(app);
    const partner = await signUp(app);
    const created = await createBudget(app, owner.cookie);
    await share(created.id, partner.cookie);

    const shared = await list(partner.cookie);
    expect(shared.budgets).toEqual([expect.objectContaining({ id: created.id, role: "editor" })]);

    const patch = await send("PATCH", `/v1/budgets/${created.id}`, partner.cookie, {
      name: "Our budget",
    });
    expect(patch.status).toBe(200);

    const del = await send("DELETE", `/v1/budgets/${created.id}`, partner.cookie);
    expect(del.status).toBe(403);
    expect(((await del.json()) as ErrorBody).error.code).toBe("FORBIDDEN");
  });

  it("deletes a budget with its memberships and clears last-used", async () => {
    const owner = await signUp(app);
    const partner = await signUp(app);
    const created = await createBudget(app, owner.cookie);
    await share(created.id, partner.cookie);
    await send("GET", `/v1/budgets/${created.id}`, partner.cookie);

    const res = await send("DELETE", `/v1/budgets/${created.id}`, owner.cookie);
    expect(res.status).toBe(204);

    expect(await list(owner.cookie)).toEqual({ budgets: [], lastUsedBudgetId: null });
    expect(await list(partner.cookie)).toEqual({ budgets: [], lastUsedBudgetId: null });
    const members = await db
      .select()
      .from(budgetMember)
      .where(eq(budgetMember.budgetId, created.id));
    expect(members).toEqual([]);
  });

  it("does not expose the organization plugin's own endpoints", async () => {
    const { cookie } = await signUp(app);
    const res = await app.request("/api/auth/organization/create", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify({ ...budgetInput, slug: "sneaky" }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe("NOT_FOUND");
    expect(await list(cookie)).toEqual({ budgets: [], lastUsedBudgetId: null });
  });

  it("documents every budget route as cookie-authenticated", async () => {
    const doc = (await (await app.request("/openapi.json")).json()) as {
      paths: Record<string, Record<string, { security?: unknown; operationId?: string }>>;
    };
    const ops = [
      ["/v1/budgets", "get", "listBudgets"],
      ["/v1/budgets", "post", "createBudget"],
      ["/v1/budgets/{budgetId}", "get", "getBudget"],
      ["/v1/budgets/{budgetId}", "patch", "updateBudget"],
      ["/v1/budgets/{budgetId}", "delete", "deleteBudget"],
    ] as const;
    for (const [path, method, operationId] of ops) {
      const op = doc.paths[path]?.[method];
      expect(op?.operationId).toBe(operationId);
      expect(op?.security).toEqual(
        operationId === "createBudget" || operationId === "deleteBudget"
          ? [{ cookieAuth: [] }]
          : [{ cookieAuth: [] }, { apiKeyAuth: [] }],
      );
    }
  });
});
