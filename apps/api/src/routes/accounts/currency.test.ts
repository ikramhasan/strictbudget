import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import type { FakeFxProvider } from "../../lib/fx/fake";

const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset()
    .seed("2026-10-01", "EUR", { USD: "1.1" })
    .seed("2026-10-01", "JPY", { USD: "0.0067" })
    .seed("2026-10-01", "KWD", { USD: "3.25" });
});
afterAll(close);

type Account = {
  id: string;
  type: string;
  currency: string;
  balances: { cleared: string; uncleared: string; working: string };
};
type Txn = { id: string; amount: string; currency: string; payeeName: string | null };
type ErrorBody = { error: { code: string; message: string } };

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
  const createAccount = (input: Record<string, unknown>) =>
    send("POST", `${base}/accounts`, cookie, { date: TODAY, balance: "0", ...input });
  const addAccount = async (input: Record<string, unknown>) => {
    const res = await createAccount(input);
    expect(res.status, await res.clone().text()).toBe(201);
    return json<Account>(res);
  };
  const createTransaction = (input: Record<string, unknown>) =>
    send("POST", `${base}/transactions`, cookie, {
      date: TODAY,
      payeeName: null,
      categoryId: null,
      memo: "",
      ...input,
    });
  const register = async (accountId: string) =>
    (
      await json<{ transactions: Txn[] }>(
        await send("GET", `${base}/transactions?accountId=${accountId}&today=${TODAY}`, cookie),
      )
    ).transactions;
  const accounts = async () =>
    (
      await json<{ accounts: Account[] }>(
        await send("GET", `${base}/accounts?today=${TODAY}`, cookie),
      )
    ).accounts;
  return { cookie, base, createAccount, addAccount, createTransaction, register, accounts };
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status, await res.clone().text()).toBe(status);
  expect((await json<ErrorBody>(res)).error.code).toBe(code);
}

describe("accounts in another currency", () => {
  it("adds a tracking account in another currency", async () => {
    const { addAccount, register } = await setup();
    const asset = await addAccount({
      name: "Euro savings",
      type: "asset",
      currency: "EUR",
      balance: "123456",
    });
    expect(asset).toMatchObject({
      currency: "EUR",
      balances: { cleared: "123456", working: "123456" },
    });
    expect(await register(asset.id)).toEqual([
      expect.objectContaining({ amount: "123456", currency: "EUR" }),
    ]);
    const liability = await addAccount({ name: "Euro debt", type: "liability", currency: "EUR" });
    expect(liability.currency).toBe("EUR");
  });

  it("defaults to the budget's currency", async () => {
    const { addAccount } = await setup();
    expect((await addAccount({ name: "Checking", type: "checking" })).currency).toBe("USD");
    expect((await addAccount({ name: "USD asset", type: "asset", currency: "USD" })).currency).toBe(
      "USD",
    );
  });

  it("stores a JPY account's balance and transactions in yen", async () => {
    const { addAccount, createTransaction, register, accounts } = await setup();
    const yen = await addAccount({
      name: "Tokyo",
      type: "asset",
      currency: "JPY",
      balance: "150000",
    });
    const res = await createTransaction({
      accountId: yen.id,
      amount: "-1200",
      payeeName: "Konbini",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const rows = await register(yen.id);
    expect(rows.map((r) => [r.amount, r.currency])).toEqual(
      expect.arrayContaining([
        ["150000", "JPY"],
        ["-1200", "JPY"],
      ]),
    );
    expect((await accounts()).find((a) => a.id === yen.id)).toMatchObject({
      currency: "JPY",
      balances: { working: "148800" },
    });
  });

  it("adds budget accounts in another currency, their balance converted for the plan", async () => {
    const { addAccount, register } = await setup();
    for (const type of ["checking", "savings", "cash", "credit_card", "line_of_credit"]) {
      const account = await addAccount({ name: `Euro ${type}`, type, currency: "EUR" });
      expect(account.currency).toBe("EUR");
    }
    const euros = await addAccount({
      name: "Euros",
      type: "checking",
      currency: "EUR",
      balance: "10000",
    });
    const [opening] = (await register(euros.id)) as (Txn & {
      baseAmount: string;
      fxRate: string;
    })[];
    expect(opening).toMatchObject({
      amount: "10000",
      currency: "EUR",
      baseAmount: "11000",
      fxRate: "1.1",
    });
  });

  it("keeps loans in the budget's currency", async () => {
    const { createAccount } = await setup();
    await expectError(
      await createAccount({ name: "Euro home", type: "mortgage", currency: "EUR", balance: "-1" }),
      422,
      "LOAN_CURRENCY",
    );
    await expectError(
      await createAccount({ name: "Euro car", type: "auto_loan", currency: "EUR" }),
      422,
      "LOAN_CURRENCY",
    );
  });

  it("doesn't update a foreign liability to a loan", async () => {
    const { cookie, base, addAccount } = await setup();
    const debt = await addAccount({
      name: "Euro debt",
      type: "liability",
      currency: "EUR",
      balance: "-50000",
    });
    const categories = await json<{ groups: Array<{ categories: Array<{ id: string }> }> }>(
      await send("GET", `${base}/categories`, cookie),
    );
    const category = categories.groups.flatMap((g) => g.categories)[0];
    await expectError(
      await send("POST", `${base}/accounts/${debt.id}/update-to-loan`, cookie, {
        name: "Euro mortgage",
        type: "mortgage",
        balance: "-50000",
        date: TODAY,
        pairedCategoryId: category?.id,
      }),
      422,
      "LOAN_CURRENCY",
    );
  });
});

describe("registers with accounts in other currencies", () => {
  it("totals a selection only when it's in one currency", async () => {
    const { cookie, base, addAccount, register } = await setup();
    const yen = await addAccount({ name: "Tokyo", type: "asset", currency: "JPY", balance: "500" });
    const house = await addAccount({ name: "House", type: "asset", balance: "700" });
    const [yenRow] = await register(yen.id);
    const [usdRow] = await register(house.id);
    const summarize = async (ids: string[]) =>
      json<{ count: number; total: string; currency: string | null }>(
        await send("POST", `${base}/transactions/selection`, cookie, { selection: { ids } }),
      );
    expect(await summarize([yenRow?.id ?? ""])).toMatchObject({ total: "500", currency: "JPY" });
    expect(await summarize([yenRow?.id ?? "", usdRow?.id ?? ""])).toMatchObject({
      count: 2,
      total: "0",
      currency: null,
    });
  });

  it("searches an account's register for amounts in its own currency", async () => {
    const { cookie, base, addAccount, createTransaction } = await setup();
    const yen = await addAccount({ name: "Tokyo", type: "asset", currency: "JPY" });
    await createTransaction({ accountId: yen.id, amount: "-1200", payeeName: "Konbini" });
    const search = async (q: string) =>
      (
        await json<{ transactions: Txn[] }>(
          await send(
            "GET",
            `${base}/transactions?accountId=${yen.id}&q=${encodeURIComponent(q)}`,
            cookie,
          ),
        )
      ).transactions.map((t) => t.amount);
    expect(await search("1200")).toEqual(["-1200"]);
    expect(await search("12.00")).toEqual([]);
  });
});

describe("transfers between currencies", () => {
  async function pair() {
    const s = await setup();
    const euro = await s.addAccount({ name: "Euro savings", type: "asset", currency: "EUR" });
    const checking = await s.addAccount({ name: "Checking", type: "checking", balance: "100000" });
    const house = await s.addAccount({ name: "House", type: "asset" });
    return { ...s, euro, checking, house };
  }

  it("refuses moving a transaction into an account in another currency", async () => {
    const { cookie, base, createTransaction, euro, house } = await pair();
    const res = await createTransaction({
      accountId: house.id,
      amount: "-1000",
      payeeName: "Shop",
    });
    const { id } = await json<{ id: string }>(res);
    await expectError(
      await send("PATCH", `${base}/transactions/${id}`, cookie, { accountId: euro.id }),
      422,
      "CROSS_CURRENCY_MOVE",
    );
  });

  it("refuses a scheduled transfer between currencies", async () => {
    const { cookie, base, euro, checking } = await pair();
    await expectError(
      await send("POST", `${base}/scheduled-transactions`, cookie, {
        today: TODAY,
        frequency: "monthly",
        accountId: checking.id,
        date: "2026-11-01",
        amount: "-1000",
        transferAccountId: euro.id,
        memo: "",
      }),
      422,
      "CROSS_CURRENCY_TRANSFER",
    );
  });

  it("still transfers between accounts in the same currency", async () => {
    const { createTransaction, checking, house } = await pair();
    const res = await createTransaction({
      accountId: checking.id,
      amount: "-1000",
      transferAccountId: house.id,
    });
    expect(res.status, await res.clone().text()).toBe(201);
  });
});
