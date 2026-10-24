import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import type { FakeFxProvider } from "../../lib/fx/fake";

// Account totals and net worth in the budget's currency or the user's display currency, at
// today's known rates.
const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset()
    .seed("2026-10-01", "EUR", { USD: "1.1" })
    .seed("2026-10-01", "USD", { EUR: "0.9" })
    .seed("2026-10-10", "EUR", { USD: "1.2" });
});
afterAll(close);

const TODAY = "2026-10-16";

type Converted = { currency: string; cleared: string; uncleared: string; working: string };
type Total = { currency: string; amount: string; converted: boolean; missing: string[] };
type AccountList = {
  accounts: { id: string; converted: Converted | null }[];
  totals: Record<"starred" | "budget" | "loans" | "tracking" | "closed" | "netWorth", Total>;
  missingRates: number;
};

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json", origin: "http://localhost:5173" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup(currency = "USD") {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie, { currency });
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
  const list = async (query = "") => {
    const res = await send("GET", `${base}/accounts?today=${TODAY}${query}`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return json<AccountList>(res);
  };
  return { cookie, base, addAccount, list };
}

describe("account totals", () => {
  it("adds every account in the budget's currency at today's known rate", async () => {
    const { cookie, base, addAccount, list } = await setup();
    const dollars = await addAccount({ name: "Dollars", type: "checking", balance: "5000" });
    const euros = await addAccount({
      name: "Euros",
      type: "checking",
      currency: "EUR",
      balance: "10000",
    });
    await addAccount({ name: "Card", type: "credit_card", balance: "-2000" });
    await addAccount({ name: "Flat", type: "asset", currency: "EUR", balance: "20000" });
    const closed = await addAccount({ name: "Old", type: "savings", balance: "0" });
    await send("POST", `${base}/accounts/${closed.id}/close`, cookie, { date: TODAY });

    const before = await list();
    // €100.00 and €200.00 at 1.1 (the latest rate known): $110.00 and $220.00.
    expect(before.totals).toMatchObject({
      budget: { currency: "USD", amount: "14000", converted: true, missing: [] },
      tracking: { currency: "USD", amount: "22000", converted: true },
      loans: { amount: "0", converted: false },
      closed: { amount: "0", converted: false },
      netWorth: { currency: "USD", amount: "36000", converted: true },
    });
    expect(before.missingRates).toBe(0);
    const row = (id: string) => before.accounts.find((a) => a.id === id);
    expect(row(euros.id)?.converted).toEqual({
      currency: "USD",
      cleared: "11000",
      uncleared: "0",
      working: "11000",
    });
    expect(row(dollars.id)?.converted?.working).toBe("5000");

    // Today's rate moves to 1.2: totals are today's value, not what was booked.
    await send("GET", `${base}/fx-rates?from=EUR&date=${TODAY}&today=${TODAY}`, cookie);
    const after = await list();
    expect(after.totals.budget.amount).toBe("15000");
    expect(after.totals.netWorth.amount).toBe("39000");
  });

  it("shows a EUR budget in USD, by preference or per request", async () => {
    const { cookie, addAccount, list } = await setup("EUR");
    await addAccount({ name: "Euros", type: "checking", balance: "10000" });
    await addAccount({ name: "Dollars", type: "savings", currency: "USD", balance: "5000" });
    // In the budget's currency: $50.00 at 0.9 is €45.00.
    expect((await list()).totals.budget).toMatchObject({ currency: "EUR", amount: "14500" });
    // Per request: the only known rate is USD→EUR 0.9, so €100.00 is $111.11.
    expect((await list("&displayCurrency=USD")).totals.netWorth).toEqual({
      currency: "USD",
      amount: "16111",
      converted: true,
      missing: [],
    });
    // By preference, across budgets.
    await send("PATCH", "/v1/me/preferences", cookie, { displayCurrency: "USD" });
    expect((await list()).totals.budget).toMatchObject({ currency: "USD", amount: "16111" });
    expect((await list("&displayCurrency=EUR")).totals.budget.currency).toBe("EUR");
  });

  it("leaves out accounts with no known rate", async () => {
    const { addAccount, list } = await setup();
    await addAccount({ name: "Dollars", type: "checking", balance: "5000" });
    // A zero starting balance needs no rate, so no JPY rate is known.
    const yen = await addAccount({ name: "Yen", type: "cash", currency: "JPY" });
    const body = await list();
    expect(body.totals.budget).toEqual({
      currency: "USD",
      amount: "5000",
      converted: false,
      missing: [yen.id],
    });
    expect(body.totals.netWorth.missing).toEqual([yen.id]);
    expect(body.missingRates).toBe(1);
    expect(body.accounts.find((a) => a.id === yen.id)?.converted).toBeNull();
  });

  it("totals the starred group too", async () => {
    const { cookie, base, addAccount, list } = await setup();
    const euros = await addAccount({
      name: "Euros",
      type: "checking",
      currency: "EUR",
      balance: "10000",
    });
    await send("PATCH", `${base}/accounts/${euros.id}?today=${TODAY}`, cookie, { starred: true });
    expect((await list()).totals.starred).toMatchObject({ amount: "11000", converted: true });
  });
});
