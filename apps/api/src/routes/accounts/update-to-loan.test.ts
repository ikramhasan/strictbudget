import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Account = {
  id: string;
  name: string;
  type: string;
  closed: boolean;
  interestRate: string | null;
  minimumPayment: string | null;
  escrowAmount: string | null;
  balances: { cleared: string; uncleared: string; working: string };
  pairedCategoryId: string | null;
  migratedToAccountId: string | null;
  migratedFromAccountId: string | null;
};
type Txn = {
  date: string;
  amount: string;
  payeeName: string | null;
  cleared: string;
  memo: string;
};
type Group = { kind: string | null; categories: Array<{ id: string; name: string }> };

const TODAY = "2026-10-14";

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

/**
 * A tracking liability owing $5,000 from Aug 1, a $200 payment from checking on Sep 15, a $30
 * uncleared charge on Oct 2 and a monthly $200 transfer scheduled from checking for Nov 15.
 */
async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/accounts`, cookie, { date: "2026-08-01", ...input });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<Account>(res);
  };
  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await send("POST", `${base}${path}`, cookie, body);
    expect(res.status, await res.clone().text()).toBe(201);
  };
  const checking = await addAccount({ name: "Brac", type: "checking", balance: "1000000" });
  const heloc = await addAccount({ name: "x-145 HELOC", type: "liability", balance: "-500000" });
  await post("/transactions", {
    accountId: checking.id,
    date: "2026-09-15",
    amount: "-20000",
    payeeName: null,
    transferAccountId: heloc.id,
    categoryId: null,
    memo: "x-145-pay",
  });
  await post("/transactions", {
    accountId: heloc.id,
    date: "2026-10-02",
    amount: "-3000",
    payeeName: "x-145 Bank",
    categoryId: null,
    memo: "x-145-fee",
  });
  const schedule = (input: Record<string, unknown>) =>
    post("/scheduled-transactions", { today: TODAY, frequency: "monthly", ...input });
  await schedule({
    accountId: checking.id,
    date: "2026-11-15",
    amount: "-20000",
    transferAccountId: heloc.id,
    memo: "x-145-sched",
  });
  await schedule({
    accountId: heloc.id,
    date: "2026-11-02",
    amount: "-3000",
    payeeName: "x-145 Bank",
    memo: "x-145-own",
  });
  await schedule({
    accountId: checking.id,
    date: "2026-11-20",
    amount: "-1000",
    payeeName: "Landlord",
    memo: "x-145-other",
  });
  const groups = (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie)))
    .groups;
  const category = groups.find((g) => g.kind === null && g.categories.length > 0)?.categories[0];
  if (!category) throw new Error("No category to pair");
  const accounts = async () =>
    (
      await json<{ accounts: Account[] }>(
        await send("GET", `${base}/accounts?today=${TODAY}`, cookie),
      )
    ).accounts;
  const register = async (accountId: string) =>
    (
      await json<{ transactions: Txn[] }>(
        await send("GET", `${base}/transactions?accountId=${accountId}&today=${TODAY}`, cookie),
      )
    ).transactions;
  const scheduled = async () =>
    (
      await json<{ scheduledTransactions: Array<{ memo: string }> }>(
        await send("GET", `${base}/scheduled-transactions?today=${TODAY}`, cookie),
      )
    ).scheduledTransactions.map((s) => s.memo);
  const readyToAssign = async () =>
    (await json<{ readyToAssign: string }>(await send("GET", `${base}/months/2026-10`, cookie)))
      .readyToAssign;
  const update = (accountId: string, body: Record<string, unknown>) =>
    send("POST", `${base}/accounts/${accountId}/update-to-loan`, cookie, {
      name: "x-145 HELOC",
      type: "mortgage",
      balance: "-483000",
      date: TODAY,
      interestRate: "6",
      minimumPayment: "30000",
      escrowAmount: "5000",
      pairedCategoryId: category.id,
      ...body,
    });
  return {
    cookie,
    base,
    checking,
    heloc,
    category,
    addAccount,
    accounts,
    register,
    scheduled,
    readyToAssign,
    update,
  };
}

describe("update to a loan account", () => {
  it("adds the loan and closes the tracking account", async () => {
    const s = await setup();
    const before = await s.readyToAssign();
    const res = await s.update(s.heloc.id, {});
    expect(res.status, await res.clone().text()).toBe(201);
    const { loan, original } = await json<{ loan: Account; original: Account }>(res);

    expect(loan).toMatchObject({
      name: "x-145 HELOC",
      type: "mortgage",
      closed: false,
      interestRate: "6.000",
      minimumPayment: "30000",
      escrowAmount: "5000",
      pairedCategoryId: s.category.id,
      migratedFromAccountId: s.heloc.id,
      migratedToAccountId: null,
      balances: { cleared: "-483000", uncleared: "0", working: "-483000" },
    });
    // The loan starts from today's balance; the history stays with the original.
    expect(await s.register(loan.id)).toMatchObject([
      { date: TODAY, amount: "-483000", payeeName: "Starting Balance", cleared: "cleared" },
    ]);

    expect(original).toMatchObject({
      name: "x-145 HELOC (Original)",
      type: "liability",
      closed: true,
      migratedToAccountId: loan.id,
      // Zeroed by working balance: the uncleared items stay uncleared (−$170 + $170).
      balances: { cleared: "-17000", uncleared: "17000", working: "0" },
    });
    const history = await s.register(s.heloc.id);
    expect(history).toHaveLength(4);
    expect(history.find((t) => t.memo === "Closed Account")).toMatchObject({
      date: TODAY,
      amount: "483000",
      payeeName: "Manual Balance Adjustment",
      cleared: "cleared",
    });
    // The checking side of the old payment now names the renamed account.
    expect((await s.register(s.checking.id)).find((t) => t.memo === "x-145-pay")?.payeeName).toBe(
      "Transfer : x-145 HELOC (Original)",
    );

    // Its own schedule and the one transferring into it are gone; others stay.
    expect(await s.scheduled()).toEqual(["x-145-other"]);
    // Both accounts are off budget.
    expect(await s.readyToAssign()).toBe(before);
  });

  it("shows the original's month-end balances on the loan, newest first", async () => {
    const s = await setup();
    const { loan } = await json<{ loan: Account }>(await s.update(s.heloc.id, {}));
    const activity = await json<{
      originalHistory: { accountId: string; months: Array<{ month: string; endBalance: string }> };
    }>(await send("GET", `${s.base}/accounts/${loan.id}/loan?today=${TODAY}`, s.cookie));
    // October $0.00, September −$4,800.00, August −$5,000.00.
    expect(activity.originalHistory).toEqual({
      accountId: s.heloc.id,
      months: [
        { month: "2026-10", endBalance: "0" },
        { month: "2026-09", endBalance: "-480000" },
        { month: "2026-08", endBalance: "-500000" },
      ],
    });
    const other = await s.addAccount({ name: "Car", type: "auto_loan", balance: "-1000" });
    const plain = await json<{ originalHistory: unknown }>(
      await send("GET", `${s.base}/accounts/${other.id}/loan?today=${TODAY}`, s.cookie),
    );
    expect(plain.originalHistory).toBeNull();
  });

  // Afterwards it can be updated again.
  it("erases the link when the original is reopened", async () => {
    const s = await setup();
    const { loan } = await json<{ loan: Account }>(await s.update(s.heloc.id, {}));
    const reopened = await json<Account>(
      await send("POST", `${s.base}/accounts/${s.heloc.id}/reopen`, s.cookie),
    );
    expect(reopened).toMatchObject({ closed: false, migratedToAccountId: null });
    const activity = await json<{ originalHistory: unknown }>(
      await send("GET", `${s.base}/accounts/${loan.id}/loan?today=${TODAY}`, s.cookie),
    );
    expect(activity.originalHistory).toBeNull();
    expect((await s.accounts()).find((a) => a.id === loan.id)?.migratedFromAccountId).toBeNull();
    expect((await s.update(s.heloc.id, { name: "HELOC again" })).status).toBe(201);
  });

  it("drops escrow from a loan that isn't a mortgage", async () => {
    const s = await setup();
    const { loan } = await json<{ loan: Account }>(
      await s.update(s.heloc.id, { type: "personal_loan", name: "HELOC loan" }),
    );
    expect(loan).toMatchObject({ type: "personal_loan", name: "HELOC loan", escrowAmount: null });
  });

  it("only updates open tracking liabilities, once, to a loan type", async () => {
    const s = await setup();
    const asset = await s.addAccount({ name: "House", type: "asset", balance: "100" });
    const card = await s.addAccount({ name: "Visa", type: "credit_card", balance: "0" });
    for (const id of [asset.id, card.id, s.checking.id]) {
      expect((await s.update(id, {})).status).toBe(400);
    }
    expect((await s.update(s.heloc.id, { type: "liability" })).status).toBe(400);
    expect((await s.update(s.heloc.id, { type: "checking" })).status).toBe(400);
    // Pairing is required.
    expect((await s.update(s.heloc.id, { pairedCategoryId: undefined })).status).toBe(400);
    expect((await s.update(s.heloc.id, {})).status).toBe(201);
    const again = await s.update(s.heloc.id, {});
    expect(again.status).toBe(400);
    expect((await again.json()) as unknown).toMatchObject({
      error: { message: "This account was already updated to a loan account" },
    });

    const closed = await s.addAccount({ name: "Old debt", type: "liability", balance: "0" });
    await send("POST", `${s.base}/accounts/${closed.id}/close`, s.cookie, { date: TODAY });
    const refused = await s.update(closed.id, { name: "Old debt loan" });
    expect(refused.status).toBe(400);
    expect((await refused.json()) as unknown).toMatchObject({ error: { code: "ACCOUNT_CLOSED" } });
    // Nothing was added by the refusals.
    expect((await s.accounts()).filter((a) => a.type === "mortgage")).toHaveLength(1);
  });

  it("is budget-scoped", async () => {
    const s = await setup();
    const { cookie } = await signUp(app, { email: "stranger@example.com" });
    const res = await send("POST", `${s.base}/accounts/${s.heloc.id}/update-to-loan`, cookie, {
      name: "x",
      type: "mortgage",
      balance: "0",
      date: TODAY,
      pairedCategoryId: s.category.id,
    });
    expect(res.status).toBe(404);
  });
});
