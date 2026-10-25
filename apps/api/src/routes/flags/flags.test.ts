import { newId } from "@strictbudget/db";
import { budgetMember } from "@strictbudget/db/schema";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Flag = { color: string; name: string };
type Txn = { id: string; flag: string | null; transferTransactionId: string | null };

const TODAY = "2026-10-01";

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup() {
  const owner = await signUp(app);
  const budget = await createBudget(app, owner.cookie);
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (name: string, type: string) =>
    json<{ id: string }>(
      await send("POST", `${base}/accounts`, owner.cookie, {
        name,
        type,
        balance: "0",
        date: TODAY,
      }),
    );
  const flags = async (cookie = owner.cookie) =>
    (await json<{ flags: Flag[] }>(await send("GET", `${base}/flags`, cookie))).flags;
  const list = async () =>
    (await json<{ transactions: Txn[] }>(await send("GET", `${base}/transactions`, owner.cookie)))
      .transactions;
  return { owner, budget, base, addAccount, flags, list };
}

describe("flags", () => {
  it("sets, changes and clears a transaction's flag", async () => {
    const { owner, base, addAccount } = await setup();
    const checking = await addAccount("Checking", "checking");
    const created = await json<Txn>(
      await send("POST", `${base}/transactions`, owner.cookie, {
        accountId: checking.id,
        date: TODAY,
        amount: "-500",
        categoryId: null,
        flag: "red",
      }),
    );
    expect(created.flag).toBe("red");
    const path = `${base}/transactions/${created.id}`;
    expect((await json<Txn>(await send("PATCH", path, owner.cookie, { flag: "blue" }))).flag).toBe(
      "blue",
    );
    expect((await json<Txn>(await send("PATCH", path, owner.cookie, { flag: null }))).flag).toBe(
      null,
    );
    expect((await send("PATCH", path, owner.cookie, { flag: "pink" })).status).toBe(400);
  });

  it("keeps the flag per side of a transfer", async () => {
    const { owner, base, addAccount, list } = await setup();
    const checking = await addAccount("Checking", "checking");
    const savings = await addAccount("Savings", "savings");
    const transfer = await json<Txn>(
      await send("POST", `${base}/transactions`, owner.cookie, {
        accountId: checking.id,
        transferAccountId: savings.id,
        date: TODAY,
        amount: "-500",
        categoryId: null,
        flag: "green",
      }),
    );
    const other = (await list()).find((t) => t.id === transfer.transferTransactionId);
    expect(other?.flag).toBeNull();
  });

  it("names flags for everyone on the budget", async () => {
    const { owner, budget, base, flags } = await setup();
    expect((await flags()).map((f) => f.color)).toEqual([
      "red",
      "orange",
      "yellow",
      "green",
      "blue",
      "purple",
    ]);
    const res = await send("PUT", `${base}/flags/red`, owner.cookie, { name: " Reimbursable " });
    expect(await json<Flag>(res)).toEqual({ color: "red", name: "Reimbursable" });

    const partner = await signUp(app);
    const me = await json<{ id: string }>(await send("GET", "/v1/me", partner.cookie));
    await db
      .insert(budgetMember)
      .values({ id: newId(), budgetId: budget.id, userId: me.id, role: "editor" });
    expect((await flags(partner.cookie))[0]).toEqual({ color: "red", name: "Reimbursable" });
    await send("PUT", `${base}/flags/red`, partner.cookie, { name: "Work" });
    expect((await flags())[0]?.name).toBe("Work");

    await send("PUT", `${base}/flags/red`, owner.cookie, { name: "" });
    expect((await flags())[0]?.name).toBe("");
  });

  it("is hidden from non-members, and comes along on a fresh start", async () => {
    const { owner, base, budget } = await setup();
    await send("PUT", `${base}/flags/purple`, owner.cookie, { name: "Tax" });
    const stranger = await signUp(app);
    expect((await send("GET", `${base}/flags`, stranger.cookie)).status).toBe(404);
    expect((await send("PUT", `${base}/flags/red`, stranger.cookie, { name: "x" })).status).toBe(
      404,
    );

    const fresh = await json<{ id: string }>(
      await send("POST", `/v1/budgets/${budget.id}/fresh-start`, owner.cookie, {
        date: TODAY,
        name: "Fresh",
      }),
    );
    const { flags } = await json<{ flags: Flag[] }>(
      await send("GET", `/v1/budgets/${fresh.id}/flags`, owner.cookie),
    );
    expect(flags.find((f) => f.color === "purple")?.name).toBe("Tax");
  });
});
