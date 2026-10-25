import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import type { FakeFxProvider } from "../../lib/fx/fake";

// Transfers between accounts in different currencies. Each side keeps its own amount; the two
// always have opposite base amounts, so a transfer moves no money in the plan.
const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset()
    .seed("2026-10-01", "EUR", { USD: "1.25" })
    .seed("2026-10-01", "USD", { EUR: "0.8", JPY: "150" });
});
afterAll(close);

const TODAY = "2026-10-16";

type Side = {
  memo: string;
  cleared: string;
  flag: string | null;
  approved: boolean;
  categoryId: string | null;
  amount: string;
  currency: string;
};
type Txn = {
  id: string;
  accountId: string;
  date: string;
  amount: string;
  currency: string;
  baseAmount: string;
  fxRate: string | null;
  categoryId: string | null;
  payeeName: string | null;
  memo: string;
  transferTransactionId: string | null;
  transferSide: Side | null;
  feeTransactionId?: string | null;
  subtransactions: {
    id: string;
    amount: string;
    baseAmount: string;
    transferTransactionId: string | null;
    transferSide: Side | null;
  }[];
};
type Month = { readyToAssign: string; categories: { categoryId: string; activity: string }[] };
type Group = { kind: string | null; categories: { id: string; name: string }[] };

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
  const addAccount = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/accounts`, cookie, {
      balance: "0",
      date: "2026-10-01",
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<{ id: string }>(res);
  };
  const create = async (input: Record<string, unknown>, status = 201) => {
    const res = await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
      date: "2026-10-05",
      payeeName: null,
      categoryId: null,
      memo: "",
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(status);
    return json<Txn>(res);
  };
  const update = async (id: string, input: Record<string, unknown>, status = 200) => {
    const res = await send("PATCH", `${base}/transactions/${id}?today=${TODAY}`, cookie, input);
    expect(res.status, await res.clone().text()).toBe(status);
    return json<Txn>(res);
  };
  const remove = async (id: string) => {
    const res = await send("DELETE", `${base}/transactions/${id}`, cookie);
    expect(res.status, await res.clone().text()).toBe(204);
  };
  /** Every transaction in an account, without its Starting Balance. */
  const rows = async (accountId: string) => {
    const res = await send("GET", `${base}/transactions?accountId=${accountId}`, cookie);
    expect(res.status).toBe(200);
    return (await json<{ transactions: Txn[] }>(res)).transactions.filter(
      (t) => t.payeeName !== "Starting Balance",
    );
  };
  const only = async (accountId: string) => {
    const list = await rows(accountId);
    expect(list).toHaveLength(1);
    return list[0] as Txn;
  };
  const month = async () => {
    const res = await send("GET", `${base}/months/2026-10?today=${TODAY}`, cookie);
    expect(res.status).toBe(200);
    const body = await json<Month>(res);
    return { ...body, of: (id: string) => body.categories.find((c) => c.categoryId === id) };
  };
  const { groups } = await json<{ groups: Group[] }>(
    await send("GET", `${base}/categories`, cookie),
  );
  const [groceries] = groups.filter((g) => !g.kind).flatMap((g) => g.categories);
  if (!groceries) throw new Error("starter data missing");
  const checking = await addAccount({ name: "Checking", type: "checking" });
  const euros = await addAccount({ name: "Euros", type: "savings", currency: "EUR" });
  return {
    cookie,
    base,
    addAccount,
    create,
    update,
    remove,
    rows,
    only,
    month,
    groceries,
    checking,
    euros,
  };
}

describe("cross-currency transfers", () => {
  it("keeps both amounts: opposite base amounts and the rate they imply", async () => {
    const { create, only, checking, euros } = await setup();
    const sent = await create({
      accountId: checking.id,
      amount: "-10000",
      transferAccountId: euros.id,
      transferAmount: "8500",
    });
    expect(sent).toMatchObject({ amount: "-10000", baseAmount: "-10000", fxRate: null });
    expect(sent.transferSide).toMatchObject({ amount: "8500", currency: "EUR" });
    // $100.00 for €85.00: 1 EUR = 100 / 85 USD.
    expect(await only(euros.id)).toMatchObject({
      amount: "8500",
      currency: "EUR",
      baseAmount: "10000",
      fxRate: "1.176470588235",
    });
  });

  it("converts at the date's rate when the other amount is left out, from either side", async () => {
    const { create, only, checking, euros } = await setup();
    await create({ accountId: checking.id, amount: "-10000", transferAccountId: euros.id });
    expect(await only(euros.id)).toMatchObject({
      amount: "8000",
      baseAmount: "10000",
      fxRate: "1.25",
    });
    const dollars = await setup();
    // Entered in the euro account: €40.00 at 1.25 is $50.00.
    const sent = await dollars.create({
      accountId: dollars.euros.id,
      amount: "-4000",
      transferAccountId: dollars.checking.id,
    });
    expect(sent).toMatchObject({ baseAmount: "-5000", fxRate: "1.25" });
    expect(await dollars.only(dollars.checking.id)).toMatchObject({
      amount: "5000",
      baseAmount: "5000",
      fxRate: null,
    });
  });

  it("lets the side in the budget's currency set the base amount over a typed rate", async () => {
    const { create, only, checking, euros } = await setup();
    const sent = await create({
      accountId: euros.id,
      amount: "-4000",
      fxRate: "1.3",
      transferAccountId: checking.id,
      transferAmount: "5100",
    });
    expect(sent).toMatchObject({ baseAmount: "-5100", fxRate: "1.275" });
    expect(await only(checking.id)).toMatchObject({ amount: "5100", baseAmount: "5100" });
  });

  it("converts through the base amount when both sides are foreign", async () => {
    const { addAccount, create, only, euros } = await setup();
    const yen = await addAccount({ name: "Yen", type: "cash", currency: "JPY" });
    // €100.00 at 1.25 is $125.00, which is ¥18,750 at 150.
    const sent = await create({ accountId: euros.id, amount: "-10000", transferAccountId: yen.id });
    expect(sent).toMatchObject({ baseAmount: "-12500", fxRate: "1.25" });
    expect(await only(yen.id)).toMatchObject({
      amount: "18750",
      currency: "JPY",
      baseAmount: "12500",
      fxRate: "0.006666666667",
    });
  });

  it("keeps the other side's amount when either side's amount is edited", async () => {
    const { create, update, only, checking, euros } = await setup();
    const sent = await create({
      accountId: checking.id,
      amount: "-10000",
      transferAccountId: euros.id,
      transferAmount: "8500",
    });
    await update(sent.id, { amount: "-20000" });
    const received = await only(euros.id);
    expect(received).toMatchObject({
      amount: "8500",
      baseAmount: "20000",
      fxRate: "2.352941176471",
    });
    // From the euro side: the dollar side keeps its amount, which stays the base amount.
    await update(received.id, { amount: "9000" });
    expect(await only(euros.id)).toMatchObject({
      amount: "9000",
      baseAmount: "20000",
      fxRate: "2.222222222222",
    });
    expect(await only(checking.id)).toMatchObject({ amount: "-20000", baseAmount: "-20000" });
    // A given amount wins; null goes back to the date's rate ($200.00 at 0.8 is €160.00).
    await update(sent.id, { transferAmount: "10000" });
    expect((await only(euros.id)).amount).toBe("10000");
    await update(sent.id, { transferAmount: null });
    expect(await only(euros.id)).toMatchObject({ amount: "16000", fxRate: "1.25" });
    // Turning it around (an inflow) can't keep an amount going the same way: it's converted.
    await update(sent.id, { amount: "5000" });
    expect((await only(euros.id)).amount).toBe("-4000");
  });

  it("refuses a transfer amount going the same way as the amount", async () => {
    const { create, checking, euros } = await setup();
    await create(
      {
        accountId: checking.id,
        amount: "-10000",
        transferAccountId: euros.id,
        transferAmount: "-1",
      },
      400,
    );
  });

  it("deletes both sides from either side", async () => {
    const { create, remove, rows, only, checking, euros } = await setup();
    const first = await create({
      accountId: checking.id,
      amount: "-10000",
      transferAccountId: euros.id,
    });
    await remove(first.id);
    expect(await rows(euros.id)).toHaveLength(0);
    await create({ accountId: checking.id, amount: "-10000", transferAccountId: euros.id });
    await remove((await only(euros.id)).id);
    expect(await rows(checking.id)).toHaveLength(0);
  });

  it("transfers a split's line to another currency", async () => {
    const { addAccount, create, update, only, checking, euros, groceries } = await setup();
    const split = await create({
      accountId: checking.id,
      amount: "-15000",
      subtransactions: [
        { amount: "-10000", transferAccountId: euros.id },
        { amount: "-5000", categoryId: groceries.id },
      ],
    });
    expect(split.subtransactions[0]?.transferSide).toMatchObject({
      amount: "8000",
      currency: "EUR",
    });
    expect(await only(euros.id)).toMatchObject({
      amount: "8000",
      baseAmount: "10000",
      fxRate: "1.25",
    });
    // A given amount for the line, kept when the split is saved again.
    const lines = split.subtransactions.map((l, i) => ({
      id: l.id,
      amount: l.amount,
      ...(i === 0 ? { transferAccountId: euros.id, transferAmount: "9000" } : {}),
      categoryId: i === 0 ? null : groceries.id,
    }));
    await update(split.id, { subtransactions: lines });
    expect(await only(euros.id)).toMatchObject({ amount: "9000", baseAmount: "10000" });
    const [line, rest] = lines;
    await update(split.id, {
      memo: "x",
      subtransactions: [{ ...line, transferAmount: undefined }, rest],
    });
    expect((await only(euros.id)).amount).toBe("9000");

    // A euro split's line to the dollar account: the split's rate sets its amount.
    const other = await addAccount({ name: "Other", type: "checking" });
    await create({
      accountId: euros.id,
      amount: "-4000",
      subtransactions: [
        { amount: "-1000", transferAccountId: other.id },
        { amount: "-3000", categoryId: groceries.id },
      ],
    });
    expect(await only(other.id)).toMatchObject({ amount: "1250", baseAmount: "1250" });
  });

  it("counts a transfer's fee in its category, in the sending account's currency", async () => {
    const { create, month, rows, checking, euros, groceries } = await setup();
    const sent = await create({
      accountId: checking.id,
      amount: "-10000",
      transferAccountId: euros.id,
      fee: { amount: "300", categoryId: groceries.id },
    });
    expect(sent.feeTransactionId).toEqual(expect.any(String));
    const fees = (await rows(checking.id)).filter((t) => t.id === sent.feeTransactionId);
    expect(fees[0]).toMatchObject({
      amount: "-300",
      payeeName: "Transfer fee",
      memo: "Transfer fee",
      categoryId: groceries.id,
    });
    // An inflow's fee is the sending (euro) side's: €2.00 at 1.25.
    await create({
      accountId: checking.id,
      amount: "5000",
      transferAccountId: euros.id,
      fee: { amount: "200", categoryId: groceries.id },
    });
    expect((await rows(euros.id)).find((t) => t.memo === "Transfer fee")).toMatchObject({
      amount: "-200",
      baseAmount: "-250",
    });
    expect((await month()).of(groceries.id)?.activity).toBe("-550");
  });

  it("counts an on- to off-budget transfer at the budget side's base amount", async () => {
    const { addAccount, create, month, checking, euros, groceries } = await setup();
    const house = await addAccount({ name: "House", type: "asset", currency: "EUR" });
    await create({
      accountId: checking.id,
      amount: "-10000",
      transferAccountId: house.id,
      transferAmount: "9000",
      categoryId: groceries.id,
    });
    const dollarsHouse = await addAccount({ name: "Cabin", type: "asset" });
    // €40.00 from the euro savings at 1.25: $50.00 in the plan.
    await create({
      accountId: euros.id,
      amount: "-4000",
      transferAccountId: dollarsHouse.id,
      categoryId: groceries.id,
    });
    expect((await month()).of(groceries.id)?.activity).toBe("-15000");
  });

  it("leaves Ready to Assign as it was after an on-budget transfer between currencies", async () => {
    const { create, month, checking, euros } = await setup();
    const before = (await month()).readyToAssign;
    await create({
      accountId: checking.id,
      amount: "-10000",
      transferAccountId: euros.id,
      transferAmount: "7777",
    });
    expect((await month()).readyToAssign).toBe(before);
  });
});
