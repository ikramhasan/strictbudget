import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

// The server's UTC date in these tests; the user's `today` may differ by a day either way.
const SERVER = "2026-10-15";
const { app, db, close } = createTestApp({ serverDate: () => SERVER });
beforeEach(() => resetDatabase(db));
afterAll(close);

type Txn = { id: string; date: string; memo: string; transferTransactionId: string | null };
type ErrorBody = { error: { code: string } };

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (name: string) => {
    const res = await send("POST", `${base}/accounts`, cookie, {
      name,
      type: "checking",
      balance: "0",
      date: "2026-10-01",
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const accountId = await addAccount("Checking");
  const create = (date: string, today?: string, extra: Record<string, unknown> = {}) =>
    send("POST", `${base}/transactions${today ? `?today=${today}` : ""}`, cookie, {
      accountId,
      date,
      amount: "-1000",
      payeeName: "Shop",
      categoryId: null,
      ...extra,
    });
  const update = (id: string, body: Record<string, unknown>, today?: string) =>
    send("PATCH", `${base}/transactions/${id}${today ? `?today=${today}` : ""}`, cookie, body);
  return { cookie, base, addAccount, accountId, create, update };
}

const code = async (res: Response) => ((await res.json()) as ErrorBody).error.code;

describe("future dates", () => {
  it("refuses a date after the user's today on create", async () => {
    const { create } = await setup();
    const tomorrow = await create("2026-10-16", "2026-10-15");
    expect(tomorrow.status).toBe(400);
    expect(await code(tomorrow)).toBe("DATE_IN_FUTURE");
    expect((await create("2026-10-15", "2026-10-15")).status).toBe(201);
    expect((await create("2026-09-30", "2026-10-15")).status).toBe(201);
  });

  it("follows a user's today behind the server's date", async () => {
    const { create } = await setup();
    const res = await create("2026-10-15", "2026-10-14");
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("DATE_IN_FUTURE");
    expect((await create("2026-10-14", "2026-10-14")).status).toBe(201);
  });

  it("allows up to the server's date plus a day without a today", async () => {
    const { create } = await setup();
    expect((await create("2026-10-16")).status).toBe(201);
    const res = await create("2026-10-17");
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("DATE_IN_FUTURE");
    expect((await create("2027-06-01")).status).toBe(400);
  });

  it("holds a made-up today to the server's date plus a day", async () => {
    const { create } = await setup();
    expect((await create("2027-06-01", "2027-06-01")).status).toBe(400);
    expect((await create("2026-10-16", "2027-06-01")).status).toBe(201);
  });

  it("refuses moving a transaction (or a transfer) to a future date", async () => {
    const { create, update, addAccount, base, cookie } = await setup();
    const t = (await (await create("2026-10-10", "2026-10-15")).json()) as Txn;
    const res = await update(t.id, { date: "2026-10-20" }, "2026-10-15");
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("DATE_IN_FUTURE");
    expect((await update(t.id, { date: "2026-10-16" })).status).toBe(200);
    expect((await update(t.id, { date: "2026-10-17" })).status).toBe(400);

    const savings = await addAccount("Savings");
    const transfer = (await (
      await create("2026-10-10", "2026-10-15", { payeeName: null, transferAccountId: savings })
    ).json()) as Txn;
    expect((await update(transfer.id, { date: "2026-10-16" }, "2026-10-15")).status).toBe(400);
    const other = await send(
      "GET",
      `${base}/transactions?accountId=${savings}&today=2026-10-15`,
      cookie,
    );
    const rows = ((await other.json()) as { transactions: Txn[] }).transactions;
    // The other side kept its date (the other row is the starting balance).
    expect(rows.map((r) => r.date)).toEqual(["2026-10-10", "2026-10-01"]);
  });

  it("still edits a row already dated ahead when its date doesn't change", async () => {
    const { create, update } = await setup();
    // Allowed without a today (the server's date plus a day), then edited by a user still on
    // the 15th.
    const t = (await (await create("2026-10-16")).json()) as Txn;
    const res = await update(t.id, { date: "2026-10-16", memo: "kept" }, "2026-10-15");
    expect(res.status).toBe(200);
    expect(((await res.json()) as Txn).memo).toBe("kept");
  });

  it("restores a deleted past transaction (undo)", async () => {
    const { create, base, cookie } = await setup();
    const t = (await (await create("2026-10-10", "2026-10-15")).json()) as Txn;
    expect((await send("DELETE", `${base}/transactions/${t.id}`, cookie)).status).toBe(204);
    const restored = await create("2026-10-10", "2026-10-15", { restore: true, approved: false });
    expect(restored.status).toBe(201);
  });

  it("restores a deleted row that was dated ahead of the user's today (undo)", async () => {
    const { create, base, cookie } = await setup();
    // Allowed without a today (the server's date plus a day), then deleted and undone by a user
    // still on the 15th.
    const t = (await (await create("2026-10-16")).json()) as Txn;
    expect((await send("DELETE", `${base}/transactions/${t.id}`, cookie)).status).toBe(204);
    expect((await create("2026-10-16", "2026-10-15")).status).toBe(400);
    const restored = await create("2026-10-16", "2026-10-15", { restore: true, approved: false });
    expect(restored.status).toBe(201);
  });
});
