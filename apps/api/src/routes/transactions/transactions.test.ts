import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Account = { id: string; balances: { cleared: string; uncleared: string; working: string } };
type Txn = {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  amount: string;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  memo: string;
  cleared: string;
  runningBalance: string;
};
type Category = { id: string; name: string };
type Group = { name: string; kind: string | null; categories: Category[] };
type Payee = { id: string; name: string; prefillCategoryId: string | null };
type ErrorBody = { error: { code: string } };

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
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (name: string, type: string, balance: string) =>
    json<Account>(
      await send("POST", `${base}/accounts`, cookie, { name, type, balance, date: TODAY }),
    );
  const groups = (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie)))
    .groups;
  const categories = groups.filter((g) => !g.kind).flatMap((g) => g.categories);
  const [groceries, rent] = categories;
  if (!groceries || !rent) throw new Error("starter categories missing");
  const add = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions`, cookie, {
      date: TODAY,
      payeeName: null,
      categoryId: null,
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<Txn>(res);
  };
  const register = async (accountId?: string) =>
    (
      await json<{ transactions: Txn[] }>(
        await send(
          "GET",
          `${base}/transactions${accountId ? `?accountId=${accountId}` : ""}`,
          cookie,
        ),
      )
    ).transactions;
  const balances = async (accountId: string, today = TODAY) => {
    const { accounts } = await json<{ accounts: Account[] }>(
      await send("GET", `${base}/accounts?today=${today}`, cookie),
    );
    return accounts.find((a) => a.id === accountId)?.balances;
  };
  return { cookie, base, addAccount, add, register, balances, groceries, rent };
}

describe("transactions", () => {
  it("adds a transaction, creating its payee, and keeps a running balance", async () => {
    const { addAccount, add, register, balances, groceries } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const txn = await add({
      accountId: checking.id,
      amount: "-2550",
      payeeName: "Corner Shop",
      categoryId: groceries.id,
      memo: "milk",
    });
    expect(txn).toMatchObject({
      accountId: checking.id,
      accountName: "Checking",
      amount: "-2550",
      payeeName: "Corner Shop",
      categoryId: groceries.id,
      categoryName: groceries.name,
      memo: "milk",
      cleared: "uncleared",
      runningBalance: "97450",
    });

    await add({ accountId: checking.id, amount: "-450", payeeName: "corner shop" });
    const rows = await register(checking.id);
    // The same day: the largest outflow on top, and the balance runs from the bottom. The
    // second one reused the payee despite the different case.
    expect(rows.map((r) => [r.amount, r.payeeName, r.runningBalance])).toEqual([
      ["-2550", "Corner Shop", "97000"],
      ["-450", "Corner Shop", "99550"],
      ["100000", "Starting Balance", "100000"],
    ]);
    expect(await balances(checking.id)).toEqual({
      cleared: "100000",
      uncleared: "-3000",
      working: "97000",
    });
  });

  it("orders the running balance by date, not by entry", async () => {
    const { addAccount, add, register } = await setup();
    const checking = await addAccount("Checking", "checking", "10000");
    await add({ accountId: checking.id, amount: "-100", date: "2026-10-05" });
    await add({ accountId: checking.id, amount: "-200", date: "2026-10-03" });
    const rows = await register(checking.id);
    expect(rows.map((r) => [r.date, r.runningBalance])).toEqual([
      ["2026-10-05", "9700"],
      ["2026-10-03", "9800"],
      [TODAY, "10000"],
    ]);
  });

  it("leaves future-dated transactions out of balances until their date", async () => {
    const { addAccount, add, balances } = await setup();
    const checking = await addAccount("Checking", "checking", "10000");
    await add({ accountId: checking.id, amount: "-2500", date: "2026-10-15" });
    expect((await balances(checking.id, TODAY))?.working).toBe("10000");
    expect((await balances(checking.id, "2026-10-15"))?.working).toBe("7500");
  });

  it("files an uncategorized budget transaction under Uncategorized", async () => {
    const { addAccount, add } = await setup();
    const checking = await addAccount("Checking", "checking", "0");
    const txn = await add({ accountId: checking.id, amount: "-100" });
    expect(txn.categoryName).toBe("Uncategorized");
  });

  it("keeps categories off tracking accounts and payment categories off transactions", async () => {
    const { base, cookie, addAccount, add, groceries } = await setup();
    const brokerage = await addAccount("Brokerage", "asset", "500000");
    const visa = (await json<Account & { paymentCategoryId: string }>(
      await send("POST", `${base}/accounts`, cookie, {
        name: "Visa",
        type: "credit_card",
        balance: "0",
        date: TODAY,
      }),
    )) as Account & { paymentCategoryId: string };

    const tracked = await add({ accountId: brokerage.id, amount: "1200" });
    expect(tracked.categoryId).toBeNull();

    const withCategory = await send("POST", `${base}/transactions`, cookie, {
      accountId: brokerage.id,
      date: TODAY,
      amount: "1200",
      payeeName: null,
      categoryId: groceries.id,
    });
    expect(withCategory.status).toBe(400);
    expect((await json<ErrorBody>(withCategory)).error.code).toBe("CATEGORY_NOT_ALLOWED");

    const toPayment = await send("POST", `${base}/transactions`, cookie, {
      accountId: visa.id,
      date: TODAY,
      amount: "-500",
      payeeName: null,
      categoryId: visa.paymentCategoryId,
    });
    expect(toPayment.status).toBe(400);
    expect((await json<ErrorBody>(toPayment)).error.code).toBe("CATEGORY_NOT_ALLOWED");
  });

  it("edits, toggles cleared, moves between accounts and deletes", async () => {
    const { base, cookie, addAccount, add, register, balances, groceries, rent } = await setup();
    const checking = await addAccount("Checking", "checking", "10000");
    const savings = await addAccount("Savings", "savings", "0");
    const brokerage = await addAccount("Brokerage", "asset", "0");
    const txn = await add({ accountId: checking.id, amount: "-1000", categoryId: groceries.id });
    const path = `${base}/transactions/${txn.id}`;

    const edited = await json<Txn>(
      await send("PATCH", path, cookie, {
        amount: "-1500",
        payeeName: "Landlord",
        categoryId: rent.id,
        cleared: "cleared",
      }),
    );
    expect(edited).toMatchObject({
      amount: "-1500",
      payeeName: "Landlord",
      categoryId: rent.id,
      cleared: "cleared",
    });
    expect((await balances(checking.id))?.cleared).toBe("8500");

    const noPayee = await json<Txn>(await send("PATCH", path, cookie, { payeeName: null }));
    expect(noPayee).toMatchObject({ payeeName: null, categoryId: rent.id });

    const moved = await json<Txn>(await send("PATCH", path, cookie, { accountId: savings.id }));
    expect(moved).toMatchObject({ accountId: savings.id, categoryId: rent.id });
    const tracked = await json<Txn>(await send("PATCH", path, cookie, { accountId: brokerage.id }));
    expect(tracked).toMatchObject({ accountId: brokerage.id, categoryId: null });
    const back = await json<Txn>(await send("PATCH", path, cookie, { accountId: checking.id }));
    expect(back.categoryName).toBe("Uncategorized");

    expect((await send("DELETE", path, cookie)).status).toBe(204);
    expect((await register(checking.id)).map((r) => r.id)).not.toContain(txn.id);
    expect((await send("DELETE", path, cookie)).status).toBe(404);
  });

  it("lists every account's transactions when no account is given", async () => {
    const { addAccount, register } = await setup();
    await addAccount("Checking", "checking", "100");
    await addAccount("Savings", "savings", "200");
    const rows = await register();
    expect(rows.map((r) => r.accountName).sort()).toEqual(["Checking", "Savings"]);
  });

  it("won't add transactions to a closed account", async () => {
    const { base, cookie, addAccount } = await setup();
    const checking = await addAccount("Checking", "checking", "0");
    await send("POST", `${base}/accounts/${checking.id}/close`, cookie, { date: TODAY });
    const res = await send("POST", `${base}/transactions`, cookie, {
      accountId: checking.id,
      date: TODAY,
      amount: "-100",
      payeeName: null,
      categoryId: null,
    });
    expect(res.status).toBe(400);
    expect((await json<ErrorBody>(res)).error.code).toBe("ACCOUNT_CLOSED");
  });

  it("prefills each payee's category by two of its last three", async () => {
    const { base, cookie, addAccount, add, groceries, rent } = await setup();
    const checking = await addAccount("Checking", "checking", "0");
    const market = (categoryId: string | null = null) =>
      add({ accountId: checking.id, amount: "-1", payeeName: "Market", categoryId });
    await market(rent.id);
    await market(groceries.id);
    // Uncategorized doesn't count.
    await market();
    await add({ accountId: checking.id, amount: "-1", payeeName: "Bakery" });
    const prefills = async () =>
      (await json<{ payees: Payee[] }>(await send("GET", `${base}/payees`, cookie))).payees.map(
        (p) => [p.name, p.prefillCategoryId],
      );
    // Rent, Groceries: no two agree, so the first stays.
    expect(await prefills()).toEqual([
      ["Bakery", null],
      ["Market", rent.id],
    ]);
    await market(groceries.id);
    expect(await prefills()).toEqual([
      ["Bakery", null],
      ["Market", groceries.id],
    ]);
  });

  it("hides another budget's transactions from non-members", async () => {
    const { base, addAccount, add } = await setup();
    const checking = await addAccount("Checking", "checking", "0");
    const txn = await add({ accountId: checking.id, amount: "-1" });
    const stranger = await signUp(app);
    expect((await send("GET", `${base}/transactions`, stranger.cookie)).status).toBe(404);
    const res = await send("PATCH", `${base}/transactions/${txn.id}`, stranger.cookie, {
      memo: "mine now",
    });
    expect(res.status).toBe(404);
  });
});
