import { transaction } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

/**
 * Undo bringing back a deleted transaction restores a deleted transfer's other side exactly as it
 * was (its own cleared state, flag and memo), even when the other account was closed in the
 * meantime.
 */

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Account = { id: string };
type Side = {
  memo: string;
  cleared: string;
  flag: string | null;
  approved: boolean;
  categoryId: string | null;
};
type Line = {
  id: string;
  amount: string;
  payeeName: string | null;
  categoryId: string | null;
  memo: string;
  transferAccountId: string | null;
  transferTransactionId: string | null;
  transferSide: Side | null;
};
type Txn = {
  id: string;
  accountId: string;
  date: string;
  amount: string;
  payeeName: string | null;
  categoryId: string | null;
  memo: string;
  cleared: string;
  flag: string | null;
  approved: boolean;
  transferAccountId: string | null;
  transferTransactionId: string | null;
  transferSide: Side | null;
  subtransactions: Line[];
};
type Category = { id: string; name: string };
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

async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (name: string, type: string, balance = "0") =>
    json<Account>(
      await send("POST", `${base}/accounts`, cookie, { name, type, balance, date: TODAY }),
    );
  const groups = (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie)))
    .groups;
  const [groceries, rent] = groups.filter((g) => !g.kind).flatMap((g) => g.categories);
  if (!groceries || !rent) throw new Error("starter categories missing");
  const post = (input: Record<string, unknown>) =>
    send("POST", `${base}/transactions`, cookie, { date: TODAY, categoryId: null, ...input });
  const created = async (input: Record<string, unknown>) => {
    const res = await post(input);
    expect(res.status, await res.clone().text()).toBe(201);
    return json<Txn>(res);
  };
  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await send("PATCH", `${base}/transactions/${id}`, cookie, body);
    expect(res.status, await res.clone().text()).toBe(200);
    return json<Txn>(res);
  };
  const remove = async (id: string) => {
    const res = await send("DELETE", `${base}/transactions/${id}`, cookie);
    expect(res.status, await res.clone().text()).toBe(204);
  };
  const register = async (accountId: string) =>
    (
      await json<{ transactions: Txn[] }>(
        await send("GET", `${base}/transactions?accountId=${accountId}`, cookie),
      )
    ).transactions.filter((t) => t.payeeName !== "Starting Balance");
  const closeAccount = async (id: string) => {
    const res = await send("POST", `${base}/accounts/${id}/close`, cookie, { date: TODAY });
    expect(res.status, await res.clone().text()).toBe(200);
  };
  /** What the web's undo sends to bring `t` back (see `createBodyFromTransaction`). */
  const restoreBody = (t: Txn) => ({
    accountId: t.accountId,
    date: t.date,
    amount: t.amount,
    ...(t.transferAccountId
      ? { payeeName: null, transferAccountId: t.transferAccountId }
      : { payeeName: t.payeeName }),
    categoryId: t.subtransactions.length > 0 ? null : t.categoryId,
    memo: t.memo,
    cleared: t.cleared,
    flag: t.flag,
    approved: t.approved,
    ...(t.transferSide ? { transferSide: t.transferSide } : {}),
    ...(t.subtransactions.length > 0
      ? {
          subtransactions: t.subtransactions.map((l) => ({
            amount: l.amount,
            ...(l.transferAccountId
              ? { payeeName: null, transferAccountId: l.transferAccountId }
              : { payeeName: l.payeeName }),
            categoryId: l.categoryId,
            memo: l.memo,
            ...(l.transferSide ? { transferSide: l.transferSide } : {}),
          })),
        }
      : {}),
    restore: true,
  });
  return {
    base,
    cookie,
    addAccount,
    post,
    created,
    patch,
    remove,
    register,
    closeAccount,
    restoreBody,
    groceries,
    rent,
  };
}

describe("restoring a deleted transaction (undo)", () => {
  it("exposes a transfer's other side and brings it back as it was", async () => {
    const ctx = await setup();
    const checking = await ctx.addAccount("Checking", "checking", "100000");
    const savings = await ctx.addAccount("Savings", "savings");
    const out = await ctx.created({
      accountId: checking.id,
      transferAccountId: savings.id,
      amount: "-1000",
      memo: "checking side",
    });
    await ctx.patch(out.transferTransactionId ?? "", { cleared: "cleared", flag: "red" });
    // A single edit's memo shows on both sides; the bulk Memo action sets one side's.
    const bulk = await send("POST", `${ctx.base}/transactions/bulk`, ctx.cookie, {
      selection: { ids: [out.transferTransactionId] },
      action: { type: "memo", memo: "savings side" },
    });
    expect(bulk.status).toBe(200);
    const [before] = await ctx.register(checking.id);
    expect(before?.transferSide).toMatchObject({
      memo: "savings side",
      cleared: "cleared",
      flag: "red",
      approved: true,
      categoryId: null,
      amount: "1000",
      currency: "USD",
    });
    // This side keeps its own state.
    expect(before).toMatchObject({ memo: "checking side", cleared: "uncleared", flag: null });

    await ctx.remove(out.id);
    expect(await ctx.register(savings.id)).toEqual([]);
    if (!before) throw new Error("missing");
    await ctx.created(ctx.restoreBody(before));

    const [back] = await ctx.register(checking.id);
    expect(back).toMatchObject({ memo: "checking side", cleared: "uncleared", flag: null });
    const [other] = await ctx.register(savings.id);
    expect(other).toMatchObject({
      amount: "1000",
      memo: "savings side",
      cleared: "cleared",
      flag: "red",
      approved: true,
      transferAccountId: checking.id,
      transferTransactionId: back?.id,
    });
  });

  it("brings back a reconciled other side and an unapproved transaction", async () => {
    const ctx = await setup();
    const checking = await ctx.addAccount("Checking", "checking", "100000");
    const savings = await ctx.addAccount("Savings", "savings");
    const out = await ctx.created({
      accountId: checking.id,
      transferAccountId: savings.id,
      amount: "-1000",
    });
    // As reconciling or entering a schedule leaves them.
    await db
      .update(transaction)
      .set({ cleared: "reconciled" })
      .where(eq(transaction.id, out.transferTransactionId ?? ""));
    await db.update(transaction).set({ approved: false }).where(eq(transaction.id, out.id));
    const [before] = await ctx.register(checking.id);
    if (!before) throw new Error("missing");
    expect(before.approved).toBe(false);
    expect(before.transferSide?.cleared).toBe("reconciled");

    await ctx.remove(out.id);
    await ctx.created(ctx.restoreBody(before));
    expect((await ctx.register(checking.id))[0]?.approved).toBe(false);
    expect((await ctx.register(savings.id))[0]).toMatchObject({
      cleared: "reconciled",
      approved: true,
    });
  });

  it("brings back the category a tracking transfer keeps on its budget side", async () => {
    const ctx = await setup();
    const checking = await ctx.addAccount("Checking", "checking", "100000");
    const brokerage = await ctx.addAccount("Brokerage", "asset");
    const out = await ctx.created({
      accountId: checking.id,
      transferAccountId: brokerage.id,
      amount: "-1000",
      categoryId: ctx.groceries.id,
    });
    // Deleted from the tracking side, which has no category of its own.
    const [tracked] = await ctx.register(brokerage.id);
    if (!tracked) throw new Error("missing");
    expect(tracked.categoryId).toBeNull();
    expect(tracked.transferSide?.categoryId).toBe(ctx.groceries.id);
    await ctx.remove(tracked.id);
    await ctx.created(ctx.restoreBody(tracked));
    const [budgetSide] = await ctx.register(checking.id);
    expect(budgetSide).toMatchObject({ amount: "-1000", categoryId: ctx.groceries.id });
    expect(budgetSide?.id).not.toBe(out.id);
  });

  it("brings a transfer back to an account closed since, but only as a restore", async () => {
    const ctx = await setup();
    const checking = await ctx.addAccount("Checking", "checking", "100000");
    const old = await ctx.addAccount("Old", "savings");
    const out = await ctx.created({
      accountId: checking.id,
      transferAccountId: old.id,
      amount: "-1000",
    });
    const [before] = await ctx.register(checking.id);
    if (!before) throw new Error("missing");
    await ctx.remove(out.id);
    await ctx.closeAccount(old.id);

    const { restore: _, ...plain } = ctx.restoreBody(before);
    const refused = await ctx.post(plain);
    expect((await json<ErrorBody>(refused)).error.code).toBe("ACCOUNT_CLOSED");

    await ctx.created(ctx.restoreBody(before));
    expect((await ctx.register(old.id))[0]).toMatchObject({
      amount: "1000",
      transferAccountId: checking.id,
    });
    // The account stays closed.
    const { accounts } = await json<{ accounts: { id: string; closed: boolean }[] }>(
      await send("GET", `${ctx.base}/accounts`, ctx.cookie),
    );
    expect(accounts.find((a) => a.id === old.id)?.closed).toBe(true);
  });

  it("restores a deleted transaction in a closed account (its other side included)", async () => {
    const ctx = await setup();
    const checking = await ctx.addAccount("Checking", "checking", "100000");
    const old = await ctx.addAccount("Old", "savings");
    await ctx.created({ accountId: checking.id, transferAccountId: old.id, amount: "-1000" });
    const [inOld] = await ctx.register(old.id);
    if (!inOld) throw new Error("missing");
    await ctx.remove(inOld.id);
    await ctx.closeAccount(old.id);
    await ctx.created(ctx.restoreBody(inOld));
    expect((await ctx.register(checking.id))[0]?.amount).toBe("-1000");
  });

  it("brings back a split's transfer lines' other sides as they were", async () => {
    const ctx = await setup();
    const checking = await ctx.addAccount("Checking", "checking", "100000");
    const savings = await ctx.addAccount("Savings", "savings");
    const split = await ctx.created({
      accountId: checking.id,
      amount: "-3000",
      subtransactions: [
        { amount: "-1000", payeeName: "Shop", categoryId: ctx.groceries.id },
        { amount: "-2000", transferAccountId: savings.id, memo: "line memo" },
      ],
    });
    const [inSavings] = await ctx.register(savings.id);
    await ctx.patch(inSavings?.id ?? "", { cleared: "cleared", flag: "blue", memo: "own" });
    const [before] = await ctx.register(checking.id);
    if (!before) throw new Error("missing");
    expect(before.transferSide).toBeNull();
    expect(before.subtransactions[1]?.transferSide).toMatchObject({
      memo: "own",
      cleared: "cleared",
      flag: "blue",
      approved: true,
      categoryId: null,
      amount: "2000",
      currency: "USD",
    });

    await ctx.remove(split.id);
    await ctx.closeAccount(savings.id);
    await ctx.created(ctx.restoreBody(before));
    expect((await ctx.register(savings.id))[0]).toMatchObject({
      amount: "2000",
      memo: "own",
      cleared: "cleared",
      flag: "blue",
    });
  });

  it("refuses a transfer side without a transfer", async () => {
    const ctx = await setup();
    const checking = await ctx.addAccount("Checking", "checking", "100000");
    const res = await ctx.post({
      accountId: checking.id,
      amount: "-1",
      payeeName: "Shop",
      transferSide: {
        memo: "",
        cleared: "cleared",
        flag: null,
        approved: true,
        categoryId: null,
      },
    });
    expect(res.status).toBe(400);
  });
});
