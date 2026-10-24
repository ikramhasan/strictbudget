import { transaction } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Txn = {
  accountId: string;
  id: string;
  date: string;
  amount: string;
  payeeName: string | null;
  memo: string;
  runningBalance: string;
  subtransactions: { id: string }[];
  matchingLineIds: string[] | null;
};
type Page = { transactions: Txn[]; nextCursor: string | null; someHidden: boolean | null };
type Category = { id: string; name: string };

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
  const account = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, cookie, {
      name: "Checking",
      type: "checking",
      balance: "100000",
      date: "2026-01-01",
    }),
  );
  const { groups, readyToAssignCategoryId } = await json<{
    groups: { kind: string | null; categories: Category[] }[];
    readyToAssignCategoryId: string;
  }>(await send("GET", `${base}/categories`, cookie));
  const [groceries, household] = groups.filter((g) => !g.kind).flatMap((g) => g.categories);
  if (!groceries || !household) throw new Error("starter categories missing");
  const add = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions`, cookie, {
      accountId: account.id,
      categoryId: null,
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<Txn>(res);
  };
  const list = async (query: Record<string, string> = {}) => {
    const params = new URLSearchParams({ accountId: account.id, ...query });
    const res = await send("GET", `${base}/transactions?${params}`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return json<Page>(res);
  };
  return { base, cookie, account, add, list, groceries, household, readyToAssignCategoryId };
}

describe("register search, filters, sort and paging", () => {
  it("pages through the whole register without gaps or repeats", async () => {
    const { add, list } = await setup();
    // Same-day transactions too, so ties break by creation and id.
    for (let i = 1; i <= 7; i++) {
      await add({ date: `2026-02-0${Math.ceil(i / 2)}`, amount: `-${i}00`, payeeName: `P${i}` });
    }
    const all = await list({ limit: "100" });
    expect(all.nextCursor).toBeNull();
    const seen: Txn[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await list({ limit: "3", ...(cursor ? { cursor } : {}) });
      expect(page.transactions.length).toBeLessThanOrEqual(3);
      seen.push(...page.transactions);
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.map((t) => t.id)).toEqual(all.transactions.map((t) => t.id));
    expect(seen).toHaveLength(8); // and the starting balance
  });

  it("keeps the account's real running balance on filtered rows", async () => {
    const { add, list } = await setup();
    await add({ date: "2026-02-01", amount: "-1000", payeeName: "Costco" });
    await add({ date: "2026-02-02", amount: "-2000", payeeName: "Bakery" });
    await add({ date: "2026-02-03", amount: "-3000", payeeName: "Costco" });
    const { transactions } = await list({ q: "costco" });
    expect(transactions.map((t) => [t.date, t.runningBalance])).toEqual([
      ["2026-02-03", "94000"],
      ["2026-02-01", "99000"],
    ]);
  });

  it("gives every row the same running balance on any page, sort or filter", async () => {
    const { base, cookie, add, list } = await setup();
    // Days with several rows (inflows, outflows, equal amounts) and a gap, so the balance window
    // has ties to order and pages that start mid-day.
    const amounts = ["-500", "-500", "2500", "-1200", "-300", "700", "-500", "-9900", "40"];
    for (const [i, amount] of amounts.entries()) {
      await add({
        date: `2026-03-0${1 + Math.floor(i / 3) * 3}`,
        amount,
        payeeName: i % 2 ? "Odd" : "Even",
      });
    }
    const all = await list({ limit: "100" });
    const reference = new Map(all.transactions.map((t) => [t.id, t.runningBalance]));
    const total = all.transactions.reduce((sum, t) => sum + BigInt(t.amount), 0n);
    expect(all.transactions[0]?.runningBalance).toBe(total.toString());

    const pages = async (query: Record<string, string>) => {
      const seen: Txn[] = [];
      let cursor: string | null | undefined;
      do {
        const page = await list({ limit: "2", ...query, ...(cursor ? { cursor } : {}) });
        seen.push(...page.transactions);
        cursor = page.nextCursor;
      } while (cursor);
      return seen;
    };
    const queries: Record<string, string>[] = [
      {},
      { sort: "payee:asc" },
      { sort: "outflow:desc" },
      { q: "odd" },
    ];
    for (const query of queries) {
      const rows = await pages(query);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows)
        expect([query, row.runningBalance]).toEqual([query, reference.get(row.id)]);
    }
    // The all-accounts register too.
    const everything = await json<Page>(
      await send("GET", `${base}/transactions?limit=100`, cookie),
    );
    for (const row of everything.transactions) {
      expect(row.runningBalance).toBe(reference.get(row.id));
    }
  });

  it("searches payees, memos, split lines and amounts", async () => {
    const { add, list, groceries, household } = await setup();
    await add({ date: "2026-02-01", amount: "-4510", payeeName: "Market", memo: "eggs" });
    await add({ date: "2026-02-02", amount: "-999", payeeName: "100% Juice" });
    await add({
      date: "2026-02-03",
      amount: "-3000",
      payeeName: "Mall",
      subtransactions: [
        { amount: "-1000", categoryId: groceries.id, memo: "snacks" },
        { amount: "-2000", categoryId: household.id },
      ],
    });
    const payees = async (q: string) =>
      (await list({ q })).transactions.map((t) => t.payeeName).sort();
    expect(await payees("45.10")).toEqual(["Market"]);
    expect(await payees("45.1")).toEqual(["Market"]);
    expect(await payees("EGG")).toEqual(["Market"]);
    expect(await payees("snacks")).toEqual(["Mall"]);
    expect(await payees("10.00")).toEqual(["Mall"]);
    expect(await payees(household.name)).toEqual(["Mall"]);
    // `%` is literal, not a wildcard.
    expect(await payees("0%")).toEqual(["100% Juice"]);
  });

  it("filters with search terms, all of which must match", async () => {
    const { base, cookie, add, list, groceries, household } = await setup();
    await send("PUT", `${base}/flags/blue`, cookie, { name: "Reimburse" });
    const a = await add({
      date: "2026-02-01",
      amount: "-100",
      payeeName: "Ann",
      categoryId: groceries.id,
      cleared: "cleared",
      flag: "red",
    });
    const b = await add({ date: "2026-03-01", amount: "-200", payeeName: "Bob", flag: "blue" });
    const split = await add({
      date: "2026-04-01",
      amount: "-300",
      payeeName: "Cid",
      subtransactions: [
        { amount: "-100", categoryId: household.id },
        { amount: "-200", categoryId: groceries.id, payeeName: "Ann" },
      ],
    });
    const income = await add({ date: "2026-04-02", amount: "5000", payeeName: "Work" });
    const ids = async (q: string, query: Record<string, string> = {}) =>
      (await list({ q, ...query })).transactions.map((t) => t.id);
    expect(await ids("", { from: "2026-02-15", to: "2026-03-31" })).toEqual([b.id]);
    expect(await ids("Is: Cleared")).toContain(a.id);
    expect(await ids("Is: Cleared")).not.toContain(b.id);
    expect(await ids("is: unreconciled")).toContain(b.id);
    expect(await ids("Flag: Red")).toEqual([a.id]);
    expect(await ids("Flag: reimburse")).toEqual([b.id]);
    expect(await ids("Flag: None")).not.toContain(a.id);
    expect(await ids(`Category: ${groceries.name}`)).toEqual([split.id, a.id]);
    expect(await ids("Category: Split")).toEqual([split.id]);
    expect(await ids("Payee: ann")).toEqual([split.id, a.id]);
    expect(await ids("Outflow: >=2")).toEqual([split.id, b.id]);
    expect(await ids("Outflow: 3")).toEqual([split.id]);
    expect(await ids("Inflow: <=50")).toEqual([income.id]);
    expect(await ids("Before: 03/01/2026, After: 03/01/2026")).toEqual([b.id]);
    expect(await ids("On: 02/01/2026")).toEqual([a.id]);
    // A partial date is completed from the user's today.
    const today = { today: "2026-10-16" };
    expect(await ids("On: 2", today)).toEqual([a.id]);
    expect(await ids("Before: 3, After: x0301", today)).toEqual([b.id]);
    expect(await ids("On: 2", { today: "2027-01-05" })).toEqual([]);
    // Every term must match the same transaction or the same split line.
    expect(await ids("Payee: Bob, Is: Cleared")).toEqual([]);
    expect(await ids("Payee: Ann, Outflow: 2")).toEqual([split.id]);
  });

  it("finds a month's Ready to Assign money with Income:", async () => {
    const { base, cookie, account, add, groceries, readyToAssignCategoryId } = await setup();
    const rta = readyToAssignCategoryId;
    const newAccount = async (name: string, type: string, balance: string) =>
      json<{ id: string }>(
        await send("POST", `${base}/accounts`, cookie, { name, type, balance, date: "2026-10-03" }),
      );
    // Ready to Assign in and out, budget accounts' Starting Balances (card debt too), an RTA split
    // line; not transfers, other categories, tracking.
    const card = await newAccount("Card", "credit_card", "-50000");
    await newAccount("House", "asset", "900000");
    await add({ date: "2026-10-05", amount: "200000", payeeName: "Job", categoryId: rta });
    const out = await add({
      date: "2026-10-06",
      amount: "-500",
      payeeName: "Shop",
      categoryId: rta,
    });
    await add({ date: "2026-10-07", amount: "300", payeeName: "Refund", categoryId: groceries.id });
    await add({ date: "2026-10-08", amount: "-1000", transferAccountId: card.id, payeeName: null });
    await add({ date: "2026-09-30", amount: "700", payeeName: "Early", categoryId: rta });
    await add({ date: "2026-11-01", amount: "800", payeeName: "Late", categoryId: rta });
    const split = await add({
      date: "2026-10-09",
      amount: "0",
      payeeName: "Mixed",
      subtransactions: [
        { amount: "100", categoryId: rta, memo: "rta line" },
        { amount: "-100", categoryId: groceries.id },
      ],
    });
    const search = async (q: string) => {
      const res = await send("GET", `${base}/transactions?${new URLSearchParams({ q })}`, cookie);
      return (await json<Page>(res)).transactions;
    };
    const names = async (q: string) => (await search(q)).map((t) => t.payeeName).sort();
    expect(await names("Income: October 2026")).toEqual(
      ["Job", "Mixed", "Shop", "Starting Balance"].sort(),
    );
    expect((await search("Income: oct 2026")).map((t) => t.accountId).sort()).toEqual(
      [account.id, account.id, account.id, card.id].sort(),
    );
    expect(await names("Income: September 2026")).toEqual(["Early"]);
    // Only the RTA line of the split shows.
    const row = (await search("Income: October 2026")).find((t) => t.id === split.id);
    expect(row?.matchingLineIds).toEqual([split.subtransactions[0]?.id]);
    // It combines with other terms; a value it can't read is free text.
    expect((await search("Income: October 2026, Outflow: 5")).map((t) => t.id)).toEqual([out.id]);
    expect(await search("Income: 10/2026")).toEqual([]);
  });

  it("reads Income: without a year as this year's month", async () => {
    const { base, cookie, add, readyToAssignCategoryId } = await setup();
    const [year = "", month = ""] = new Date().toISOString().slice(0, 7).split("-");
    const thisYear = await add({
      date: `${year}-${month}-01`,
      amount: "100",
      payeeName: "Now X",
      categoryId: readyToAssignCategoryId,
    });
    await add({
      date: `${Number(year) - 1}-${month}-01`,
      amount: "100",
      payeeName: "Then X",
      categoryId: readyToAssignCategoryId,
    });
    const monthName = new Date(Date.UTC(2000, Number(month) - 1, 1)).toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    const res = await send(
      "GET",
      `${base}/transactions?${new URLSearchParams({ q: `Income: ${monthName}, Payee: x` })}`,
      cookie,
    );
    expect((await json<Page>(res)).transactions.map((t) => t.id)).toEqual([thisYear.id]);
  });

  it("takes Income:'s missing year from the user's today", async () => {
    const { base, cookie, add, readyToAssignCategoryId } = await setup();
    const early = await add({
      date: "2025-01-05",
      amount: "100",
      payeeName: "Old X",
      categoryId: readyToAssignCategoryId,
    });
    await add({
      date: "2026-01-05",
      amount: "100",
      payeeName: "New X",
      categoryId: readyToAssignCategoryId,
    });
    // A user still on 31 December 2025 while the server's year may be later.
    const res = await send(
      "GET",
      `${base}/transactions?${new URLSearchParams({ q: "Income: January, Payee: x", today: "2025-12-31" })}`,
      cookie,
    );
    expect((await json<Page>(res)).transactions.map((t) => t.id)).toEqual([early.id]);
  });

  it("shows only the split lines a search matches", async () => {
    const { add, list, groceries, household } = await setup();
    const split = await add({
      date: "2026-02-01",
      amount: "-300",
      payeeName: "Store",
      memo: "weekly",
      subtransactions: [
        { amount: "-100", categoryId: household.id },
        { amount: "-200", categoryId: groceries.id, payeeName: "Other" },
      ],
    });
    const [householdLine, groceriesLine] = split.subtransactions;
    const row = async (q: string) =>
      (await list({ q })).transactions.find((t) => t.id === split.id);
    // A line without its own payee has the split's.
    expect((await row("Payee: store"))?.matchingLineIds).toEqual([householdLine?.id]);
    expect((await row(`Category: ${groceries.name}`))?.matchingLineIds).toEqual([
      groceriesLine?.id,
    ]);
    // The split itself matches, none of its lines do.
    expect((await row("Outflow: 3"))?.matchingLineIds).toEqual([]);
    expect((await row("weekly"))?.matchingLineIds).toEqual([]);
    expect((await list()).transactions[0]?.matchingLineIds).toBeNull();
  });

  it("hides reconciled transactions and says when anything is hidden", async () => {
    const { add, list } = await setup();
    // The starting balance is cleared; reconcile it straight in the database.
    const { transactions } = await list();
    const start = transactions[0];
    if (!start) throw new Error("no starting balance");
    await db.update(transaction).set({ cleared: "reconciled" }).where(eq(transaction.id, start.id));
    const shop = await add({ date: "2026-02-01", amount: "-100", payeeName: "Shop" });
    expect((await list()).someHidden).toBe(false);
    const hidden = await list({ hideReconciled: "true" });
    expect(hidden.transactions.map((t) => t.id)).toEqual([shop.id]);
    expect(hidden.someHidden).toBe(true);
    expect((await list({ q: "nothing like it" })).someHidden).toBe(true);
    expect((await list({ q: "Shop", from: "2026-01-01" })).someHidden).toBe(true);
    expect((await list({ limit: "1" })).someHidden).toBe(false);
  });

  it("puts a day's largest outflow on top, and runs the balance from the bottom", async () => {
    const { add, list } = await setup();
    await add({ date: "2026-02-01", amount: "-100", payeeName: "Small" });
    await add({ date: "2026-02-01", amount: "500", payeeName: "Refund" });
    await add({ date: "2026-02-01", amount: "-900", payeeName: "Big" });
    const { transactions } = await list();
    expect(transactions.map((t) => [t.payeeName, t.runningBalance])).toEqual([
      ["Big", "99500"],
      ["Small", "100400"],
      ["Refund", "100500"],
      ["Starting Balance", "100000"],
    ]);
  });

  it("sorts by any column, both ways, and pages in that order", async () => {
    const { add, list } = await setup();
    await add({ date: "2026-02-01", amount: "-300", payeeName: "banana" });
    await add({ date: "2026-02-02", amount: "-100", payeeName: "Apple" });
    await add({ date: "2026-02-03", amount: "-200", payeeName: "cherry" });
    const payees = async (query: Record<string, string>) =>
      (await list(query)).transactions.map((t) => t.payeeName);
    // Case-insensitive, as people read names.
    expect(await payees({ sort: "payee:asc" })).toEqual([
      "Apple",
      "banana",
      "cherry",
      "Starting Balance",
    ]);
    expect(await payees({ sort: "outflow:desc" })).toEqual([
      "banana",
      "cherry",
      "Apple",
      "Starting Balance",
    ]);
    const first = await list({ sort: "payee:desc", limit: "2" });
    const rest = await list({ sort: "payee:desc", limit: "10", cursor: first.nextCursor ?? "" });
    expect([...first.transactions, ...rest.transactions].map((t) => t.payeeName)).toEqual([
      "Starting Balance",
      "cherry",
      "banana",
      "Apple",
    ]);
  });

  it("stacks sorts, and pages through each without gaps or repeats", async () => {
    const { add, list } = await setup();
    const rows = [
      ["x29 Bravo", "2026-10-01", "-10000", "red", "cleared"],
      ["x29 Alpha", "2026-10-02", "-30000", "blue", "uncleared"],
      ["x29 Alpha", "2026-10-03", "20000", null, "cleared"],
      ["x29 Charlie", "2026-10-01", "5000", "green", "uncleared"],
      ["x29 Bravo", "2026-10-03", "-30000", null, "uncleared"],
      ["x29 Charlie", "2026-10-02", "-10000", "purple", "cleared"],
      ["x29 Alpha", "2026-10-04", "-5000", "red", "uncleared"],
      ["x29 Bravo", "2026-10-04", "50000", "orange", "cleared"],
      ["x29 Alpha", "2026-10-02", "15000", "yellow", "uncleared"],
    ] as const;
    const label = new Map<string, string>();
    for (const [payeeName, date, amount, flag, cleared] of rows) {
      const t = await add({ date, amount, payeeName, flag, cleared });
      label.set(t.id, `${payeeName.slice(4)} ${date.slice(5)} ${amount}`);
      if (payeeName === "x29 Charlie" && amount === "-10000") {
        await db.update(transaction).set({ cleared: "reconciled" }).where(eq(transaction.id, t.id));
      }
    }
    const order = async (sort: string) =>
      (await list({ sort })).transactions.flatMap((t) => label.get(t.id) ?? []);

    expect(await order("payee:desc,date:desc")).toEqual([
      "Charlie 10-02 -10000",
      "Charlie 10-01 5000",
      "Bravo 10-04 50000",
      "Bravo 10-03 -30000",
      "Bravo 10-01 -10000",
      "Alpha 10-04 -5000",
      "Alpha 10-03 20000",
      "Alpha 10-02 -30000",
      "Alpha 10-02 15000",
    ]);
    // An earlier column breaks ties in its own direction.
    expect(await order("date:asc,payee:desc")).toEqual([
      "Charlie 10-01 5000",
      "Bravo 10-01 -10000",
      "Charlie 10-02 -10000",
      "Alpha 10-02 -30000",
      "Alpha 10-02 15000",
      "Bravo 10-03 -30000",
      "Alpha 10-03 20000",
      "Bravo 10-04 50000",
      "Alpha 10-04 -5000",
    ]);
    // Outflow and Inflow each count the other side as zero.
    expect(await order("outflow:desc,payee:desc,date:desc")).toEqual([
      "Bravo 10-03 -30000",
      "Alpha 10-02 -30000",
      "Charlie 10-02 -10000",
      "Bravo 10-01 -10000",
      "Alpha 10-04 -5000",
      "Charlie 10-01 5000",
      "Bravo 10-04 50000",
      "Alpha 10-03 20000",
      "Alpha 10-02 15000",
    ]);
    expect(await order("inflow:asc,outflow:asc,payee:desc,date:desc")).toEqual([
      "Alpha 10-04 -5000",
      "Charlie 10-02 -10000",
      "Bravo 10-01 -10000",
      "Bravo 10-03 -30000",
      "Alpha 10-02 -30000",
      "Charlie 10-01 5000",
      "Alpha 10-02 15000",
      "Alpha 10-03 20000",
      "Bravo 10-04 50000",
    ]);
    // Flags: none, red, orange, yellow, green, blue, purple.
    expect(await order("flag:desc,date:desc")).toEqual([
      "Charlie 10-02 -10000",
      "Alpha 10-02 -30000",
      "Charlie 10-01 5000",
      "Alpha 10-02 15000",
      "Bravo 10-04 50000",
      "Alpha 10-04 -5000",
      "Bravo 10-01 -10000",
      "Bravo 10-03 -30000",
      "Alpha 10-03 20000",
    ]);
    // Cleared: reconciled, cleared, uncleared.
    expect(await order("cleared:desc,flag:asc,date:desc")).toEqual([
      "Bravo 10-03 -30000",
      "Alpha 10-04 -5000",
      "Alpha 10-02 15000",
      "Charlie 10-01 5000",
      "Alpha 10-02 -30000",
      "Alpha 10-03 20000",
      "Bravo 10-01 -10000",
      "Bravo 10-04 50000",
      "Charlie 10-02 -10000",
    ]);
    expect((await order("cleared:asc,flag:asc,date:desc"))[0]).toBe("Charlie 10-02 -10000");

    for (const sort of [
      "date:desc",
      "date:asc",
      "account:asc,date:desc",
      "payee:desc,date:asc",
      "category:asc",
      "memo:desc,payee:asc",
      "outflow:asc,inflow:desc",
      "inflow:desc",
      "flag:asc,cleared:desc,payee:asc",
      "cleared:asc",
    ]) {
      const all = (await list({ sort, limit: "100" })).transactions.map((t) => t.id);
      const seen: string[] = [];
      let cursor: string | null | undefined;
      do {
        const page = await list({ sort, limit: "2", ...(cursor ? { cursor } : {}) });
        seen.push(...page.transactions.map((t) => t.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen, sort).toEqual(all);
      expect(seen).toHaveLength(10);
    }
  });

  it("rejects a cursor from another sort, and a sort it can't read", async () => {
    const { base, cookie, account, add, list } = await setup();
    await add({ date: "2026-02-01", amount: "-100" });
    const { nextCursor } = await list({ limit: "1" });
    const res = await send(
      "GET",
      `${base}/transactions?accountId=${account.id}&sort=payee:asc&cursor=${nextCursor}`,
      cookie,
    );
    expect(res.status).toBe(400);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("INVALID_CURSOR");
    const junk = await send("GET", `${base}/transactions?cursor=nope`, cookie);
    expect(junk.status).toBe(400);
    for (const sort of ["payee", "amount:asc", "date:up", "date:desc,"]) {
      const bad = await send("GET", `${base}/transactions?sort=${sort}`, cookie);
      expect(bad.status, sort).toBe(400);
    }
  });
});
