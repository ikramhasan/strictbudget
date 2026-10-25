import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import type { FakeFxProvider } from "../../lib/fx/fake";

// The all-accounts register reads a searched amount in each row's own currency.
const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset()
    .seed("2026-10-01", "EUR", { USD: "1.25" })
    .seed("2026-10-01", "JPY", { USD: "0.0067" });
});
afterAll(close);

const TODAY = "2026-10-16";

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/accounts`, cookie, {
      balance: "0",
      date: "2026-10-01",
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<{ id: string }>(res);
  };
  const create = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
      date: "2026-10-05",
      categoryId: null,
      memo: "",
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
  };
  const dollars = await addAccount({ name: "Checking", type: "checking" });
  const euros = await addAccount({ name: "Euros", type: "checking", currency: "EUR" });
  const yen = await addAccount({ name: "Yen", type: "cash", currency: "JPY" });
  // $12.00, €12.00 and ¥1,200: the same minor units, different amounts.
  await create({ accountId: dollars.id, amount: "-1200", payeeName: "Diner" });
  await create({ accountId: euros.id, amount: "-1200", payeeName: "Bistro" });
  await create({ accountId: yen.id, amount: "-1200", payeeName: "Konbini" });
  const search = async (q: string) => {
    const res = await send(
      "GET",
      `${base}/transactions?q=${encodeURIComponent(q)}&today=${TODAY}`,
      cookie,
    );
    expect(res.status).toBe(200);
    const { transactions } = await json<{ transactions: { payeeName: string }[] }>(res);
    return transactions.map((t) => t.payeeName).sort();
  };
  return { cookie, base, search, yen, euros };
}

describe("searching all accounts across currencies", () => {
  it("reads an amount in each row's own currency", async () => {
    const { search } = await setup();
    expect(await search("12")).toEqual(["Bistro", "Diner"]);
    expect(await search("1200")).toEqual(["Konbini"]);
    expect(await search("Outflow: 12")).toEqual(["Bistro", "Diner"]);
    expect(await search("Outflow: 1200")).toEqual(["Konbini"]);
    // Other terms still apply to every row.
    expect(await search("Konbini, 1200")).toEqual(["Konbini"]);
    expect(await search("Konbini, 12")).toEqual([]);
  });

  it("reads a scheduled amount in its account's currency", async () => {
    const { cookie, base, yen } = await setup();
    const res = await send("POST", `${base}/scheduled-transactions`, cookie, {
      today: TODAY,
      frequency: "monthly",
      accountId: yen.id,
      date: "2026-11-01",
      amount: "-500",
      payeeName: "Rent",
      memo: "",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const find = async (q: string) =>
      (
        await json<{ scheduledTransactions: { payeeName: string }[] }>(
          await send(
            "GET",
            `${base}/scheduled-transactions?q=${encodeURIComponent(q)}&today=${TODAY}`,
            cookie,
          ),
        )
      ).scheduledTransactions.map((r) => r.payeeName);
    expect(await find("500")).toEqual(["Rent"]);
    expect(await find("5")).toEqual([]);
  });
});
