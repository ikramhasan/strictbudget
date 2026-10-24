import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import type { FakeFxProvider } from "../../lib/fx/fake";

// Activity in foreign-currency accounts reaches the plan in the budget's currency, converted
// once at a per-transaction rate.
const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset()
    .seed("2026-10-01", "EUR", { USD: "1.1" })
    .seed("2026-10-10", "EUR", { USD: "1.2" })
    .seed("2026-10-01", "JPY", { USD: "0.0067" })
    .seed("2026-10-01", "KWD", { USD: "3.25" });
});
afterAll(close);

const TODAY = "2026-10-16";

type Txn = {
  id: string;
  amount: string;
  currency: string;
  baseAmount: string;
  fxRate: string | null;
  fxRateManual: boolean;
  subtransactions: { amount: string; baseAmount: string }[];
};
type CategoryMonth = {
  categoryId: string;
  activity: string;
  available: string;
  creditOverspent: string;
  payment: Record<string, string> | null;
};
type Month = { readyToAssign: string; categories: CategoryMonth[] };
type Group = { kind: string | null; categories: { id: string; name: string }[] };

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
  const create = async <T = Txn>(input: Record<string, unknown>, status = 201) => {
    const res = await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
      date: "2026-10-05",
      payeeName: null,
      categoryId: null,
      memo: "",
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(status);
    return json<T>(res);
  };
  const update = async (id: string, input: Record<string, unknown>) => {
    const res = await send("PATCH", `${base}/transactions/${id}?today=${TODAY}`, cookie, input);
    expect(res.status, await res.clone().text()).toBe(200);
    return json<Txn>(res);
  };
  const month = async () => {
    const res = await send("GET", `${base}/months/2026-10?today=${TODAY}`, cookie);
    expect(res.status).toBe(200);
    const body = await json<Month>(res);
    return { ...body, of: (id: string) => body.categories.find((c) => c.categoryId === id) };
  };
  const assign = (categoryId: string, assigned: string) =>
    send("PUT", `${base}/months/2026-10/categories/${categoryId}`, cookie, {
      assigned,
      today: TODAY,
    });
  const { groups } = await json<{ groups: Group[] }>(
    await send("GET", `${base}/categories`, cookie),
  );
  const [first, second] = groups.filter((g) => !g.kind).flatMap((g) => g.categories);
  if (!first || !second) throw new Error("starter data missing");
  return {
    cookie,
    base,
    addAccount,
    create,
    update,
    month,
    assign,
    groceries: first,
    rent: second,
  };
}

describe("foreign-currency activity in the plan", () => {
  it("converts starting balances across exponents into Ready to Assign", async () => {
    const { addAccount, month } = await setup();
    // €100.00 at 1.1, ¥10,000 at 0.0067 and KWD 1.000 at 3.25: $110.00 + $67.00 + $3.25.
    await addAccount({ name: "Euros", type: "checking", currency: "EUR", balance: "10000" });
    await addAccount({ name: "Yen", type: "cash", currency: "JPY", balance: "10000" });
    await addAccount({ name: "Dinars", type: "savings", currency: "KWD", balance: "1000" });
    expect((await month()).readyToAssign).toBe("18025");
  });

  it("counts category activity at the date's rate, or a typed one", async () => {
    const { addAccount, create, month, groceries } = await setup();
    const euros = await addAccount({ name: "Euros", type: "checking", currency: "EUR" });
    const yen = await addAccount({ name: "Yen", type: "cash", currency: "JPY" });
    const spent = await create({ accountId: euros.id, amount: "-1000", categoryId: groceries.id });
    expect(spent).toMatchObject({ amount: "-1000", currency: "EUR", baseAmount: "-1100" });
    expect(spent).toMatchObject({ fxRate: "1.1", fxRateManual: false });
    const typed = await create({
      accountId: yen.id,
      amount: "-1000",
      categoryId: groceries.id,
      fxRate: "0.007",
    });
    expect(typed).toMatchObject({ baseAmount: "-700", fxRate: "0.007", fxRateManual: true });
    expect((await month()).of(groceries.id)?.activity).toBe("-1800");
  });

  it("keeps the rate when the amount changes and looks it up again when the date does", async () => {
    const { addAccount, create, update } = await setup();
    const euros = await addAccount({ name: "Euros", type: "checking", currency: "EUR" });
    const t = await create({ accountId: euros.id, amount: "-1000", payeeName: "Shop" });
    expect((await update(t.id, { amount: "-2000" })).baseAmount).toBe("-2200");
    // On the 12th the rate is 1.2.
    expect(await update(t.id, { date: "2026-10-12" })).toMatchObject({
      fxRate: "1.2",
      baseAmount: "-2400",
    });
    // A typed rate stays through a date change; null goes back to the date's.
    await update(t.id, { fxRate: "1.15" });
    expect(await update(t.id, { date: "2026-10-05" })).toMatchObject({
      fxRate: "1.15",
      baseAmount: "-2300",
      fxRateManual: true,
    });
    expect(await update(t.id, { fxRate: null })).toMatchObject({
      fxRate: "1.1",
      baseAmount: "-2200",
      fxRateManual: false,
    });
  });

  it("splits so the lines add up to the converted parent", async () => {
    const { addAccount, create, month, groceries, rent } = await setup();
    const yen = await addAccount({ name: "Yen", type: "cash", currency: "JPY" });
    // ¥-1,001 and ¥1 at 0.0067: the lines round to $-6.71 and $0.01, the whole to $-6.70.
    const split = await create({
      accountId: yen.id,
      amount: "-1000",
      payeeName: "Konbini",
      subtransactions: [
        { amount: "-1001", categoryId: groceries.id, memo: "" },
        { amount: "1", categoryId: rent.id, memo: "" },
      ],
    });
    expect(split.baseAmount).toBe("-670");
    const lines = split.subtransactions.map((l) => BigInt(l.baseAmount));
    expect(lines.reduce((a, b) => a + b, 0n)).toBe(-670n);
    const m = await month();
    expect(BigInt(m.of(groceries.id)?.activity ?? 0) + BigInt(m.of(rent.id)?.activity ?? 0)).toBe(
      -670n,
    );
  });

  it("funds a foreign card's spending and its credit overspending in the budget's currency", async () => {
    const { addAccount, create, month, assign, groceries, rent } = await setup();
    await addAccount({ name: "Checking", type: "checking", balance: "100000" });
    const card = await addAccount({ name: "Euro card", type: "credit_card", currency: "EUR" });
    expect((await assign(groceries.id, "10000")).status).toBe(200);
    // €50.00 = $55.00, funded from Groceries; €20.00 = $22.00 on Rent with nothing assigned.
    await create({ accountId: card.id, amount: "-5000", categoryId: groceries.id });
    await create({ accountId: card.id, amount: "-2000", categoryId: rent.id });
    const m = await month();
    expect(m.of(groceries.id)?.available).toBe("4500");
    expect(m.of(rent.id)?.creditOverspent).toBe("-2200");
    const payment = m.categories.find((c) => c.payment !== null);
    expect(payment?.available).toBe("5500");
    // The card owes €70.00 = $77.00 as booked; $22.00 of it is underfunded.
    expect(payment?.payment?.balance).toBe("-7700");
    expect(payment?.payment?.underfunded).toBe("2200");
  });

  it("gives a transfer's sides opposite base amounts", async () => {
    const { cookie, base, addAccount, create, month } = await setup();
    const euros = await addAccount({ name: "Euros", type: "checking", currency: "EUR" });
    const savings = await addAccount({ name: "Euro savings", type: "savings", currency: "EUR" });
    const t = await create({ accountId: euros.id, amount: "-1000", transferAccountId: savings.id });
    expect(t.baseAmount).toBe("-1100");
    const { transactions } = await json<{ transactions: Txn[] }>(
      await send("GET", `${base}/transactions?accountId=${savings.id}&today=${TODAY}`, cookie),
    );
    expect(transactions[0]).toMatchObject({ amount: "1000", baseAmount: "1100", fxRate: "1.1" });
    expect((await month()).readyToAssign).toBe("0");
  });

  it("asks for a rate when none is available", async () => {
    const { addAccount, create } = await setup();
    const euros = await addAccount({ name: "Euros", type: "checking", currency: "EUR" });
    fx.failing = true;
    await db.execute("delete from fx_rate");
    const res = await create<{ error: { code: string } }>(
      { accountId: euros.id, amount: "-1000", payeeName: "Shop" },
      422,
    );
    expect(res).toMatchObject({ error: { code: "FX_RATE_UNAVAILABLE" } });
    const typed = await create({
      accountId: euros.id,
      amount: "-1000",
      payeeName: "Shop",
      fxRate: "1.05",
    });
    expect(typed.baseAmount).toBe("-1050");
  });

  it("converts the lines of a foreign split that totals zero", async () => {
    const { addAccount, create, month, groceries, rent } = await setup();
    const yen = await addAccount({ name: "Yen", type: "cash", currency: "JPY" });
    const split = await create({
      accountId: yen.id,
      amount: "0",
      payeeName: "Swap",
      subtransactions: [
        { amount: "-10000", categoryId: groceries.id, memo: "" },
        { amount: "10000", categoryId: rent.id, memo: "" },
      ],
    });
    expect(split).toMatchObject({ baseAmount: "0", fxRate: "0.0067" });
    expect(split.subtransactions.map((l) => l.baseAmount)).toEqual(["-6700", "6700"]);
    expect((await month()).of(groceries.id)?.activity).toBe("-6700");
  });

  it("keeps the booked base amount when only the memo changes", async () => {
    const { addAccount, create, update } = await setup();
    const euros = await addAccount({ name: "Euros", type: "checking", currency: "EUR" });
    const t = await create({ accountId: euros.id, amount: "-1000", payeeName: "Shop" });
    // A rate that no longer matches the booked amount (as an implied or rounded one can).
    await db.execute(`update transaction set fx_rate = 2 where id = '${t.id}'`);
    expect((await update(t.id, { memo: "note", flag: "red" })).baseAmount).toBe("-1100");
    expect((await update(t.id, { amount: "-1000" })).baseAmount).toBe("-1100");
  });

  it("counts a foreign schedule in Upcoming, looking up a rate no read cached yet", async () => {
    const { cookie, base, addAccount, month, groceries } = await setup();
    const euros = await addAccount({ name: "Euros", type: "checking", currency: "EUR" });
    const res = await send("POST", `${base}/scheduled-transactions`, cookie, {
      accountId: euros.id,
      today: TODAY,
      date: "2026-10-20",
      amount: "-5000",
      categoryId: groceries.id,
      payeeName: null,
      memo: "",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    await db.execute("delete from fx_rate");
    const upcoming = (await month()).of(groceries.id) as unknown as {
      upcoming: { amount: string };
    };
    // Today's rate (the 10th's, 1.2): €-50.00 is $-60.00.
    expect(upcoming.upcoming.amount).toBe("-6000");
  });

  it("leaves a due foreign schedule waiting while no rate is available, without failing reads", async () => {
    const { cookie, base, addAccount, groceries } = await setup();
    const euros = await addAccount({ name: "Euros", type: "checking", currency: "EUR" });
    const res = await send("POST", `${base}/scheduled-transactions`, cookie, {
      accountId: euros.id,
      today: TODAY,
      date: "2026-10-20",
      frequency: "monthly",
      amount: "-5000",
      categoryId: groceries.id,
      payeeName: null,
      memo: "",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    await db.execute("delete from fx_rate");
    fx.failing = true;
    const read = (today: string) =>
      send("GET", `${base}/transactions?accountId=${euros.id}&today=${today}`, cookie);
    const waiting = await read("2026-10-20");
    expect(waiting.status, await waiting.clone().text()).toBe(200);
    expect((await json<{ transactions: Txn[] }>(waiting)).transactions).toHaveLength(1);
    // Once a rate can be found, the next read enters it.
    fx.reset().seed("2026-10-01", "EUR", { USD: "1.1" });
    const entered = await json<{ transactions: Txn[] }>(await read("2026-10-20"));
    expect(entered.transactions.map((t) => t.amount)).toContain("-5000");
  });

  it("doesn't ask a provider that just failed again for the same day", async () => {
    const { cookie, base } = await setup();
    await db.execute("delete from fx_rate");
    fx.failing = true;
    const look = () =>
      send("GET", `${base}/fx-rates?from=KWD&date=2026-10-03&today=${TODAY}`, cookie);
    expect((await look()).status).toBe(422);
    const calls = fx.calls.length;
    expect((await look()).status).toBe(422);
    expect(fx.calls.length).toBe(calls);
  });
});
