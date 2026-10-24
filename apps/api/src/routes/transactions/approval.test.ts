import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Txn = {
  id: string;
  accountId: string;
  approved: boolean;
  needsCategory: boolean;
  memo: string;
  flag: string | null;
  payeeName: string | null;
  transferTransactionId: string | null;
};
type Account = { id: string; name: string; toReview: number; balances: { working: string } };

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
  const addAccount = async (name: string, type: string, balance = "0") =>
    json<{ id: string }>(
      await send("POST", `${base}/accounts`, cookie, {
        name,
        type,
        balance,
        date: "2026-01-01",
      }),
    );
  const checking = await addAccount("Checking", "checking");
  const { groups } = await json<{
    groups: { kind: string | null; categories: { id: string }[] }[];
  }>(await send("GET", `${base}/categories`, cookie));
  const groceries = groups.filter((g) => !g.kind).flatMap((g) => g.categories)[0];
  if (!groceries) throw new Error("starter categories missing");
  const add = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions`, cookie, {
      accountId: checking.id,
      date: "2026-02-01",
      amount: "-100",
      categoryId: groceries.id,
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<Txn>(res);
  };
  const patch = async (id: string, body: unknown) => {
    const res = await send("PATCH", `${base}/transactions/${id}`, cookie, body);
    expect(res.status, await res.clone().text()).toBe(200);
    return json<Txn>(res);
  };
  const rows = async (q = "", accountId = checking.id) =>
    (
      await json<{ transactions: Txn[] }>(
        await send(
          "GET",
          `${base}/transactions?accountId=${accountId}&limit=500&q=${encodeURIComponent(q)}`,
          cookie,
        ),
      )
    ).transactions;
  const row = async (id: string, accountId = checking.id) => {
    const found = (await rows("", accountId)).find((t) => t.id === id);
    if (!found) throw new Error(`no row ${id}`);
    return found;
  };
  const accounts = async () =>
    (await json<{ accounts: Account[] }>(await send("GET", `${base}/accounts`, cookie))).accounts;
  const bulk = async (selection: unknown, action: unknown) => {
    const res = await send("POST", `${base}/transactions/bulk`, cookie, { selection, action });
    expect(res.status, await res.clone().text()).toBe(200);
    return json<{ updated: number; before: Txn[] }>(res);
  };
  const summary = async (selection: unknown) =>
    json<{ unapproved: number; count: number }>(
      await send("POST", `${base}/transactions/selection`, cookie, { selection }),
    );
  return {
    base,
    checking,
    groceries,
    addAccount,
    add,
    patch,
    rows,
    row,
    accounts,
    bulk,
    summary,
  };
}

describe("unapproved transactions", () => {
  it("count in the account's balance, and are flagged for review", async () => {
    const { checking, add, accounts } = await setup();
    const t = await add({ approved: false, amount: "-1200" });
    expect(t.approved).toBe(false);
    expect(t.needsCategory).toBe(false);
    const account = (await accounts()).find((a) => a.id === checking.id);
    // An unapproved transaction counts everywhere.
    expect(account?.balances.working).toBe("-1200");
    expect(account?.toReview).toBe(1);
  });

  it("counts each row that is unapproved or needs a category once, per account", async () => {
    const { checking, addAccount, add, accounts } = await setup();
    const savings = await addAccount("Savings", "savings");
    const tracking = await addAccount("Brokerage", "asset");
    await add({ approved: false }); // unapproved
    await add({ categoryId: null }); // needs a category
    await add({ approved: false, categoryId: null }); // both, counted once
    await add({}); // neither
    // A transfer within the budget needs no category; one to tracking does.
    await add({ payeeName: null, transferAccountId: savings.id, categoryId: null });
    await add({ payeeName: null, transferAccountId: tracking.id, categoryId: null });
    // Tracking accounts never need one.
    await add({ accountId: tracking.id, categoryId: null });
    const byId = new Map((await accounts()).map((a) => [a.id, a.toReview]));
    expect(byId.get(checking.id)).toBe(4);
    expect(byId.get(savings.id)).toBe(0);
    expect(byId.get(tracking.id)).toBe(0);
  });

  it("doesn't count a credit card's uncategorized Starting Balance", async () => {
    const { addAccount, accounts } = await setup();
    const card = await addAccount("Card", "credit_card", "-50000");
    expect((await accounts()).find((a) => a.id === card.id)?.toReview).toBe(0);
  });

  it("approves on request, and the other side of a transfer with it", async () => {
    const { addAccount, add, patch, row } = await setup();
    const savings = await addAccount("Savings", "savings");
    const t = await add({
      payeeName: null,
      transferAccountId: savings.id,
      categoryId: null,
      approved: false,
      transferSide: {
        memo: "",
        cleared: "uncleared",
        flag: null,
        approved: false,
        categoryId: null,
      },
    });
    const otherId = t.transferTransactionId ?? "";
    expect((await row(otherId, savings.id)).approved).toBe(false);
    expect((await patch(t.id, { approved: true })).approved).toBe(true);
    expect((await row(otherId, savings.id)).approved).toBe(true);
    // An undo takes both back.
    expect((await patch(t.id, { approved: false })).approved).toBe(false);
    expect((await row(otherId, savings.id)).approved).toBe(false);
  });

  it("approves a split's transfer lines' other sides with it, both ways", async () => {
    const { checking, groceries, addAccount, add, patch, row, rows, bulk } = await setup();
    const savings = await addAccount("Savings", "savings");
    const split = await add({
      categoryId: null,
      subtransactions: [
        { amount: "-40", categoryId: groceries.id },
        { amount: "-60", transferAccountId: savings.id },
      ],
    });
    const counterpart = (await rows("", savings.id)).find(
      (t) => t.payeeName !== "Starting Balance",
    );
    if (!counterpart) throw new Error("no transfer line counterpart");

    // Unapproving (an undo) either side takes the other along.
    await patch(counterpart.id, { approved: false });
    expect((await row(split.id)).approved).toBe(false);
    await patch(split.id, { approved: true });
    expect((await row(counterpart.id, savings.id)).approved).toBe(true);

    await patch(split.id, { approved: false });
    expect((await row(counterpart.id, savings.id)).approved).toBe(false);
    await bulk({ ids: [counterpart.id] }, { type: "approve" });
    expect((await row(split.id, checking.id)).approved).toBe(true);
    expect((await row(counterpart.id, savings.id)).approved).toBe(true);
  });

  it("approves on any edit but a flag, unless the edit says otherwise", async () => {
    const { add, patch } = await setup();
    const t = await add({ approved: false });
    // Setting a flag leaves it unapproved; saving it or clicking cleared approves it.
    expect((await patch(t.id, { flag: "red" })).approved).toBe(false);
    expect((await patch(t.id, { memo: "x", approved: false })).approved).toBe(false);
    expect((await patch(t.id, { memo: "edited" })).approved).toBe(true);
    const u = await add({ approved: false });
    expect((await patch(u.id, { cleared: "cleared" })).approved).toBe(true);
  });

  it("bulk approves, and rejects only the unapproved rows", async () => {
    const { add, bulk, summary, rows } = await setup();
    const a = await add({ approved: false, memo: "a" });
    const b = await add({ approved: false, memo: "b" });
    const c = await add({ memo: "c" });
    expect((await summary({ ids: [a.id, b.id, c.id] })).unapproved).toBe(2);

    const approved = await bulk({ ids: [a.id, c.id] }, { type: "approve" });
    expect(approved.updated).toBe(1);
    expect(approved.before.map((t) => [t.id, t.approved])).toEqual([[a.id, false]]);

    const rejected = await bulk({ ids: [a.id, b.id, c.id] }, { type: "reject" });
    expect(rejected.updated).toBe(1);
    expect(rejected.before.map((t) => t.id)).toEqual([b.id]);
    expect((await rows()).map((t) => t.memo).sort()).toEqual(["", "a", "c"]);
  });

  it("bulk cleared and categorize approve; bulk memo and flag don't", async () => {
    const { add, bulk, row, groceries } = await setup();
    const a = await add({ approved: false });
    const b = await add({ approved: false, categoryId: null });
    const c = await add({ approved: false });
    await bulk({ ids: [c.id] }, { type: "memo", memo: "m" });
    await bulk({ ids: [c.id] }, { type: "flag", flag: "red" });
    expect((await row(c.id)).approved).toBe(false);
    await bulk({ ids: [a.id] }, { type: "cleared", cleared: "cleared" });
    expect((await row(a.id)).approved).toBe(true);
    await bulk({ ids: [b.id] }, { type: "categorize", categoryId: groceries.id });
    expect((await row(b.id)).approved).toBe(true);
  });

  it("searches Is: Approved, Unapproved, Needs Category and both", async () => {
    const { add, rows } = await setup();
    await add({ approved: false, memo: "unapproved" });
    await add({ categoryId: null, memo: "uncategorized" });
    await add({ memo: "fine" });
    const memos = async (q: string) => (await rows(q)).map((t) => t.memo).sort();
    // The Starting Balance (memo "") is approved and in Ready to Assign.
    expect(await memos("Is: Approved")).toEqual(["", "fine", "uncategorized"]);
    expect(await memos("Is: Unapproved")).toEqual(["unapproved"]);
    expect(await memos("Is: Needs Category")).toEqual(["uncategorized"]);
    expect(await memos("Is: Unapproved or Needs Category")).toEqual([
      "unapproved",
      "uncategorized",
    ]);
  });

  it("counts an approved split with an uncategorized line as needing a category", async () => {
    const { add, rows, accounts, checking, groceries } = await setup();
    const split = await add({
      memo: "split",
      categoryId: null,
      amount: "-500",
      subtransactions: [
        { amount: "-300", categoryId: groceries.id, memo: "food" },
        { amount: "-200", categoryId: null, memo: "left" },
      ],
    });
    expect(split.approved).toBe(true);
    // The split's row has no icon of its own; its line carries the pill.
    const row = (await rows()).find((t) => t.id === split.id) as Txn & {
      subtransactions: { memo: string; needsCategory: boolean }[];
    };
    expect(row.needsCategory).toBe(false);
    expect(row.subtransactions.map((l) => [l.memo, l.needsCategory])).toEqual([
      ["food", false],
      ["left", true],
    ]);
    expect((await accounts()).find((a) => a.id === checking.id)?.toReview).toBe(1);
    // The search finds it and shows only the uncategorized line.
    const found = (await rows("Is: Needs Category")) as (Txn & { matchingLineIds: string[] })[];
    expect(found.map((t) => t.memo)).toEqual(["split"]);
    const left = row.subtransactions.find((l) => l.memo === "left") as unknown as { id: string };
    expect(found[0]?.matchingLineIds).toEqual([left.id]);
    expect((await rows("Is: Unapproved or Needs Category")).map((t) => t.memo)).toEqual(["split"]);
  });
});
