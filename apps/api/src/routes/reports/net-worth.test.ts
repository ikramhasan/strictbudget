import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import type { FakeFxProvider } from "../../lib/fx/fake";

const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset();
});
afterAll(close);

const TODAY = "2026-10-20";

type Totals = { assets: string; debts: string; netWorth: string };
type Parts = { netSaved: string; debtPaidDown: string; tracking: string; other: string };
type Month = Totals & { month: string; allTimeHigh: boolean; missing: string[]; parts: Parts };
type Balance = { native: string; base: string | null };
type Report = {
  currency: string;
  firstMonth: string | null;
  opening: Totals & { month: string };
  months: Month[];
  accounts: {
    id: string;
    name: string;
    type: string;
    onBudget: boolean;
    closed: boolean;
    currency: string;
    firstMonth: string | null;
    opening: Balance;
    balances: Balance[];
  }[];
  rates: { currency: string; month: string; rate: string | null; rateDate: string | null }[];
};

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup(currency = "USD") {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie, { currency });
  const base = `/v1/budgets/${budget.id}`;
  const account = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/accounts`, cookie, {
      balance: "0",
      date: "2026-07-01",
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<{ id: string }>(res);
  };
  const add = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
      cleared: "cleared",
      categoryId: null,
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<{ id: string }>(res);
  };
  const report = async (query: string, today = TODAY) => {
    const res = await send("GET", `${base}/reports/net-worth?today=${today}&${query}`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return json<Report>(res);
  };
  return { cookie, base, account, add, report };
}

const sumParts = (p: Parts) =>
  BigInt(p.netSaved) + BigInt(p.debtPaidDown) + BigInt(p.tracking) + BigInt(p.other);

/** Every month's parts add up to its change from the month before. */
function expectPartsAddUp(r: Report) {
  let previous = BigInt(r.opening.netWorth);
  for (const m of r.months) {
    expect(sumParts(m.parts), m.month).toBe(BigInt(m.netWorth) - previous);
    previous = BigInt(m.netWorth);
  }
}

describe("net worth report", () => {
  it("adds every account's month-end balance, split into assets and debts by sign", async () => {
    const { cookie, base, account, add, report } = await setup();
    const checking = await account({ name: "Checking", type: "checking", balance: "100000" });
    const card = await account({ name: "Visa", type: "credit_card", balance: "-20000" });
    const house = await account({ name: "House", type: "asset", balance: "500000" });
    const old = await account({ name: "Old Savings", type: "savings", balance: "3000" });
    const negativeAsset = await account({ name: "Odd", type: "asset" });

    // August: income, card spending (uncleared counts), a transfer to the card (cancels out).
    await add({ accountId: checking.id, date: "2026-08-05", amount: "300000", payeeName: "Job" });
    await add({
      accountId: card.id,
      date: "2026-08-10",
      amount: "-12000",
      payeeName: "Shop",
      cleared: "uncleared",
    });
    await add({
      accountId: checking.id,
      date: "2026-08-20",
      amount: "-20000",
      transferAccountId: card.id,
    });
    // September: money into the house's tracking account, a value update, an asset gone negative.
    await add({
      accountId: checking.id,
      date: "2026-09-02",
      amount: "-50000",
      transferAccountId: house.id,
    });
    await add({ accountId: house.id, date: "2026-09-30", amount: "4000", payeeName: "Valuation" });
    await add({
      accountId: negativeAsset.id,
      date: "2026-09-15",
      amount: "-600",
      payeeName: "Fee",
    });
    // October: the old account is closed; its $30 leaves with a balance adjustment.
    const closed = await send("POST", `${base}/accounts/${old.id}/close`, cookie, {
      date: "2026-10-03",
    });
    expect(closed.status).toBe(200);

    const r = await report("from=2026-07&to=2026-10");
    expect(r.currency).toBe("USD");
    expect(r.firstMonth).toBe("2026-07");
    expect(r.opening).toEqual({ month: "2026-06", assets: "0", debts: "0", netWorth: "0" });
    expect(
      r.months.map(({ month, assets, debts, netWorth }) => [month, assets, debts, netWorth]),
    ).toEqual([
      ["2026-07", "603000", "-20000", "583000"],
      ["2026-08", "883000", "-12000", "871000"],
      ["2026-09", "887000", "-12600", "874400"],
      ["2026-10", "884000", "-12600", "871400"],
    ]);
    expectPartsAddUp(r);
    // July: everything is a starting balance.
    expect(r.months[0]?.parts).toEqual({
      netSaved: "0",
      debtPaidDown: "0",
      tracking: "0",
      other: "583000",
    });
    // August: $3,000 in, $120 spent on the card; the card payment cancels out.
    expect(r.months[1]?.parts).toEqual({
      netSaved: "288000",
      debtPaidDown: "0",
      tracking: "0",
      other: "0",
    });
    // September: $500 sent to the house counts as spent from the budget and added to tracking.
    expect(r.months[2]?.parts).toEqual({
      netSaved: "-50000",
      debtPaidDown: "0",
      tracking: "53400",
      other: "0",
    });
    // The closed account is listed with its history and 0 now.
    const oldRow = r.accounts.find((a) => a.id === old.id);
    expect(oldRow).toMatchObject({ closed: true, onBudget: true, firstMonth: "2026-07" });
    expect(oldRow?.balances.map((b) => b.native)).toEqual(["3000", "3000", "3000", "0"]);
    // Accounts come in the order they were made.
    expect(r.accounts.map((a) => a.name)).toEqual([
      "Checking",
      "Visa",
      "House",
      "Old Savings",
      "Odd",
    ]);
    // The current month is today's balance, matching the account list's working balances.
    const list = await json<{ accounts: { id: string; balances: { working: string } }[] }>(
      await send("GET", `${base}/accounts?today=${TODAY}`, cookie),
    );
    for (const a of r.accounts) {
      expect(a.balances.at(-1)?.native, a.name).toBe(
        list.accounts.find((x) => x.id === a.id)?.balances.working,
      );
    }
    // October: closing the old account took its $30 out of the budget.
    expect(r.months[3]?.parts).toMatchObject({ netSaved: "-3000", other: "0" });
    // All-time highs: August and September each beat every month before; October doesn't.
    expect(r.months.map((m) => m.allTimeHigh)).toEqual([false, true, true, false]);
    // On October 2nd the closing adjustment (October 3rd) hasn't happened yet.
    const early = await report("from=2026-10&to=2026-10", "2026-10-02");
    expect(early.accounts.find((a) => a.id === old.id)?.balances[0]?.native).toBe("3000");
    expect(early.months[0]?.netWorth).toBe("874400");
  });

  it("includes a loan's interest and escrow in its month-end balance", async () => {
    const { cookie, base, account, report } = await setup();
    const checking = await account({ name: "Checking", type: "checking", balance: "2000000" });
    const mortgage = await account({
      name: "Mortgage",
      type: "mortgage",
      balance: "-10000000",
      interestRate: "5.125",
      minimumPayment: "90000",
      escrowAmount: "15000",
    });
    for (const date of ["2026-08-05", "2026-09-05", "2026-10-05"]) {
      const res = await send("POST", `${base}/accounts/${mortgage.id}/loan/payments`, cookie, {
        fromAccountId: checking.id,
        amount: "90000",
        date,
      });
      expect(res.status, await res.clone().text()).toBe(201);
    }
    const loan = await json<{ months: { month: string; endBalance: string }[] }>(
      await send("GET", `${base}/accounts/${mortgage.id}/loan?today=${TODAY}`, cookie),
    );
    const r = await report("from=2026-07&to=2026-10");
    const row = r.accounts.find((a) => a.id === mortgage.id);
    expect(row?.balances.map((b) => b.native)).toEqual(
      loan.months.filter((m) => m.month >= "2026-07").map((m) => m.endBalance),
    );
    expectPartsAddUp(r);
    // September: the payment comes out of the budget and pays the loan down; interest and
    // escrow are the other part.
    const sep = r.months[2];
    const sepLoan = loan.months.find((m) => m.month === "2026-09");
    const augLoan = loan.months.find((m) => m.month === "2026-08");
    expect(sep?.parts.netSaved).toBe("-90000");
    expect(sep?.parts.debtPaidDown).toBe("90000");
    expect(sep?.parts.tracking).toBe("0");
    expect(BigInt(sep?.parts.other ?? "")).toBe(
      BigInt(sepLoan?.endBalance ?? "") - BigInt(augLoan?.endBalance ?? "") - 90000n,
    );
    expect(BigInt(sep?.parts.other ?? "")).toBeLessThan(0n);
  });

  it("converts foreign balances at each month-end's rate", async () => {
    fx.seed("2026-07-01", "EUR", { USD: "1.1" })
      .seed("2026-08-31", "EUR", { USD: "1.2" })
      .seed("2026-09-30", "EUR", { USD: "1.15" });
    const { account, add, report } = await setup();
    const dollars = await account({ name: "Dollars", type: "checking", balance: "10000" });
    const euros = await account({
      name: "Euros",
      type: "savings",
      currency: "EUR",
      balance: "10000",
    });
    await add({
      accountId: euros.id,
      date: "2026-08-10",
      amount: "5000",
      payeeName: "Gift",
      fxRate: "1.15",
    });
    // A yen account no rate is known for: left out of the totals.
    const yen = await account({ name: "Yen", type: "cash", currency: "JPY" });
    await add({
      accountId: yen.id,
      date: "2026-09-10",
      amount: "1000",
      payeeName: "Found",
      fxRate: "0.0067",
    });

    const r = await report("from=2026-07&to=2026-09");
    const eur = r.accounts.find((a) => a.id === euros.id);
    expect(eur?.balances).toEqual([
      { native: "10000", base: "11000" },
      { native: "15000", base: "18000" },
      { native: "15000", base: "17250" },
    ]);
    expect(r.months.map((m) => m.netWorth)).toEqual(["21000", "28000", "27250"]);
    expectPartsAddUp(r);
    // August: the gift is booked at 1.15 ($57.50); the rest is the rate moving to 1.2.
    expect(r.months[1]?.parts).toMatchObject({ netSaved: "5750", other: "1250" });
    expect(r.rates).toContainEqual({
      currency: "EUR",
      month: "2026-08",
      rate: "1.2",
      rateDate: "2026-08-31",
    });
    // The yen account has a balance from September but no rate (fake provider knows none).
    const sep = r.months[2];
    const yenRow = r.accounts.find((a) => a.id === yen.id);
    expect(yenRow?.balances[2]).toMatchObject({ native: "1000" });
    expect(yenRow?.balances[2]?.base).toBeNull();
    expect(sep?.missing).toEqual([yen.id]);
    // Left out of the totals, so its booked gift is left out of what changed too: September's
    // change is all the euro rate moving.
    expect(sep?.parts).toMatchObject({ netSaved: "0", other: "-750" });
    expect(r.accounts.find((a) => a.id === dollars.id)?.balances[0]).toEqual({
      native: "10000",
      base: "10000",
    });
  });

  it("looks up a foreign currency's rates only from its first transaction", async () => {
    fx.seed("2000-01-01", "EUR", { USD: "1.1" });
    const { account, report } = await setup();
    await account({ name: "Euros", type: "savings", currency: "EUR", balance: "10000" });

    const r = await report("from=2026-01&to=2026-10");
    // The account opens 2026-07-01: rates for July to October only.
    expect(r.rates.map((x) => x.month)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(r.months[0]?.netWorth).toBe("0");
    expect(r.months[6]?.netWorth).toBe("11000");

    // A century-wide range asks the provider only for the months with a balance.
    fx.calls.length = 0;
    const wide = await report("from=1926-10&to=2026-09");
    expect(wide.months).toHaveLength(1200);
    expect(wide.rates).toHaveLength(3);
    expect(fx.calls.length).toBeLessThanOrEqual(3);
  });

  it("filters accounts and checks the range", async () => {
    const { cookie, base, account, report } = await setup();
    const a = await account({ name: "A", type: "checking", balance: "1000" });
    await account({ name: "B", type: "checking", balance: "2000" });
    const r = await report(`from=2026-10&to=2026-10&accountIds=${a.id}`);
    expect(r.accounts.map((x) => x.id)).toEqual([a.id]);
    expect(r.months[0]?.netWorth).toBe("1000");
    const bad = await send("GET", `${base}/reports/net-worth?from=2026-10&to=2026-09`, cookie);
    expect(bad.status).toBe(400);
    const { cookie: other } = await signUp(app);
    const hidden = await send("GET", `${base}/reports/net-worth?from=2026-10&to=2026-10`, other);
    expect(hidden.status).toBe(404);
  });

  it("caps the range and bounds the walk", async () => {
    const { cookie, base, account, add, report } = await setup();
    const a = await account({ name: "A", type: "checking", balance: "1000" });
    await add({ accountId: a.id, date: "2026-09-05", amount: "2000", payeeName: "Job" });

    const huge = await send("GET", `${base}/reports/net-worth?from=0001-01&to=9999-12`, cookie);
    expect(huge.status).toBe(400);
    // Its opening (the month before) has to be a month too.
    const first = await send("GET", `${base}/reports/net-worth?from=0000-01&to=0000-02`, cookie);
    expect(first.status).toBe(400);
    const over = await send("GET", `${base}/reports/net-worth?from=2026-10&to=2126-10`, cookie);
    expect(over.status).toBe(400);
    const longest = await report("from=2026-10&to=2126-09");
    expect(longest.months).toHaveLength(1200);
    expect(longest.months.at(-1)?.netWorth).toBe("3000");

    // Far after the transactions: the balances they left, carried over the skipped months.
    const later = await report("from=9000-01&to=9000-02");
    expect(later.firstMonth).toBe("2026-07");
    expect(later.opening.netWorth).toBe("3000");
    expect(later.months.map((m) => [m.netWorth, m.allTimeHigh])).toEqual([
      ["3000", false],
      ["3000", false],
    ]);
    expect(later.accounts[0]?.opening.native).toBe("3000");
    expectPartsAddUp(later);

    // Far before them: nothing yet.
    const earlier = await report("from=1000-01&to=1000-02");
    expect(earlier.months.map((m) => m.netWorth)).toEqual(["0", "0"]);
  });
});

describe("net worth report's today", () => {
  const bounded = createTestApp({ serverDate: () => TODAY });
  afterAll(bounded.close);

  // `today` sets how far a loan's charges run, so it's held near the server's date.
  it("is held within a day of the server's date", async () => {
    const { cookie } = await signUp(bounded.app);
    const budget = await createBudget(bounded.app, cookie);
    const base = `/v1/budgets/${budget.id}`;
    const call = (method: string, path: string, body?: unknown) =>
      bounded.app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    // A rate from far in the future: it applies only if the report's today reaches it.
    (bounded.fxProviders[0] as FakeFxProvider)
      .reset()
      .seed("2026-07-01", "EUR", { USD: "1.1" })
      .seed("3000-01-01", "EUR", { USD: "2" });
    const created = await call("POST", `${base}/accounts`, {
      name: "Euros",
      type: "savings",
      currency: "EUR",
      balance: "10000",
      date: "2026-07-01",
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const res = await call(
      "GET",
      `${base}/reports/net-worth?from=9999-01&to=9999-02&today=9999-12-31`,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const r = await json<Report>(res);
    // The made-up today counts as the server's.
    expect(r.months.map((m) => m.netWorth)).toEqual(["11000", "11000"]);
    expect(r.rates.every((x) => x.rateDate !== null && x.rateDate <= "2026-10-21")).toBe(true);
  });
});
