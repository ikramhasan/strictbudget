import { transaction } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Account = { id: string; balances: { working: string } };
type Line = {
  id: string;
  amount: string;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  memo: string;
  transferAccountId: string | null;
  transferTransactionId: string | null;
};
type Txn = {
  id: string;
  accountId: string;
  date: string;
  amount: string;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  memo: string;
  transferAccountId: string | null;
  transferTransactionId: string | null;
  transferFromSplit: boolean;
  subtransactions: Line[];
};
type Category = { id: string; name: string; hasTransactions: boolean };
type Group = { kind: string | null; categories: Category[] };
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
const code = async (res: Response) => (await json<ErrorBody>(res)).error.code;

async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (name: string, type: string, balance = "0") =>
    json<Account>(
      await send("POST", `${base}/accounts`, cookie, { name, type, balance, date: TODAY }),
    );
  const categories = async () =>
    (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie))).groups
      .filter((g) => !g.kind)
      .flatMap((g) => g.categories);
  const [groceries, household, rent] = await categories();
  if (!groceries || !household || !rent) throw new Error("starter categories missing");

  const post = (input: Record<string, unknown>) =>
    send("POST", `${base}/transactions`, cookie, { date: TODAY, categoryId: null, ...input });
  const patch = (id: string, body: Record<string, unknown>) =>
    send("PATCH", `${base}/transactions/${id}`, cookie, body);
  const find = async (id: string) =>
    (
      await json<{ transactions: Txn[] }>(await send("GET", `${base}/transactions`, cookie))
    ).transactions.find((t) => t.id === id);
  const working = async (accountId: string) => {
    const { accounts } = await json<{ accounts: (Account & { id: string })[] }>(
      await send("GET", `${base}/accounts?today=${TODAY}`, cookie),
    );
    return accounts.find((a) => a.id === accountId)?.balances.working;
  };
  /** The $120 receipt: $80 groceries + $40 household. */
  const receipt = async (accountId: string) => {
    const res = await post({
      accountId,
      amount: "-12000",
      payeeName: "Supermarket",
      subtransactions: [
        { amount: "-8000", categoryId: groceries.id, memo: "food" },
        { amount: "-4000", categoryId: household.id },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<Txn>(res);
  };
  return {
    cookie,
    base,
    addAccount,
    categories,
    post,
    patch,
    find,
    working,
    receipt,
    groceries,
    household,
    rent,
  };
}

describe("split transactions", () => {
  it("spreads one transaction across categories", async () => {
    const { addAccount, receipt, working, groceries, household } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const split = await receipt(checking.id);
    expect(split).toMatchObject({ amount: "-12000", payeeName: "Supermarket", categoryId: null });
    expect(split.subtransactions.map((l) => [l.amount, l.categoryId, l.payeeName, l.memo])).toEqual(
      [
        ["-8000", groceries.id, null, "food"],
        ["-4000", household.id, null, ""],
      ],
    );
    expect(await working(checking.id)).toBe("88000");
  });

  it("rejects lines that don't add up, splits in tracking accounts and split transfers", async () => {
    const { addAccount, post, groceries, household } = await setup();
    const checking = await addAccount("Checking", "checking");
    const savings = await addAccount("Savings", "savings");
    const brokerage = await addAccount("Brokerage", "asset");
    const lines = [
      { amount: "-100", categoryId: groceries.id },
      { amount: "-200", categoryId: household.id },
    ];
    expect(
      await code(await post({ accountId: checking.id, amount: "-301", subtransactions: lines })),
    ).toBe("SPLIT_TOTAL_MISMATCH");
    const tracked = await post({
      accountId: brokerage.id,
      amount: "-300",
      subtransactions: lines.map((l) => ({ ...l, categoryId: null })),
    });
    expect(await code(tracked)).toBe("SPLIT_NOT_ALLOWED");
    const transfer = await post({
      accountId: checking.id,
      transferAccountId: savings.id,
      amount: "-300",
      subtransactions: lines,
    });
    expect(await code(transfer)).toBe("SPLIT_NOT_ALLOWED");
    const withCategory = await post({
      accountId: checking.id,
      amount: "-300",
      categoryId: groceries.id,
      subtransactions: lines,
    });
    expect(withCategory.status).toBe(400);
    const oneLine = await post({
      accountId: checking.id,
      amount: "-100",
      subtransactions: [lines[0]],
    });
    expect(oneLine.status).toBe(400);
  });

  it("edits lines in place, and needs new lines to change the amount", async () => {
    const { addAccount, receipt, patch, groceries, rent } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const split = await receipt(checking.id);
    const [food, home] = split.subtransactions;
    if (!food || !home) throw new Error("lines missing");

    expect(await code(await patch(split.id, { amount: "-13000" }))).toBe("SPLIT_TOTAL_MISMATCH");

    const edited = await json<Txn>(
      await patch(split.id, {
        amount: "-15000",
        subtransactions: [
          { id: food.id, amount: "-8000", categoryId: groceries.id, memo: "food" },
          { amount: "-5000", categoryId: rent.id, payeeName: "Landlord" },
          { amount: "-2000", categoryId: null },
        ],
      }),
    );
    expect(edited.subtransactions.map((l) => [l.id === food.id, l.amount, l.categoryName])).toEqual(
      [
        [true, "-8000", groceries.name],
        [false, "-5000", rent.name],
        [false, "-2000", "Uncategorized"],
      ],
    );
    expect(edited.subtransactions[1]?.payeeName).toBe("Landlord");
  });

  it("un-splits when given a category", async () => {
    const { addAccount, receipt, patch, groceries } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const split = await receipt(checking.id);
    const single = await json<Txn>(await patch(split.id, { categoryId: groceries.id }));
    expect(single).toMatchObject({ categoryId: groceries.id, subtransactions: [] });
  });

  it("turns a line into a transfer whose other side is edited from the split", async () => {
    const { base, cookie, addAccount, post, patch, find, working, groceries } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const savings = await addAccount("Savings", "savings");
    const split = await json<Txn>(
      await post({
        accountId: checking.id,
        amount: "-12000",
        payeeName: "Payday stash",
        subtransactions: [
          { amount: "-8000", categoryId: groceries.id },
          { amount: "-4000", transferAccountId: savings.id, memo: "save" },
        ],
      }),
    );
    const line = split.subtransactions[1];
    expect(line).toMatchObject({ payeeName: "Transfer : Savings", categoryId: null });
    const otherId = line?.transferTransactionId ?? "";
    expect(await find(otherId)).toMatchObject({
      accountId: savings.id,
      amount: "4000",
      payeeName: "Transfer : Checking",
      memo: "save",
      transferAccountId: checking.id,
      transferTransactionId: split.id,
      transferFromSplit: true,
    });
    expect(await working(savings.id)).toBe("4000");

    expect(await code(await patch(otherId, { amount: "5000" }))).toBe("TRANSFER_IN_SPLIT");
    expect(await code(await patch(otherId, { date: "2026-10-05" }))).toBe("TRANSFER_IN_SPLIT");
    expect((await patch(otherId, { memo: "mine", cleared: "cleared" })).status).toBe(200);
    // The memo is the line's too.
    expect((await find(split.id))?.subtransactions[1]?.memo).toBe("mine");
    expect(await code(await send("DELETE", `${base}/transactions/${otherId}`, cookie))).toBe(
      "TRANSFER_IN_SPLIT",
    );

    // The split's date carries over; editing the line's amount too.
    await patch(split.id, { date: "2026-10-03" });
    await patch(split.id, {
      amount: "-12000",
      subtransactions: [
        { id: split.subtransactions[0]?.id, amount: "-7000", categoryId: groceries.id },
        { id: line?.id, amount: "-5000", transferAccountId: savings.id, memo: "mine" },
      ],
    });
    expect(await find(otherId)).toMatchObject({
      date: "2026-10-03",
      amount: "5000",
      memo: "mine",
      cleared: "cleared",
    });

    // Deleting the split deletes the transfer's other side.
    expect((await send("DELETE", `${base}/transactions/${split.id}`, cookie)).status).toBe(204);
    expect(await find(otherId)).toBeUndefined();
    expect(await working(savings.id)).toBe("0");
  });

  it("removes a transfer line's other side when the line goes, reconciled or not", async () => {
    const { addAccount, post, patch, find, groceries } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const savings = await addAccount("Savings", "savings");
    const split = await json<Txn>(
      await post({
        accountId: checking.id,
        amount: "-300",
        subtransactions: [
          { amount: "-100", categoryId: groceries.id },
          { amount: "-200", transferAccountId: savings.id },
        ],
      }),
    );
    const otherId = split.subtransactions[1]?.transferTransactionId ?? "";
    await db.update(transaction).set({ cleared: "reconciled" }).where(eq(transaction.id, otherId));
    expect((await patch(split.id, { categoryId: groceries.id })).status).toBe(200);
    expect(await find(otherId)).toBeUndefined();
  });

  it("changes a transfer line whose other side is reconciled, which stays reconciled", async () => {
    const { addAccount, post, patch, find, groceries } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const savings = await addAccount("Savings", "savings");
    const split = await json<Txn>(
      await post({
        accountId: checking.id,
        amount: "-1300",
        subtransactions: [
          { amount: "-600", transferAccountId: savings.id },
          { amount: "-700", categoryId: groceries.id },
        ],
      }),
    );
    const [line, rest] = split.subtransactions;
    const otherId = line?.transferTransactionId ?? "";
    await db.update(transaction).set({ cleared: "reconciled" }).where(eq(transaction.id, otherId));
    const res = await patch(split.id, {
      subtransactions: [
        { id: line?.id, amount: "-800", transferAccountId: savings.id },
        { id: rest?.id, amount: "-500", categoryId: groceries.id },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await find(otherId)).toMatchObject({ amount: "800", cleared: "reconciled" });
  });

  it("moves with its account and stays in budget accounts", async () => {
    const { addAccount, post, patch, find, groceries } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const cash = await addAccount("Wallet", "cash");
    const savings = await addAccount("Savings", "savings");
    const brokerage = await addAccount("Brokerage", "asset");
    const split = await json<Txn>(
      await post({
        accountId: checking.id,
        amount: "-300",
        subtransactions: [
          { amount: "-100", categoryId: groceries.id },
          { amount: "-200", transferAccountId: savings.id },
        ],
      }),
    );
    expect(await code(await patch(split.id, { accountId: brokerage.id }))).toBe(
      "SPLIT_NOT_ALLOWED",
    );
    expect(await code(await patch(split.id, { accountId: savings.id }))).toBe(
      "TRANSFER_SAME_ACCOUNT",
    );
    const moved = await json<Txn>(await patch(split.id, { accountId: cash.id }));
    expect(moved.subtransactions[0]?.categoryId).toBe(groceries.id);
    const otherId = moved.subtransactions[1]?.transferTransactionId ?? "";
    expect((await find(otherId))?.payeeName).toBe("Transfer : Wallet");
  });

  it("counts split lines as category history and reassigns them", async () => {
    const { base, cookie, addAccount, receipt, find, categories, household, rent } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const split = await receipt(checking.id);
    expect((await categories()).find((c) => c.id === household.id)?.hasTransactions).toBe(true);

    expect(await code(await send("DELETE", `${base}/categories/${household.id}`, cookie))).toBe(
      "CATEGORY_HAS_HISTORY",
    );
    const res = await send(
      "DELETE",
      `${base}/categories/${household.id}?reassignToCategoryId=${rent.id}`,
      cookie,
    );
    expect(res.status).toBe(204);
    expect((await find(split.id))?.subtransactions[1]?.categoryId).toBe(rent.id);
  });
});
