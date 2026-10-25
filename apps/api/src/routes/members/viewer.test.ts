import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  shareBudget,
  signUp,
} from "../../../test/helpers";
import { OPENAPI_FILE } from "../../openapi-spec";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

/** Writes a viewer may make: they change nothing in the budget. */
const ALLOWED = new Set([
  "POST /v1/budgets/{budgetId}/leave",
  "POST /v1/budgets/{budgetId}/accounts/{accountId}/reconcile/preview",
  "POST /v1/budgets/{budgetId}/transactions/selection",
  "POST /v1/budgets/{budgetId}/export/transactions",
]);

describe("viewer role", () => {
  it("refuses a viewer every write route of the budget", async () => {
    const owner = await signUp(app, { name: "Owner" });
    const budget = await createBudget(app, owner.cookie);
    const viewer = await shareBudget(app, owner.cookie, budget.id, { role: "viewer" });
    const spec = JSON.parse(readFileSync(OPENAPI_FILE, "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const writes = Object.entries(spec.paths).flatMap(([path, ops]) =>
      Object.keys(ops)
        .filter((m) => ["post", "put", "patch", "delete"].includes(m))
        .filter(() => path.startsWith("/v1/budgets/{budgetId}"))
        .map((m) => ({ method: m.toUpperCase(), path })),
    );
    expect(writes.length).toBeGreaterThan(50);
    const refused: string[] = [];
    for (const { method, path } of writes) {
      const key = `${method} ${path}`;
      if (ALLOWED.has(key)) continue;
      const url = path
        .replace("{budgetId}", budget.id)
        .replace(/\{[^}]+\}/g, "00000000-0000-7000-8000-000000000000");
      const res = await send(method, url, viewer.cookie, {});
      if (res.status === 403) {
        expect((await json<{ error: { code: string } }>(res)).error.code).toBe("READ_ONLY");
        refused.push(key);
      } else {
        refused.push(`${key} → ${res.status}`);
      }
    }
    expect(refused.filter((r) => r.includes("→"))).toEqual([]);
  });

  it("lets a viewer read everything and leave", async () => {
    const owner = await signUp(app, { name: "Owner" });
    const budget = await createBudget(app, owner.cookie);
    const viewer = await shareBudget(app, owner.cookie, budget.id, { role: "viewer" });
    const base = `/v1/budgets/${budget.id}`;
    const opened = await json<{ role: string }>(await send("GET", base, viewer.cookie));
    expect(opened.role).toBe("viewer");
    for (const path of [
      "/categories",
      "/accounts",
      "/months/2026-10",
      "/transactions",
      "/activity",
    ]) {
      expect((await send("GET", `${base}${path}`, viewer.cookie)).status, path).toBe(200);
    }
    expect((await send("POST", `${base}/leave`, viewer.cookie)).status).toBe(204);
  });

  it("invites as a viewer or an editor, and the owner can switch a member's role", async () => {
    const owner = await signUp(app, { name: "Owner" });
    const budget = await createBudget(app, owner.cookie);
    const base = `/v1/budgets/${budget.id}`;
    const pat = await shareBudget(app, owner.cookie, budget.id, { role: "viewer" });
    type Members = { members: { userId: string; role: string }[] };
    const roleOf = async (userId: string) =>
      (await json<Members>(await send("GET", `${base}/members`, owner.cookie))).members.find(
        (m) => m.userId === userId,
      )?.role;
    expect(await roleOf(pat.userId)).toBe("viewer");
    expect(
      (await send("PUT", `${base}/months/2026-10/note`, pat.cookie, { note: "x" })).status,
    ).toBe(403);

    const changed = await send("PATCH", `${base}/members/${pat.userId}`, owner.cookie, {
      role: "editor",
    });
    expect(changed.status).toBe(200);
    expect(await json<{ role: string }>(changed)).toMatchObject({ role: "editor" });
    expect(
      (await send("PUT", `${base}/months/2026-10/note`, pat.cookie, { note: "x" })).status,
    ).toBe(200);

    const sam = await shareBudget(app, owner.cookie, budget.id, { name: "Sam" });
    expect(
      (await send("PATCH", `${base}/members/${sam.userId}`, pat.cookie, { role: "viewer" })).status,
    ).toBe(403);
    const me = (await json<Members>(await send("GET", `${base}/members`, owner.cookie))).members[0];
    const own = await send("PATCH", `${base}/members/${me?.userId}`, owner.cookie, {
      role: "viewer",
    });
    expect(own.status).toBe(409);
    const invited = await json<{ role: string }>(
      await send("POST", `${base}/invitations`, owner.cookie, {
        name: "Kim",
        email: `kim-${crypto.randomUUID()}@example.com`,
        role: "viewer",
      }),
    );
    expect(invited.role).toBe("viewer");
  });
});
