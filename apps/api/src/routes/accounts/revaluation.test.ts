import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import type { FakeFxProvider } from "../../lib/fx/fake";

// Unrealized FX gain/loss on foreign-currency accounts, and revaluing it into the budget (Ready
// to Assign for budget accounts).
const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset().seed("2026-10-01", "EUR", { USD: "1.1" }).seed("2026-10-10", "EUR", { USD: "1.2" });
});
afterAll(close);

const TODAY = "2026-10-16";

type Account = {
  id: string;
  balances: { working: string };
  unrealizedGain: string | null;
  rate: string | null;
  rateDate: string | null;
};
type Txn = {
  id: string;
  amount: string;
  baseAmount: string;
  fxRate: string | null;
  payeeName: string | null;
  categoryId: string | null;
  cleared: string;
  memo: string;
};
type Payment = { balance: string; underfunded: string };
type Month = {
  readyToAssign: string;
  categories: { categoryId: string; available: string; payment: Payment | null }[];
};
type ErrorBody = { error: { code: string } };

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
    return json<Account & { paymentCategoryId: string | null }>(res);
  };
  const accounts = async () =>
    (
      await json<{ accounts: Account[] }>(
        await send("GET", `${base}/accounts?today=${TODAY}`, cookie),
      )
    ).accounts;
  const account = async (id: string) => (await accounts()).find((a) => a.id === id) as Account;
  /** Looks up (and caches) today's rate, as the app does whenever a rate is asked for. */
  const warmRate = async () => {
    const res = await send("GET", `${base}/fx-rates?from=EUR&date=${TODAY}&today=${TODAY}`, cookie);
    expect(res.status).toBe(200);
  };
  const revalue = (id: string, date = TODAY) =>
    send("POST", `${base}/accounts/${id}/revalue`, cookie, { date, today: TODAY });
  const month = async () =>
    json<Month>(await send("GET", `${base}/months/2026-10?today=${TODAY}`, cookie));
  const register = async (id: string) =>
    (
      await json<{ transactions: Txn[] }>(
        await send("GET", `${base}/transactions?accountId=${id}&today=${TODAY}`, cookie),
      )
    ).transactions;
  return { cookie, base, addAccount, accounts, account, warmRate, revalue, month, register };
}

describe("unrealized FX gain/loss", () => {
  it("is today's value less the booked amount, at the known rate", async () => {
    const { addAccount, account, warmRate } = await setup();
    // €100.00 booked at 1.1 = $110.00.
    const euros = await addAccount({
      name: "Euros",
      type: "checking",
      currency: "EUR",
      balance: "10000",
    });
    const usd = await addAccount({ name: "Dollars", type: "checking", balance: "5000" });
    // Only the 1 October rate is known so far: no gain, and no provider is asked.
    const calls = fx.calls.length;
    expect(await account(euros.id)).toMatchObject({
      unrealizedGain: "0",
      rate: "1.1",
      rateDate: "2026-10-01",
    });
    expect(fx.calls.length).toBe(calls);
    // The rate moved to 1.2 on 10 October: €100.00 is now $120.00.
    await warmRate();
    expect(await account(euros.id)).toMatchObject({
      unrealizedGain: "1000",
      rate: "1.2",
      rateDate: "2026-10-10",
    });
    expect(await account(usd.id)).toMatchObject({
      unrealizedGain: null,
      rate: null,
      rateDate: null,
    });
  });

  it("is null when no rate is known", async () => {
    const { addAccount, account } = await setup();
    // A zero starting balance needs no rate, so none is fetched.
    const euros = await addAccount({ name: "Euros", type: "checking", currency: "EUR" });
    expect((await account(euros.id)).unrealizedGain).toBeNull();
  });
});

describe("revaluing an account", () => {
  it("posts exactly the difference into Ready to Assign, then nothing", async () => {
    const { addAccount, account, revalue, month, register } = await setup();
    const euros = await addAccount({
      name: "Euros",
      type: "checking",
      currency: "EUR",
      balance: "10000",
    });
    expect((await month()).readyToAssign).toBe("11000");

    const res = await revalue(euros.id);
    expect(res.status, await res.clone().text()).toBe(200);
    const { transaction, account: after } = await json<{ transaction: Txn; account: Account }>(res);
    expect(transaction).toMatchObject({ date: TODAY, baseAmount: "1000", fxRate: "1.2" });
    expect((await register(euros.id)).find((t) => t.id === transaction.id)).toMatchObject({
      amount: "0",
      baseAmount: "1000",
      fxRate: "1.2",
      payeeName: "FX Revaluation",
      cleared: "cleared",
    });
    expect(after).toMatchObject({ unrealizedGain: "0", balances: { working: "10000" } });
    expect((await month()).readyToAssign).toBe("12000");

    // Same date, same rate: nothing left to post.
    const again = await revalue(euros.id);
    expect(again.status).toBe(200);
    expect((await json<{ transaction: Txn | null }>(again)).transaction).toBeNull();
    expect((await register(euros.id)).length).toBe(2);
    expect((await account(euros.id)).unrealizedGain).toBe("0");
    expect((await month()).readyToAssign).toBe("12000");
  });

  it("books a loss too, and deleting it takes it back", async () => {
    const { cookie, base, addAccount, revalue, month } = await setup();
    fx.seed("2026-10-12", "EUR", { USD: "1.05" });
    const euros = await addAccount({
      name: "Euros",
      type: "savings",
      currency: "EUR",
      balance: "10000",
    });
    const { transaction } = await json<{ transaction: Txn }>(await revalue(euros.id));
    expect(transaction.baseAmount).toBe("-500");
    expect((await month()).readyToAssign).toBe("10500");
    const res = await send("DELETE", `${base}/transactions/${transaction.id}`, cookie);
    expect(res.status).toBe(204);
    expect((await month()).readyToAssign).toBe("11000");
  });

  it("leaves a tracking account uncategorized, outside Ready to Assign", async () => {
    const { addAccount, revalue, month, register } = await setup();
    const asset = await addAccount({
      name: "Euro flat",
      type: "asset",
      currency: "EUR",
      balance: "10000",
    });
    const before = (await month()).readyToAssign;
    const { transaction } = await json<{ transaction: Txn }>(await revalue(asset.id));
    expect((await register(asset.id)).find((t) => t.id === transaction.id)).toMatchObject({
      baseAmount: "1000",
      categoryId: null,
    });
    expect((await month()).readyToAssign).toBe(before);
  });

  it("on a card that owes, a loss adds to what's owed and to what's underfunded", async () => {
    const { addAccount, revalue, month } = await setup();
    // Owes €100.00, booked at $110.00; nothing is set aside for it.
    const card = await addAccount({
      name: "Euro card",
      type: "credit_card",
      currency: "EUR",
      balance: "-10000",
    });
    const payment = async () => {
      const m = await month();
      const row = m.categories.find((c) => c.categoryId === card.paymentCategoryId);
      return { readyToAssign: m.readyToAssign, available: row?.available, ...row?.payment };
    };
    const before = await payment();
    expect(before).toMatchObject({ balance: "-11000", underfunded: "11000", available: "0" });

    // At 1.2 it owes $120.00: a $10.00 loss.
    const { transaction } = await json<{ transaction: Txn }>(await revalue(card.id));
    expect(transaction.baseAmount).toBe("-1000");
    // No money is made or lost in the budget: Ready to Assign stays and the payment category
    // falls $10.00 further short of the balance.
    expect(await payment()).toMatchObject({
      readyToAssign: before.readyToAssign,
      available: "0",
      balance: "-12000",
      underfunded: "12000",
    });
  });

  it("on a card with money above zero, the change goes to Ready to Assign", async () => {
    const { addAccount, revalue, month } = await setup();
    // A card €100.00 in credit (a refund), worth $110.00 in Ready to Assign.
    const card = await addAccount({
      name: "Euro card",
      type: "credit_card",
      currency: "EUR",
      balance: "10000",
    });
    expect((await month()).readyToAssign).toBe("11000");
    await revalue(card.id);
    expect((await month()).readyToAssign).toBe("12000");
  });

  it("refuses budget-currency, closed and future revaluations", async () => {
    const { cookie, base, addAccount, revalue } = await setup();
    const usd = await addAccount({ name: "Dollars", type: "checking", balance: "100" });
    const expectCode = async (res: Response, status: number, code: string) => {
      expect(res.status, await res.clone().text()).toBe(status);
      expect((await json<ErrorBody>(res)).error.code).toBe(code);
    };
    await expectCode(await revalue(usd.id), 400, "NOT_FOREIGN_CURRENCY");
    const euros = await addAccount({ name: "Euros", type: "checking", currency: "EUR" });
    await expectCode(await revalue(euros.id, "2026-10-17"), 400, "DATE_IN_FUTURE");
    await send("POST", `${base}/accounts/${euros.id}/close`, cookie, { date: TODAY });
    await expectCode(await revalue(euros.id), 400, "ACCOUNT_CLOSED");
  });

  it("locks a revaluation's amount, date, account and payee", async () => {
    const { cookie, base, addAccount, revalue, register } = await setup();
    const euros = await addAccount({
      name: "Euros",
      type: "checking",
      currency: "EUR",
      balance: "10000",
    });
    const other = await addAccount({ name: "More euros", type: "checking", currency: "EUR" });
    const { transaction } = await json<{ transaction: Txn }>(await revalue(euros.id));
    const edit = (body: Record<string, unknown>) =>
      send("PATCH", `${base}/transactions/${transaction.id}?today=${TODAY}`, cookie, body);
    for (const body of [
      { amount: "100" },
      { date: "2026-10-15" },
      { accountId: other.id },
      { payeeName: "Someone" },
      { fxRate: "1.3" },
    ]) {
      const res = await edit(body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect((await json<ErrorBody>(res)).error.code).toBe("REVALUATION_LOCKED");
    }
    // Saving the row as it is, with a new memo, is fine and keeps its base amount.
    const saved = await edit({
      amount: "0",
      date: TODAY,
      payeeName: "FX Revaluation",
      fxRate: "1.2",
      memo: "October",
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const row = (await register(euros.id)).find((t) => t.id === transaction.id);
    expect(row).toMatchObject({ memo: "October", baseAmount: "1000", amount: "0" });
  });

  it("takes an undo's whole-row edit, and restores a deleted one with its base amount", async () => {
    const { cookie, base, addAccount, revalue, register, month } = await setup();
    const euros = await addAccount({
      name: "Euros",
      type: "checking",
      currency: "EUR",
      balance: "10000",
    });
    const { transaction } = await json<{ transaction: Txn }>(await revalue(euros.id));
    // An undo sends every field, the rate as null ("the date's") because it wasn't typed.
    const undone = await send(
      "PATCH",
      `${base}/transactions/${transaction.id}?today=${TODAY}`,
      cookie,
      {
        accountId: euros.id,
        date: TODAY,
        amount: "0",
        payeeName: "FX Revaluation",
        memo: "",
        flag: null,
        fxRate: null,
      },
    );
    expect(undone.status, await undone.clone().text()).toBe(200);
    expect((await register(euros.id)).find((t) => t.id === transaction.id)?.baseAmount).toBe(
      "1000",
    );

    // Deleted and brought back by undo: its booked base amount comes back too.
    const row = (await register(euros.id)).find((t) => t.id === transaction.id) as Txn & {
      categoryId: string;
    };
    expect((await send("DELETE", `${base}/transactions/${transaction.id}`, cookie)).status).toBe(
      204,
    );
    const restore = (body: Record<string, unknown>) =>
      send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
        accountId: euros.id,
        date: TODAY,
        amount: "0",
        payeeName: "FX Revaluation",
        categoryId: row.categoryId,
        memo: "",
        cleared: "cleared",
        flag: null,
        baseAmount: "1000",
        fxRate: "1.2",
        ...body,
      });
    expect((await restore({ restore: false })).status).toBe(400);
    expect((await restore({ payeeName: "Shop", restore: true })).status).toBe(400);
    const back = await restore({ restore: true });
    expect(back.status, await back.clone().text()).toBe(201);
    expect(await json<Txn>(back)).toMatchObject({ amount: "0", baseAmount: "1000", fxRate: "1.2" });
    expect((await month()).readyToAssign).toBe("12000");
  });

  it("leaves revaluations out of a bulk Duplicate", async () => {
    const { cookie, base, addAccount, revalue, register } = await setup();
    const euros = await addAccount({
      name: "Euros",
      type: "checking",
      currency: "EUR",
      balance: "10000",
    });
    const { transaction } = await json<{ transaction: Txn }>(await revalue(euros.id));
    const res = await send("POST", `${base}/transactions/bulk?today=${TODAY}`, cookie, {
      selection: { ids: [transaction.id] },
      action: { type: "duplicate" },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await register(euros.id)).length).toBe(2);
  });
});
