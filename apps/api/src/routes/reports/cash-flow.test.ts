import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

const TODAY = "2026-11-10";

type Source = { payeeId: string | null; name: string; amount: string };
type Category = { categoryId: string; name: string; amount: string };
type CashFlow = {
  currency: string;
  income: string;
  spending: string;
  sources: Source[];
  paidBack: Source[];
  refunds: (Category & { groupId: string | null })[];
  groups: { groupId: string | null; name: string; amount: string; categories: Category[] }[];
  saved: string;
  fromSavings: string;
};
type Group = {
  id: string;
  name: string;
  kind: string | null;
  categories: { id: string; name: string }[];
};

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;
const sum = (rows: readonly { amount: string }[]) =>
  rows.reduce((s, r) => s + BigInt(r.amount), 0n);

/** Each node's inflows equal its outflows, in minor units. */
function expectBalanced(f: CashFlow) {
  const incomeIn = sum(f.sources) + sum(f.refunds) + BigInt(f.fromSavings);
  const incomeOut = sum(f.groups) + sum(f.paidBack) + BigInt(f.saved);
  expect(incomeIn).toBe(incomeOut);
  for (const g of f.groups) expect(sum(g.categories)).toBe(BigInt(g.amount));
  expect(sum(f.sources) - sum(f.paidBack)).toBe(BigInt(f.income));
  expect(sum(f.refunds) - sum(f.groups)).toBe(BigInt(f.spending));
  expect(BigInt(f.saved) - BigInt(f.fromSavings)).toBe(BigInt(f.income) + BigInt(f.spending));
  expect(BigInt(f.saved) === 0n || BigInt(f.fromSavings) === 0n).toBe(true);
}

/**
 * September: wages, income without a payee, a bonus paid back, interest into Savings; rent on the
 * Visa, groceries, a split across groceries and the phone, a phone refund bigger than its
 * spending, and an uncategorized transfer to a tracking account. October: groceries only.
 */
async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const account = async (name: string, type: string) =>
    (
      await json<{ id: string }>(
        await send("POST", `${base}/accounts`, cookie, {
          name,
          type,
          balance: "0",
          date: "2026-08-20",
        }),
      )
    ).id;
  const checking = await account("Checking", "checking");
  const savings = await account("Savings", "savings");
  const visa = await account("Visa", "credit_card");
  const house = await account("House", "asset");
  const { groups, readyToAssignCategoryId: rta } = await json<{
    groups: Group[];
    readyToAssignCategoryId: string;
  }>(await send("GET", `${base}/categories`, cookie));
  const [bills, needs] = groups.filter((g) => !g.kind);
  const [rent, phone] = bills?.categories ?? [];
  const [groceries] = needs?.categories ?? [];
  if (!bills || !needs || !rent || !phone || !groceries) throw new Error("starter data missing");

  const add = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
      accountId: checking,
      categoryId: null,
      ...input,
    });
    expect(res.status).toBe(201);
  };
  await add({ date: "2026-09-01", amount: "300000", categoryId: rta, payeeName: "Employer" });
  await add({ date: "2026-09-02", amount: "20000", categoryId: rta });
  await add({ date: "2026-09-03", amount: "-5000", categoryId: rta, payeeName: "Bonus clawback" });
  await add({
    date: "2026-09-04",
    amount: "1000",
    categoryId: rta,
    payeeName: "Bank",
    accountId: savings,
  });
  await add({ date: "2026-09-05", amount: "-150000", categoryId: rent.id, accountId: visa });
  await add({ date: "2026-09-06", amount: "-40000", categoryId: groceries.id });
  await add({
    date: "2026-09-07",
    amount: "-30000",
    payeeName: "Market",
    subtransactions: [
      { amount: "-10000", categoryId: groceries.id },
      { amount: "-20000", categoryId: phone.id, payeeName: "Telco" },
    ],
  });
  await add({ date: "2026-09-08", amount: "25000", categoryId: phone.id, payeeName: "Telco" });
  await add({ date: "2026-09-09", amount: "-50000", transferAccountId: house });
  await add({ date: "2026-10-05", amount: "-20000", categoryId: groceries.id });

  const flow = async (query: Record<string, string>) => {
    const res = await send(
      "GET",
      `${base}/reports/cash-flow?${new URLSearchParams({ today: TODAY, ...query })}`,
      cookie,
    );
    expect(res.status).toBe(200);
    return json<CashFlow>(res);
  };
  const activityTotal = async (query: Record<string, string>) => {
    const res = await send(
      "GET",
      `${base}/reports/activity?${new URLSearchParams({ today: TODAY, ...query })}`,
      cookie,
    );
    const { rows } = await json<{ rows: { net: string }[] }>(res);
    return rows.reduce((s, r) => s + BigInt(r.net), 0n);
  };
  return { cookie, base, flow, activityTotal, checking, bills, needs, rent, phone, groceries };
}

describe("GET /v1/budgets/:id/reports/cash-flow", () => {
  it("balances every node exactly and matches Income v Expense", async () => {
    const t = await setup();
    const f = await t.flow({ from: "2026-09", to: "2026-09" });
    expectBalanced(f);
    expect(f.currency).toBe("USD");
    expect(f.income).toBe("316000");
    expect(f.spending).toBe("-245000");
    expect(BigInt(f.income)).toBe(
      await t.activityTotal({ from: "2026-09", to: "2026-09", kind: "income" }),
    );
    expect(BigInt(f.spending)).toBe(
      await t.activityTotal({ from: "2026-09", to: "2026-09", kind: "spending" }),
    );
    expect(f.sources.map((s) => [s.name, s.amount])).toEqual([
      ["Employer", "300000"],
      ["[No Payee]", "20000"],
      ["Bank", "1000"],
    ]);
    expect(f.paidBack).toMatchObject([{ name: "Bonus clawback", amount: "5000" }]);
    // The phone got back 25,000 against the split's 20,000: a refund into Income.
    expect(f.refunds).toEqual([
      { categoryId: t.phone.id, name: t.phone.name, amount: "5000", groupId: t.bills.id },
    ]);
    // Uncategorized (the transfer to the House) first, then the plan's groups; the split's lines
    // count one by one.
    expect(f.groups).toEqual([
      {
        groupId: null,
        name: "Uncategorized",
        amount: "50000",
        categories: [expect.objectContaining({ amount: "50000" })],
      },
      {
        groupId: t.bills.id,
        name: t.bills.name,
        amount: "150000",
        categories: [{ categoryId: t.rent.id, name: t.rent.name, amount: "150000" }],
      },
      {
        groupId: t.needs.id,
        name: t.needs.name,
        amount: "50000",
        categories: [{ categoryId: t.groceries.id, name: t.groceries.name, amount: "50000" }],
      },
    ]);
    expect(f.saved).toBe("71000");
    expect(f.fromSavings).toBe("0");
  });

  it("brings a shortfall in from savings", async () => {
    const t = await setup();
    const f = await t.flow({ from: "2026-10", to: "2026-10" });
    expectBalanced(f);
    expect(f).toMatchObject({ income: "0", spending: "-20000", saved: "0", fromSavings: "20000" });
    expect(f.sources).toEqual([]);
    const both = await t.flow({ from: "2026-09", to: "2026-11" });
    expectBalanced(both);
    expect(both).toMatchObject({ saved: "51000", fromSavings: "0" });
  });

  it("filters by account", async () => {
    const t = await setup();
    const f = await t.flow({ from: "2026-09", to: "2026-09", accountIds: t.checking });
    expectBalanced(f);
    // No Visa rent, no interest into Savings.
    expect(f.income).toBe("315000");
    expect(f.groups.map((g) => g.name)).toEqual(["Uncategorized", t.needs.name]);
    expect(BigInt(f.spending)).toBe(
      await t.activityTotal({
        from: "2026-09",
        to: "2026-09",
        kind: "spending",
        accountIds: t.checking,
      }),
    );
  });

  it("is empty with nothing in the range, and refuses a reversed range", async () => {
    const t = await setup();
    const f = await t.flow({ from: "2027-01", to: "2027-02", today: "2027-02-10" });
    expect(f).toMatchObject({
      income: "0",
      spending: "0",
      saved: "0",
      fromSavings: "0",
      groups: [],
    });
    const res = await send("GET", `${t.base}/reports/cash-flow?from=2026-10&to=2026-09`, t.cookie);
    expect(res.status).toBe(400);
    const stranger = await signUp(app);
    expect(
      (await send("GET", `${t.base}/reports/cash-flow?from=2026-09&to=2026-09`, stranger.cookie))
        .status,
    ).toBe(404);
  });
});
