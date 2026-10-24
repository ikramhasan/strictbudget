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

type Card = {
  accountId: string;
  name: string;
  type: string;
  categoryId: string;
  balance: string;
  available: string;
  status: string;
  covered: string;
  gap: string;
  fromCreditOverspending: string;
  other: string;
  cover: string;
  series: {
    month: string;
    spending: string;
    payments: string;
    balance: string;
    available: string;
  }[];
};
type Health = {
  month: string;
  firstMonth: string;
  readyToAssign: string;
  totals: { balance: string; covered: string; unfunded: string };
  float: { month: string; carried: string }[];
  cards: Card[];
};
type Plan = {
  readyToAssign: string;
  categories: {
    categoryId: string;
    available: string;
    payment: { balance: string; underfunded: string; overspentCategories: string } | null;
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

/** Checking with $5,000, three cards, and two spending categories with money from October. */
async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const account = async (name: string, type: string, balance = "0") =>
    (
      await json<{ id: string }>(
        await send("POST", `${base}/accounts`, cookie, {
          name,
          type,
          balance,
          date: "2026-10-01",
        }),
      )
    ).id;
  const checking = await account("Checking", "checking", "500000");
  const visa = await account("Visa", "credit_card");
  const amex = await account("Amex", "credit_card");
  const { groups } = await json<{ groups: Group[] }>(
    await send("GET", `${base}/categories`, cookie),
  );
  const group = groups.find((g) => !g.kind);
  if (!group) throw new Error("starter data missing");
  const category = async (name: string) => {
    const res = await send("POST", `${base}/categories`, cookie, { groupId: group.id, name });
    expect(res.status).toBe(201);
    return (await json<{ id: string }>(res)).id;
  };
  const groceries = await category("Health Groceries");
  const fun = await category("Health Fun");
  const assign = async (categoryId: string, month: string, assigned: string) =>
    expect(
      (
        await send("PUT", `${base}/months/${month}/categories/${categoryId}`, cookie, {
          assigned,
          today: TODAY,
        })
      ).status,
    ).toBe(200);
  const post = async (accountId: string, date: string, amount: string, categoryId?: string) =>
    expect(
      (
        await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
          accountId,
          date,
          amount,
          categoryId,
        })
      ).status,
    ).toBe(201);
  const health = async (query = "") =>
    json<Health>(
      await send(
        "GET",
        `${base}/reports/credit-card-health?today=${TODAY}${query ? `&${query}` : ""}`,
        cookie,
      ),
    );
  const plan = async (month: string) =>
    json<Plan>(await send("GET", `${base}/months/${month}?today=${TODAY}`, cookie));
  return { cookie, base, checking, visa, amex, groceries, fun, assign, post, health, plan };
}

describe("GET /reports/credit-card-health", () => {
  it("is covered when the payment category has set aside the whole balance", async () => {
    const t = await setup();
    await t.assign(t.groceries, "2026-10", "30000");
    await t.post(t.visa, "2026-10-05", "-10000", t.groceries);

    const report = await t.health("month=2026-10");
    const visa = report.cards.find((c) => c.accountId === t.visa);
    expect(visa).toMatchObject({
      name: "Visa",
      type: "credit_card",
      balance: "10000",
      available: "10000",
      status: "covered",
      covered: "10000",
      gap: "0",
      cover: "0",
    });
    expect(report.cards.find((c) => c.accountId === t.amex)).toMatchObject({
      balance: "0",
      status: "covered",
    });
    expect(report.totals).toEqual({ balance: "10000", covered: "10000", unfunded: "0" });
  });

  it("is partly covered after credit overspending, and offers to cover it from Ready to Assign", async () => {
    const t = await setup();
    await t.assign(t.groceries, "2026-10", "6000");
    // $100 on the card against $60 in the category: $60 funded, $40 credit overspending.
    await t.post(t.visa, "2026-10-05", "-10000", t.groceries);

    const report = await t.health("month=2026-10");
    const visa = report.cards.find((c) => c.accountId === t.visa) as Card;
    expect(visa).toMatchObject({
      balance: "10000",
      available: "6000",
      status: "partial",
      covered: "6000",
      gap: "4000",
      fromCreditOverspending: "4000",
      other: "0",
    });
    expect(BigInt(report.readyToAssign)).toBeGreaterThan(4000n);
    expect(visa.cover).toBe("4000");
    expect(report.totals.unfunded).toBe("4000");
  });

  it("is unfunded when none of a card's balance is set aside, and starting debt isn't credit overspending", async () => {
    const t = await setup();
    // A card opened owing $200: the debt has no category behind it.
    const { cookie, base } = t;
    const debt = (
      await json<{ id: string }>(
        await send("POST", `${base}/accounts`, cookie, {
          name: "Old Card",
          type: "credit_card",
          balance: "-20000",
          date: "2026-10-01",
        }),
      )
    ).id;

    const report = await t.health("month=2026-10");
    const card = report.cards.find((c) => c.accountId === debt) as Card;
    expect(card).toMatchObject({
      balance: "20000",
      status: "unfunded",
      covered: "0",
      gap: "20000",
      fromCreditOverspending: "0",
      other: "20000",
    });
  });

  it("matches the plan screen's payment category numbers", async () => {
    const t = await setup();
    await t.assign(t.groceries, "2026-10", "6000");
    await t.assign(t.fun, "2026-10", "2000");
    await t.post(t.visa, "2026-10-05", "-10000", t.groceries);
    await t.post(t.amex, "2026-10-07", "-5000", t.fun);
    await t.post(t.visa, "2026-10-08", "1500", t.groceries);
    await t.post(t.checking, "2026-10-09", "-1000", t.fun);

    const report = await t.health("month=2026-10");
    const plan = await t.plan("2026-10");
    for (const card of report.cards) {
      const line = plan.categories.find((c) => c.categoryId === card.categoryId);
      expect(line?.payment).toBeTruthy();
      expect(card.available).toBe(line?.available);
      expect(card.gap).toBe(line?.payment?.underfunded);
      expect(card.balance).toBe((-BigInt(line?.payment?.balance ?? "0")).toString());
    }
    expect(report.readyToAssign).toBe(plan.readyToAssign);
  });

  it("lists each month's spending, payments and balance, from the month the card opened", async () => {
    const t = await setup();
    await t.assign(t.groceries, "2026-10", "30000");
    await t.assign(t.groceries, "2026-11", "0");
    await t.post(t.visa, "2026-10-05", "-10000", t.groceries);
    await t.post(t.visa, "2026-11-02", "-4000", t.groceries);
    await t.post(t.visa, "2026-11-03", "2500", t.groceries);

    const report = await t.health("months=3");
    const visa = report.cards.find((c) => c.accountId === t.visa) as Card;
    const october = visa.series.find((s) => s.month === "2026-10");
    const november = visa.series.find((s) => s.month === "2026-11");
    expect(october).toMatchObject({ spending: "10000", payments: "0", balance: "10000" });
    expect(november).toMatchObject({ spending: "4000", payments: "2500", balance: "11500" });
    expect(visa.series.map((s) => s.month)).toEqual([...visa.series.map((s) => s.month)].sort());
    expect(report.float.map((f) => f.month)).toEqual(
      expect.arrayContaining(["2026-10", "2026-11"]),
    );
    expect(report.month).toBe("2026-11");
  });

  it("tracks what the cards lacked at each month's end as the float", async () => {
    const t = await setup();
    await t.assign(t.groceries, "2026-10", "6000");
    await t.post(t.visa, "2026-10-05", "-10000", t.groceries);
    const report = await t.health("months=2");
    const visa = report.cards.find((c) => c.accountId === t.visa) as Card;
    const october = report.float.find((f) => f.month === "2026-10");
    expect(october?.carried).toBe("4000");
    const afterCover = await send(
      "PUT",
      `${t.base}/months/2026-11/categories/${visa.categoryId}`,
      t.cookie,
      { assigned: visa.cover, today: TODAY },
    );
    expect(afterCover.status).toBe(200);
    const next = await t.health("months=2");
    expect(next.float.find((f) => f.month === "2026-11")?.carried).toBe("0");
    expect(next.cards.find((c) => c.accountId === t.visa)?.status).toBe("covered");
  });

  it("leaves out closed cards and checking accounts, and refuses a future month", async () => {
    const t = await setup();
    const closed = await send("POST", `${t.base}/accounts`, t.cookie, {
      name: "Gone",
      type: "credit_card",
      balance: "0",
      date: "2026-10-01",
    });
    const { id } = await json<{ id: string }>(closed);
    expect(
      (await send("POST", `${t.base}/accounts/${id}/close`, t.cookie, { date: TODAY })).status,
    ).toBe(200);

    const report = await t.health();
    expect(report.cards.map((c) => c.name).sort()).toEqual(["Amex", "Visa"]);
    const future = await send(
      "GET",
      `${t.base}/reports/credit-card-health?today=${TODAY}&month=2027-03`,
      t.cookie,
    );
    expect(future.status).toBe(400);
  });

  it("shares Ready to Assign out across the cards, so covering every card stays within it", async () => {
    const t = await setup();
    await t.assign(t.groceries, "2026-10", "10000");
    await t.assign(t.fun, "2026-10", "10000");
    // Each card is $100 short.
    await t.post(t.visa, "2026-10-05", "-20000", t.groceries);
    await t.post(t.amex, "2026-10-06", "-20000", t.fun);
    const before = await t.health("month=2026-10");
    const rta = BigInt(before.readyToAssign);
    // Leave $150 in Ready to Assign: move the rest into a category.
    await t.assign(t.groceries, "2026-10", (10000n + rta - 15000n).toString());
    const report = await t.health("month=2026-10");
    expect(report.readyToAssign).toBe("15000");
    const covers = report.cards.filter((c) => BigInt(c.gap) > 0n).map((c) => BigInt(c.cover));
    expect(covers.reduce((a, b) => a + b, 0n)).toBeLessThanOrEqual(15000n);
    expect(covers.filter((c) => c > 0n).length).toBeGreaterThan(0);
  });

  it("refuses a month before the plan's first", async () => {
    const t = await setup();
    const report = await t.health();
    expect(report.firstMonth <= "2026-10").toBe(true);
    const res = await send(
      "GET",
      `${t.base}/reports/credit-card-health?today=${TODAY}&month=2020-01`,
      t.cookie,
    );
    expect(res.status).toBe(400);
  });

  it("is for budget members only", async () => {
    const t = await setup();
    const other = await signUp(app);
    const res = await send("GET", `${t.base}/reports/credit-card-health`, other.cookie);
    expect(res.status).toBe(404);
    const viewer = await shareBudget(app, t.cookie, t.base.split("/").pop() as string, {
      role: "viewer",
    });
    const ok = await send("GET", `${t.base}/reports/credit-card-health`, viewer.cookie);
    expect(ok.status).toBe(200);
  });
});
