import { category } from "@strictbudget/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Sum = {
  month?: string | null;
  groupId?: string | null;
  categoryId?: string | null;
  payeeId?: string | null;
  accountId?: string | null;
  flag?: string | null;
  outflow: string;
  inflow: string;
  net: string;
  count: number;
};
type Line = {
  id: string;
  transactionId: string;
  accountName: string;
  payeeName: string | null;
  groupName: string | null;
  categoryName: string | null;
  flag: string | null;
  cleared: string;
  amount: string;
};
type Group = { id: string; kind: string | null; categories: { id: string; name: string }[] };

const TODAY = "2026-10-20";

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

/**
 * Card and cash spending, a split, a refund that leaves a category positive, transfers between
 * budget accounts (which drop out), an uncategorized transfer to a tracking account (which counts
 * as Uncategorized), income and starting balances (which aren't income).
 */
async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const account = async (name: string, type: string, balance = "0") =>
    json<{ id: string }>(
      await send("POST", `${base}/accounts`, cookie, { name, type, balance, date: "2026-08-20" }),
    );
  const checking = await account("Checking", "checking", "100000");
  const savings = await account("Savings", "savings");
  const visa = await account("Visa", "credit_card");
  const house = await account("House", "asset");
  const { groups, readyToAssignCategoryId } = await json<{
    groups: Group[];
    readyToAssignCategoryId: string;
  }>(await send("GET", `${base}/categories`, cookie));
  const [bills, needs] = groups.filter((g) => !g.kind);
  const [rent, phone] = bills?.categories ?? [];
  const [groceries] = needs?.categories ?? [];
  if (!bills || !needs || !rent || !phone || !groceries) throw new Error("starter data missing");
  const [uncategorized] = await db
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.budgetId, budget.id), eq(category.internalKind, "uncategorized")));
  if (!uncategorized) throw new Error("no Uncategorized");

  const add = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
      accountId: checking.id,
      categoryId: null,
      ...input,
    });
    expect(res.status).toBe(201);
  };
  await add({ date: "2026-09-15", amount: "-4000", categoryId: groceries.id });
  await add({ date: "2026-10-02", amount: "-5000", categoryId: groceries.id, flag: "red" });
  await add({ date: "2026-10-03", amount: "-10000", categoryId: rent.id, accountId: visa.id });
  await add({
    date: "2026-10-04",
    amount: "-3000",
    payeeName: "Market",
    subtransactions: [
      { amount: "-1000", categoryId: groceries.id },
      { amount: "-2000", categoryId: phone.id, payeeName: "Telco" },
    ],
  });
  await add({ date: "2026-10-05", amount: "2500", categoryId: phone.id, payeeName: "Telco" });
  await add({ date: "2026-10-06", amount: "-20000", transferAccountId: savings.id });
  await add({ date: "2026-10-07", amount: "-10000", transferAccountId: visa.id });
  await add({ date: "2026-10-08", amount: "-30000", transferAccountId: house.id });
  await add({
    date: "2026-10-09",
    amount: "50000",
    categoryId: readyToAssignCategoryId,
    payeeName: "Employer",
  });

  const get = async <T>(path: string, query: Record<string, string>) => {
    const res = await send(
      "GET",
      `${base}/reports/${path}?${new URLSearchParams({ today: TODAY, ...query })}`,
      cookie,
    );
    expect(res.status).toBe(200);
    return json<T>(res);
  };
  const sums = (query: Record<string, string>) =>
    get<{
      currency: string;
      firstMonth: string | null;
      rows: Sum[];
      payees: { id: string; name: string }[];
    }>("activity", query);
  const lines = (query: Record<string, string>) =>
    get<{ total: string; count: number; transactions: Line[] }>("transactions", query);
  return {
    cookie,
    base,
    sums,
    lines,
    checking,
    visa,
    house,
    bills,
    groceries,
    rent,
    phone,
    uncategorized,
  };
}

const netBy = (rows: Sum[], key: keyof Sum) =>
  Object.fromEntries(rows.map((r) => [String(r[key]), r.net]));

describe("report activity", () => {
  it("sums spending per category", async () => {
    const t = await setup();
    const { rows, currency, firstMonth } = await t.sums({
      from: "2026-10",
      to: "2026-10",
      groupBy: "category",
    });
    expect(currency).toBe("USD");
    expect(firstMonth).toBe("2026-08");
    // Transfers between budget accounts and card payments drop out; the transfer to the House
    // tracking account counts as Uncategorized; the split's lines count one by one; Telco's
    // refund leaves Phone positive (a Positive Inflow Category).
    expect(netBy(rows, "categoryId")).toEqual({
      [t.groceries.id]: "-6000",
      [t.rent.id]: "-10000",
      [t.phone.id]: "500",
      [t.uncategorized.id]: "-30000",
    });
    const phone = rows.find((r) => r.categoryId === t.phone.id);
    expect(phone).toMatchObject({ outflow: "-2000", inflow: "2500", count: 2 });
  });

  it("equals the plan's Activity for the month and category", async () => {
    const t = await setup();
    const { rows } = await t.sums({ from: "2026-10", to: "2026-10", groupBy: "category" });
    const res = await send("GET", `${t.base}/months/2026-10?today=${TODAY}`, t.cookie);
    const month = await json<{
      categories: { categoryId: string; activity: string }[];
      uncategorized: { activity: string } | null;
    }>(res);
    for (const id of [t.groceries.id, t.rent.id, t.phone.id]) {
      const activity = month.categories.find((c) => c.categoryId === id)?.activity;
      expect(rows.find((r) => r.categoryId === id)?.net).toBe(activity);
    }
    expect(rows.find((r) => r.categoryId === t.uncategorized.id)?.net).toBe(
      month.uncategorized?.activity,
    );
  });

  it("groups by month, category group, account, payee and flag", async () => {
    const t = await setup();
    const byMonth = await t.sums({ from: "2026-09", to: "2026-10", groupBy: "month" });
    expect(netBy(byMonth.rows, "month")).toEqual({ "2026-09": "-4000", "2026-10": "-45500" });

    const byGroup = await t.sums({ from: "2026-10", to: "2026-10", groupBy: "group" });
    expect(netBy(byGroup.rows, "groupId")[t.bills.id]).toBe("-9500");

    const byAccount = await t.sums({ from: "2026-10", to: "2026-10", groupBy: "account" });
    expect(netBy(byAccount.rows, "accountId")).toEqual({
      [t.checking.id]: "-35500",
      [t.visa.id]: "-10000",
    });

    const byFlag = await t.sums({ from: "2026-10", to: "2026-10", groupBy: "flag" });
    expect(netBy(byFlag.rows, "flag")).toEqual({ red: "-5000", null: "-40500" });

    // A split line without its own payee takes the split's.
    const byPayee = await t.sums({
      from: "2026-10",
      to: "2026-10",
      groupBy: "payee,category",
      categoryIds: `${t.groceries.id},${t.phone.id}`,
    });
    const market = byPayee.rows.filter((r) => r.categoryId === t.groceries.id && r.payeeId);
    expect(market).toHaveLength(1);
    expect(market[0]?.net).toBe("-1000");
    expect(byPayee.payees.find((p) => p.id === market[0]?.payeeId)?.name).toBe("Market");
  });

  it("counts nothing after the user's today", async () => {
    const t = await setup();
    const { rows } = await t.sums({ from: "2026-10", to: "2026-10", today: "2026-10-03" });
    expect(rows[0]?.net).toBe("-15000");
  });

  it("filters by account, category, payee and flag", async () => {
    const t = await setup();
    const total = async (query: Record<string, string>) =>
      (await t.sums({ from: "2026-10", to: "2026-10", ...query })).rows[0]?.net;
    expect(await total({ accountIds: t.visa.id })).toBe("-10000");
    expect(await total({ categoryIds: t.groceries.id })).toBe("-6000");
    expect(await total({ groupIds: t.bills.id })).toBe("-9500");
    expect(await total({ flags: "red" })).toBe("-5000");
    expect(await total({ flags: "none" })).toBe("-40500");
    expect(await total({ payeeIds: "none", categoryIds: t.groceries.id })).toBe("-5000");
  });

  it("sums income without starting balances", async () => {
    const t = await setup();
    const { rows } = await t.sums({
      from: "2026-08",
      to: "2026-10",
      kind: "income",
      groupBy: "payee",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ net: "50000", count: 1 });
    expect(rows[0]?.payeeId).not.toBeNull();
  });

  it("refuses a range that ends before it starts and hides other budgets", async () => {
    const t = await setup();
    const res = await send("GET", `${t.base}/reports/activity?from=2026-10&to=2026-09`, t.cookie);
    expect(res.status).toBe(400);
    const other = await signUp(app, { email: "other@example.com" });
    const hidden = await send(
      "GET",
      `${t.base}/reports/activity?from=2026-10&to=2026-10`,
      other.cookie,
    );
    expect(hidden.status).toBe(404);
  });
});

describe("report transactions", () => {
  it("lists a category's lines with their total, splits line by line", async () => {
    const t = await setup();
    const { total, count, transactions } = await t.lines({
      from: "2026-10",
      to: "2026-10",
      categoryIds: t.groceries.id,
    });
    expect(total).toBe("-6000");
    expect(count).toBe(2);
    expect(transactions.map((l) => [l.payeeName, l.amount])).toEqual([
      ["Market", "-1000"],
      [null, "-5000"],
    ]);
    expect(transactions[1]).toMatchObject({ flag: "red", cleared: "uncleared" });
    expect(transactions[0]?.groupName).toBeTruthy();
  });

  it("puts the largest outflow first and limits the list", async () => {
    const t = await setup();
    const { count, transactions } = await t.lines({
      from: "2026-10",
      to: "2026-10",
      order: "largest_outflow",
      limit: "1",
    });
    expect(count).toBe(6);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ payeeName: "Transfer : House", amount: "-30000" });
  });
});
