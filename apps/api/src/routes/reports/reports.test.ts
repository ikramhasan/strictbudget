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
 * budget accounts (which drop out), an uncategorized transfer to a tracking liability (which counts
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
  // A loan tracked off budget: paying it is spending, not saving (that's tracking assets).
  const house = await account("House", "liability");
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
    return json<{ id: string; transferTransactionId: string | null }>(res);
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
    add,
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

describe("spending by flag", () => {
  it("files a flagged split's lines under its flag and their own categories", async () => {
    const t = await setup();
    await t.add({
      date: "2026-10-10",
      amount: "-4000",
      flag: "blue",
      subtransactions: [
        { amount: "-1500", categoryId: t.groceries.id },
        { amount: "-2500", categoryId: t.phone.id },
      ],
    });
    await t.add({ date: "2026-10-11", amount: "-500", categoryId: t.groceries.id, flag: "blue" });
    const { rows } = await t.sums({ from: "2026-10", to: "2026-10", groupBy: "flag,category" });
    const blue = rows.filter((r) => r.flag === "blue");
    // The whole transaction and the split line in Groceries merge into one sum.
    expect(netBy(blue, "categoryId")).toEqual({ [t.groceries.id]: "-2000", [t.phone.id]: "-2500" });
    expect(blue.find((r) => r.categoryId === t.groceries.id)?.count).toBe(2);
    const red = rows.filter((r) => r.flag === "red");
    expect(netBy(red, "categoryId")).toEqual({ [t.groceries.id]: "-5000" });
    // Every line counts once: the flags' sums add up to the month's spending.
    const all = (await t.sums({ from: "2026-10", to: "2026-10" })).rows[0]?.net;
    expect(rows.reduce((sum, r) => sum + BigInt(r.net), 0n).toString()).toBe(all);
  });

  it("gives one flag's spending month by month", async () => {
    const t = await setup();
    await t.add({ date: "2026-09-20", amount: "-700", categoryId: t.rent.id, flag: "red" });
    const { rows } = await t.sums({
      from: "2026-09",
      to: "2026-10",
      groupBy: "month",
      flags: "red",
    });
    expect(netBy(rows, "month")).toEqual({ "2026-09": "-700", "2026-10": "-5000" });
    const byFlagMonth = await t.sums({ from: "2026-09", to: "2026-10", groupBy: "flag,month" });
    expect(
      Object.fromEntries(byFlagMonth.rows.map((r) => [`${r.flag}:${r.month}`, r.net])),
    ).toEqual({
      "red:2026-09": "-700",
      "red:2026-10": "-5000",
      "null:2026-09": "-4000",
      "null:2026-10": "-40500",
    });
  });

  it("counts a transfer to a tracking account under its own side's flag", async () => {
    const t = await setup();
    const out = await t.add({
      date: "2026-10-12",
      amount: "-1200",
      transferAccountId: t.house.id,
      flag: "purple",
    });
    // Flags are kept per side: the tracking account's side gets another one.
    const res = await send(
      "PATCH",
      `${t.base}/transactions/${out.transferTransactionId}?today=${TODAY}`,
      t.cookie,
      { flag: "green" },
    );
    expect(res.status).toBe(200);
    const { rows } = await t.sums({ from: "2026-10", to: "2026-10", groupBy: "flag,category" });
    expect(rows.filter((r) => r.flag === "purple")).toMatchObject([
      { categoryId: t.uncategorized.id, net: "-1200" },
    ]);
    expect(rows.some((r) => r.flag === "green")).toBe(false);
    const { total } = await t.lines({ from: "2026-10", to: "2026-10", flags: "purple" });
    expect(total).toBe("-1200");
  });
});

describe("saving in reports", () => {
  async function saving() {
    const t = await setup();
    const brokerage = await json<{ id: string }>(
      await send("POST", `${t.base}/accounts`, t.cookie, {
        name: "Brokerage",
        type: "asset",
        balance: "0",
        date: "2026-08-20",
      }),
    );
    const { groups } = await json<{
      groups: { name: string; categories: { id: string; name: string }[] }[];
    }>(await send("GET", `${t.base}/categories`, t.cookie));
    const all = groups.flatMap((g) => g.categories);
    const fund = all.find((c) => c.name.includes("Emergency fund"));
    const vacation = all.find((c) => c.name.includes("Vacation"));
    if (!fund || !vacation) throw new Error("starter savings missing");
    const target = (categoryId: string, input: Record<string, unknown>) =>
      send("PUT", `${t.base}/categories/${categoryId}/target`, t.cookie, {
        dueDay: null,
        month: "2026-10",
        today: TODAY,
        ...input,
      });
    // The emergency fund keeps saving into the brokerage; the vacation is saved up and spent.
    expect(
      (
        await target(fund.id, {
          cadence: "monthly",
          behavior: "set_aside",
          goal: "keep_saving",
          amount: "20000",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await target(vacation.id, {
          cadence: "monthly",
          behavior: "set_aside",
          goal: "save_up",
          amount: "10000",
          goalAmount: "50000",
        })
      ).status,
    ).toBe(200);
    // Moved to the brokerage from Groceries' money, and back (both saving, whatever the category).
    await t.add({
      date: "2026-10-10",
      amount: "-7000",
      transferAccountId: brokerage.id,
      categoryId: t.groceries.id,
    });
    await t.add({
      date: "2026-10-11",
      amount: "1000",
      transferAccountId: brokerage.id,
      categoryId: t.groceries.id,
    });
    // A 401(k) contribution recorded as a plain outflow from the keep-saving fund.
    await t.add({ date: "2026-10-12", amount: "-15000", categoryId: fund.id, payeeName: "401k" });
    // The holiday itself, paid from the save-up goal: spending.
    await t.add({ date: "2026-10-13", amount: "-8000", categoryId: vacation.id });
    // A split with a line to the brokerage.
    await t.add({
      date: "2026-10-14",
      amount: "-3000",
      subtransactions: [
        { amount: "-1000", categoryId: t.groceries.id },
        { amount: "-2000", categoryId: t.rent.id, transferAccountId: brokerage.id },
      ],
    });
    return { ...t, fund, vacation };
  }

  it("keeps money that leaves the plan as saving out of spending", async () => {
    const t = await saving();
    const spent = await t.sums({ from: "2026-10", to: "2026-10", groupBy: "category" });
    const saved = await t.sums({
      from: "2026-10",
      to: "2026-10",
      groupBy: "category",
      kind: "saving",
    });
    expect(netBy(saved.rows, "categoryId")).toEqual({
      [t.groceries.id]: "-6000",
      [t.fund.id]: "-15000",
      [t.rent.id]: "-2000",
    });
    // Groceries keeps only its own spending; the vacation stays spending; the tracked loan too.
    expect(netBy(spent.rows, "categoryId")).toEqual({
      [t.groceries.id]: "-7000",
      [t.rent.id]: "-10000",
      [t.phone.id]: "500",
      [t.vacation.id]: "-8000",
      [t.uncategorized.id]: "-30000",
    });
  });

  it("adds up to the plan's Activity with spending", async () => {
    const t = await saving();
    const query = { from: "2026-10", to: "2026-10", groupBy: "category" };
    const spent = netBy((await t.sums(query)).rows, "categoryId");
    const saved = netBy((await t.sums({ ...query, kind: "saving" })).rows, "categoryId");
    const month = await json<{ categories: { categoryId: string; activity: string }[] }>(
      await send("GET", `${t.base}/months/2026-10?today=${TODAY}`, t.cookie),
    );
    for (const id of [t.groceries.id, t.rent.id, t.fund.id, t.vacation.id]) {
      const activity = month.categories.find((c) => c.categoryId === id)?.activity;
      expect(BigInt(spent[id] ?? "0") + BigInt(saved[id] ?? "0"), id).toBe(BigInt(activity ?? ""));
    }
  });

  it("lists saving lines in the drill-down and only there", async () => {
    const t = await saving();
    const saved = await t.lines({ from: "2026-10", to: "2026-10", kind: "saving" });
    expect(saved.total).toBe("-23000");
    expect(saved.count).toBe(4);
    const groceries = await t.lines({
      from: "2026-10",
      to: "2026-10",
      categoryIds: t.groceries.id,
    });
    expect(groceries.total).toBe("-7000");
  });

  it("counts a keep-saving fund's outflows as spending again once it's a spending category", async () => {
    const t = await saving();
    await send("PATCH", `${t.base}/categories/${t.fund.id}`, t.cookie, { savings: false });
    const spent = await t.sums({ from: "2026-10", to: "2026-10", groupBy: "category" });
    expect(netBy(spent.rows, "categoryId")[t.fund.id]).toBe("-15000");
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
