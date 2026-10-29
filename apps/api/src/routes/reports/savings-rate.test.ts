import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  shareBudget,
  signUp,
} from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

const TODAY = "2026-11-10";

type Figures = {
  income: string;
  incomeFromTracking: string;
  netIncome: string;
  savedViaCategories: string;
  movedToTracking: string;
  saved: string;
  rate: number | null;
  plainRate: number | null;
};
type SavingsRate = {
  currency: string;
  firstMonth: string | null;
  goal: number | null;
  months: (Figures & {
    month: string;
    rollingRate: number | null;
    rollingPlainRate: number | null;
  })[];
  total: Figures;
  categories: {
    categoryId: string;
    name: string;
    countsAsSaving: boolean;
    suggested: boolean;
    spent: string;
  }[];
};
type Group = { id: string; kind: string | null; categories: { id: string; name: string }[] };

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

/**
 * September: $5,000 of income; groceries; $500 to the Brokerage (a tracking asset) in Investments,
 * which counts as saving; $300 to the Brokerage in "Brokerage Moves", which doesn't; a split with
 * an Investments line, a groceries line and a transfer line to the Brokerage; a refund into
 * Investments; an uncategorized transfer to the Brokerage; payments to a mortgage and a liability
 * (not saving). October: $200 brought back from the Brokerage into Ready to Assign, and groceries.
 */
async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const account = async (body: Record<string, unknown>) => {
    const res = await send("POST", `${base}/accounts`, cookie, {
      balance: "0",
      date: "2026-08-20",
      ...body,
    });
    expect(res.status).toBe(201);
    return (await json<{ id: string }>(res)).id;
  };
  const checking = await account({ name: "Checking", type: "checking" });
  const brokerage = await account({ name: "Brokerage", type: "asset" });
  const owed = await account({ name: "Owed to Sam", type: "liability" });
  const mortgage = await account({
    name: "Mortgage",
    type: "mortgage",
    balance: "-10000000",
    interestRate: "5",
    minimumPayment: "50000",
  });
  const { groups, readyToAssignCategoryId } = await json<{
    groups: Group[];
    readyToAssignCategoryId: string;
  }>(await send("GET", `${base}/categories`, cookie));
  const group = groups.find((g) => !g.kind);
  if (!group) throw new Error("starter data missing");
  const category = async (name: string) => {
    const res = await send("POST", `${base}/categories`, cookie, { groupId: group.id, name });
    expect(res.status).toBe(201);
    return (await json<{ id: string }>(res)).id;
  };
  const investments = await category("Investments");
  const moves = await category("Brokerage Moves");
  const groceries = await category("Food");
  const housing = await category("Housing");
  expect(
    (
      await send("PUT", `${base}/reports/savings-rate/categories/${investments}`, cookie, {
        countsAsSaving: true,
      })
    ).status,
  ).toBe(200);

  const add = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
      accountId: checking,
      categoryId: null,
      ...input,
    });
    expect(res.status).toBe(201);
  };
  await add({
    date: "2026-09-01",
    amount: "500000",
    categoryId: readyToAssignCategoryId,
    payeeName: "Employer",
  });
  await add({ date: "2026-09-05", amount: "-100000", categoryId: groceries });
  await add({
    date: "2026-09-10",
    amount: "-50000",
    transferAccountId: brokerage,
    categoryId: investments,
  });
  await add({
    date: "2026-09-11",
    amount: "-30000",
    transferAccountId: brokerage,
    categoryId: moves,
  });
  await add({
    date: "2026-09-12",
    amount: "-40000",
    transferAccountId: mortgage,
    categoryId: housing,
  });
  await add({ date: "2026-09-13", amount: "-10000", transferAccountId: owed, categoryId: housing });
  await add({
    date: "2026-09-14",
    amount: "-27000",
    payeeName: "Market",
    subtransactions: [
      { amount: "-15000", categoryId: investments, payeeName: "Vanguard" },
      { amount: "-5000", categoryId: groceries },
      { amount: "-7000", categoryId: moves, transferAccountId: brokerage },
    ],
  });
  await add({ date: "2026-09-15", amount: "5000", categoryId: investments, payeeName: "Vanguard" });
  await add({ date: "2026-09-16", amount: "-10000", transferAccountId: brokerage });
  await add({
    date: "2026-10-03",
    amount: "20000",
    transferAccountId: brokerage,
    categoryId: readyToAssignCategoryId,
  });
  await add({ date: "2026-10-05", amount: "-30000", categoryId: groceries });

  const report = async (query: Record<string, string>) => {
    const res = await send(
      "GET",
      `${base}/reports/savings-rate?${new URLSearchParams({ today: TODAY, ...query })}`,
      cookie,
    );
    expect(res.status).toBe(200);
    return json<SavingsRate>(res);
  };
  return { cookie, base, budgetId: budget.id, report, investments, moves, groceries, housing };
}

describe("GET /v1/budgets/:id/reports/savings-rate", () => {
  it("puts each spending line in one bucket, so nothing counts twice", async () => {
    const t = await setup();
    const r = await t.report({ from: "2026-09", to: "2026-11" });
    expect(r.currency).toBe("USD");
    expect(r.firstMonth).toBe("2026-08");
    const [sep, oct, nov] = r.months;
    // Spending: 100,000 + 50,000 + 30,000 + 40,000 + 10,000 + 27,000 − 5,000 + 10,000 = 262,000.
    // Investments: 50,000 + 15,000 − 5,000 refund = 60,000, once, though 50,000 of it went to
    // the Brokerage. Moved: 30,000 + the split's 7,000 + the uncategorized 10,000. The mortgage
    // and the liability aren't saving.
    expect(sep).toEqual({
      month: "2026-09",
      income: "500000",
      incomeFromTracking: "0",
      netIncome: "238000",
      savedViaCategories: "60000",
      movedToTracking: "47000",
      saved: "345000",
      rate: 69,
      plainRate: 47.6,
      rollingRate: 69,
      rollingPlainRate: 47.6,
    });
    // The 20,000 brought back is Income v Expense's income, but not the saving rate's: it lowers
    // what was moved, and with no other income the month has no saving rate (a gap).
    expect(oct).toMatchObject({
      income: "20000",
      incomeFromTracking: "20000",
      netIncome: "-10000",
      savedViaCategories: "0",
      movedToTracking: "-20000",
      saved: "-30000",
      rate: null,
      plainRate: -50,
      rollingRate: 63,
      rollingPlainRate: 43.85,
    });
    expect(nov).toMatchObject({ income: "0", saved: "0", rate: null, plainRate: null });
    expect(r.total).toEqual({
      income: "520000",
      incomeFromTracking: "20000",
      netIncome: "228000",
      savedViaCategories: "60000",
      movedToTracking: "27000",
      saved: "315000",
      rate: 63,
      plainRate: 43.85,
    });
  });

  it("agrees with Income v Expense's sums", async () => {
    const t = await setup();
    const r = await t.report({ from: "2026-09", to: "2026-10" });
    const activity = async (kind: string) => {
      const res = await send(
        "GET",
        `${t.base}/reports/activity?from=2026-09&to=2026-10&kind=${kind}&today=${TODAY}`,
        t.cookie,
      );
      const { rows } = await json<{ rows: { net: string }[] }>(res);
      return rows.reduce((s, row) => s + BigInt(row.net), 0n);
    };
    const income = await activity("income");
    const spending = await activity("spending");
    expect(BigInt(r.total.income)).toBe(income);
    expect(BigInt(r.total.netIncome)).toBe(income + spending);
    const { netIncome, savedViaCategories, movedToTracking, saved } = r.total;
    expect(BigInt(netIncome) + BigInt(savedViaCategories) + BigInt(movedToTracking)).toBe(
      BigInt(saved),
    );
  });

  it("rolls 12 months back from the range, but not before the first transaction", async () => {
    const t = await setup();
    const r = await t.report({ from: "2026-10", to: "2026-10" });
    // August to October: the months before the first transaction add nothing.
    expect(r.months).toHaveLength(1);
    expect(r.months[0]?.rollingRate).toBe(63);
    const later = await t.report({ from: "2027-09", to: "2027-10", today: "2027-10-31" });
    // September 2027's window (October 2026 on) leaves September 2026 out.
    expect(later.months[0]).toMatchObject({ rate: null, rollingRate: null, rollingPlainRate: -50 });
    expect(later.months[1]).toMatchObject({ rollingRate: null, rollingPlainRate: null });
  });

  it("suggests categories whose outflows mostly went to tracking accounts", async () => {
    const t = await setup();
    const r = await t.report({ from: "2026-09", to: "2026-09" });
    const byId = new Map(r.categories.map((c) => [c.categoryId, c]));
    expect(byId.get(t.investments)).toMatchObject({
      countsAsSaving: true,
      suggested: false,
      spent: "-60000",
    });
    expect(byId.get(t.moves)).toMatchObject({
      countsAsSaving: false,
      suggested: true,
      spent: "-37000",
    });
    expect(byId.get(t.groceries)).toMatchObject({ suggested: false });
    // Housing went to a mortgage and a liability: debts, not saving.
    expect(byId.get(t.housing)).toMatchObject({ suggested: false, spent: "-50000" });
    // Marking it moves its transfers from "moved" to "via categories", with the same total.
    await send("PUT", `${t.base}/reports/savings-rate/categories/${t.moves}`, t.cookie, {
      countsAsSaving: true,
    });
    const marked = await t.report({ from: "2026-09", to: "2026-09" });
    expect(marked.total).toMatchObject({
      savedViaCategories: "97000",
      movedToTracking: "10000",
      saved: "345000",
    });
  });

  it("returns the budget's goal", async () => {
    const t = await setup();
    expect((await t.report({ from: "2026-09", to: "2026-09" })).goal).toBeNull();
    const res = await send("PATCH", `/v1/budgets/${t.budgetId}`, t.cookie, {
      savingsRateGoal: 2500,
    });
    expect(res.status).toBe(200);
    expect((await json<{ savingsRateGoal: number }>(res)).savingsRateGoal).toBe(2500);
    expect((await t.report({ from: "2026-09", to: "2026-09" })).goal).toBe(2500);
    const bad = await send("PATCH", `/v1/budgets/${t.budgetId}`, t.cookie, {
      savingsRateGoal: 10001,
    });
    expect(bad.status).toBe(400);
    await send("PATCH", `/v1/budgets/${t.budgetId}`, t.cookie, { savingsRateGoal: null });
    expect((await t.report({ from: "2026-09", to: "2026-09" })).goal).toBeNull();
  });

  it("refuses bad ranges", async () => {
    const t = await setup();
    const status = async (query: string) =>
      (await send("GET", `${t.base}/reports/savings-rate?${query}`, t.cookie)).status;
    expect(await status("from=2026-10&to=2026-09")).toBe(400);
    expect(await status("from=0000-12&to=2026-09")).toBe(400);
    expect(await status("from=1926-09&to=2026-09")).toBe(400);
    expect(await status("from=1926-10&to=2026-09")).toBe(200);
  });
});

describe("PUT /v1/budgets/:id/reports/savings-rate/categories/:categoryId", () => {
  it("is for editors, and not for internal or card payment categories", async () => {
    const t = await setup();
    const viewer = await shareBudget(app, t.cookie, t.budgetId, { role: "viewer" });
    const path = `${t.base}/reports/savings-rate/categories/${t.groceries}`;
    expect((await send("PUT", path, viewer.cookie, { countsAsSaving: true })).status).toBe(403);
    expect(
      (await send("PATCH", `/v1/budgets/${t.budgetId}`, viewer.cookie, { savingsRateGoal: 1000 }))
        .status,
    ).toBe(403);
    const editor = await shareBudget(app, t.cookie, t.budgetId, { name: "Ed", role: "editor" });
    const res = await send("PUT", path, editor.cookie, { countsAsSaving: true });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ categoryId: t.groceries, countsAsSaving: true });

    const stranger = await signUp(app);
    expect((await send("PUT", path, stranger.cookie, { countsAsSaving: true })).status).toBe(404);
    expect(
      (await send("GET", `${t.base}/reports/savings-rate?from=2026-09&to=2026-09`, stranger.cookie))
        .status,
    ).toBe(404);

    const { readyToAssignCategoryId } = await json<{ readyToAssignCategoryId: string }>(
      await send("GET", `${t.base}/categories`, t.cookie),
    );
    const internal = `${t.base}/reports/savings-rate/categories/${readyToAssignCategoryId}`;
    expect((await send("PUT", internal, t.cookie, { countsAsSaving: true })).status).toBe(400);
    await send("POST", `${t.base}/accounts`, t.cookie, {
      name: "Visa",
      type: "credit_card",
      balance: "0",
      date: "2026-08-20",
    });
    const { groups } = await json<{ groups: Group[] }>(
      await send("GET", `${t.base}/categories`, t.cookie),
    );
    const payment = groups.find((g) => g.kind)?.categories[0];
    if (!payment) throw new Error("no card payment category");
    expect(
      (
        await send("PUT", `${t.base}/reports/savings-rate/categories/${payment.id}`, t.cookie, {
          countsAsSaving: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send("PUT", `${t.base}/reports/savings-rate/categories/nope`, t.cookie, {
          countsAsSaving: true,
        })
      ).status,
    ).toBe(404);
  });
});
