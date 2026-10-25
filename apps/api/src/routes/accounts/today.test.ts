import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Account = { id: string; name: string; balances: { working: string } };

// Well after the server's real date, so only the user's `today` brings it into balances.
const AHEAD = "2030-01-10";
const BEFORE = "2030-01-05";

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
  const addAccount = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/accounts`, cookie, { date: "2026-10-01", ...input });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as Account;
  };
  const checking = await addAccount({ name: "Checking", type: "checking", balance: "100000" });
  const savings = await addAccount({ name: "Savings", type: "savings", balance: "0" });
  // Dated ahead of the server: the test app leaves the date unbounded without a `today`.
  const res = await send("POST", `${base}/transactions`, cookie, {
    accountId: checking.id,
    date: AHEAD,
    amount: "-25000",
    payeeName: "Shop",
    categoryId: null,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return { cookie, base, checking, savings, addAccount };
}

const working = async (res: Response, id?: string) => {
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  const body = (await res.json()) as Account | { accounts: Account[] };
  const account = "accounts" in body ? body.accounts.find((a) => a.id === id) : body;
  return account?.balances.working;
};

describe("account responses take the user's today", () => {
  it("move", async () => {
    const { cookie, base, checking, savings } = await setup();
    const move = (today?: string) =>
      send(
        "POST",
        `${base}/accounts/${checking.id}/move${today ? `?today=${today}` : ""}`,
        cookie,
        {
          beforeAccountId: savings.id,
        },
      );
    expect(await working(await move(), checking.id)).toBe("100000");
    expect(await working(await move(BEFORE), checking.id)).toBe("100000");
    expect(await working(await move(AHEAD), checking.id)).toBe("75000");
  });

  it("update without a date", async () => {
    const { cookie, base, checking } = await setup();
    const rename = (today?: string) =>
      send("PATCH", `${base}/accounts/${checking.id}${today ? `?today=${today}` : ""}`, cookie, {
        name: "Main",
      });
    expect(await working(await rename())).toBe("100000");
    expect(await working(await rename(BEFORE))).toBe("100000");
    expect(await working(await rename(AHEAD))).toBe("75000");
  });

  it("update's working balance is read at today when no date is given", async () => {
    const { cookie, base, checking } = await setup();
    // On the user's today the account holds 750.00, so 800.00 adds 50.00, dated that day.
    const res = await send("PATCH", `${base}/accounts/${checking.id}?today=${AHEAD}`, cookie, {
      workingBalance: "80000",
    });
    expect(await working(res)).toBe("80000");
    const list = await send("GET", `${base}/transactions?accountId=${checking.id}`, cookie);
    const rows = ((await list.json()) as { transactions: { date: string; amount: string }[] })
      .transactions;
    expect(rows).toContainEqual(expect.objectContaining({ date: AHEAD, amount: "5000" }));
  });

  it("reopen", async () => {
    const { cookie, base, savings } = await setup();
    const ahead = await send("POST", `${base}/transactions`, cookie, {
      accountId: savings.id,
      date: AHEAD,
      amount: "3000",
      payeeName: "Interest",
      categoryId: null,
    });
    expect(ahead.status).toBe(201);
    const closeIt = () =>
      send("POST", `${base}/accounts/${savings.id}/close`, cookie, { date: "2026-10-15" });
    const reopen = (today?: string) =>
      send(
        "POST",
        `${base}/accounts/${savings.id}/reopen${today ? `?today=${today}` : ""}`,
        cookie,
      );
    expect((await closeIt()).status).toBe(200);
    expect(await working(await reopen())).toBe("0");
    expect((await closeIt()).status).toBe(200);
    expect(await working(await reopen(BEFORE))).toBe("0");
    expect((await closeIt()).status).toBe(200);
    expect(await working(await reopen(AHEAD))).toBe("3000");
  });

  it("record payment: balances at today, not at the payment's date", async () => {
    const { cookie, base, checking, addAccount } = await setup();
    const loan = await addAccount({
      name: "Car",
      type: "auto_loan",
      balance: "-500000",
      interestRate: "0",
      minimumPayment: "10000",
    });
    const pay = (date: string, today?: string) =>
      send(
        "POST",
        `${base}/accounts/${loan.id}/loan/payments${today ? `?today=${today}` : ""}`,
        cookie,
        { fromAccountId: checking.id, amount: "10000", date },
      );
    // A future payment on the loan, then a back-dated one: its response counts the future one
    // only once the user's today reaches it.
    expect((await pay(AHEAD)).status).toBe(201);
    expect(await working(await pay("2026-10-02", BEFORE))).toBe("-490000");
    expect(await working(await pay("2026-10-03", AHEAD))).toBe("-470000");
  });
});
