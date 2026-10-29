import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

const TODAY = "2026-10-20";
const FIGURES = ["assigned", "activity", "available", "cashOverspent", "creditOverspent"] as const;

type Figures = Record<(typeof FIGURES)[number], string>;
type Move = {
  categoryId: string;
  otherCategoryId: string | null;
  otherDeletedCategory: string | null;
  amount: string;
  userName: string | null;
};
type HistoryMonth = Figures & {
  month: string;
  targetAmount: string | null;
  targetMet: boolean | null;
  moves: Move[];
};
type History = {
  currency: string;
  firstMonth: string;
  name: string;
  hidden: boolean;
  months: HistoryMonth[];
  stats: {
    averageAssigned: string;
    averageSpent: string;
    monthsOverspent: number;
    targetMonths: number;
    targetMonthsMet: number;
  };
};
type PlanMonth = { categories: (Figures & { categoryId: string })[] };
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
async function ok<T>(res: Response | Promise<Response>) {
  const r = await res;
  expect(r.status, await r.clone().text()).toBeLessThan(300);
  return json<T>(r);
}

/**
 * Groceries carries money from August, ends September overspent on the card, and meets its target
 * in October after a move in from Dining Out (in the same group); Rent moves money to Dining Out
 * from another group; Phone ends September overspent in cash.
 */
async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const account = (input: Record<string, unknown>) =>
    ok<{ id: string }>(
      send("POST", `${base}/accounts`, cookie, { balance: "0", date: "2026-07-01", ...input }),
    );
  const checking = await account({ name: "Checking", type: "checking", balance: "500000" });
  const card = await account({ name: "Visa", type: "credit_card" });
  const list = await ok<{
    uncategorizedCategoryId: string;
    readyToAssignCategoryId: string;
    groups: Group[];
  }>(send("GET", `${base}/categories`, cookie));
  const [bills, needs] = list.groups.filter((g) => !g.kind);
  const [rent, phone] = bills?.categories ?? [];
  const [groceries, dining] = needs?.categories ?? [];
  if (!bills || !needs || !rent || !phone || !groceries || !dining) {
    throw new Error("starter data missing");
  }
  const paymentGroup = list.groups.find((g) => g.kind);
  const payment = paymentGroup?.categories[0];
  if (!paymentGroup || !payment) throw new Error("no card payment category");

  const assign = (categoryId: string, month: string, assigned: string) =>
    ok(send("PUT", `${base}/months/${month}/categories/${categoryId}`, cookie, { assigned }));
  const move = (month: string, fromCategoryId: string, toCategoryId: string, amount: string) =>
    ok(
      send("POST", `${base}/months/${month}/moves`, cookie, {
        fromCategoryId,
        toCategoryId,
        amount,
      }),
    );
  const spend = (input: {
    categoryId: string | null;
    date: string;
    amount: string;
    accountId?: string;
  }) =>
    ok(
      send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
        accountId: checking.id,
        cleared: "cleared",
        ...input,
      }),
    );
  await ok(
    send("PUT", `${base}/categories/${groceries.id}/target`, cookie, {
      cadence: "monthly",
      behavior: "set_aside",
      amount: "45000",
      dueDay: null,
      month: "2026-09",
      today: TODAY,
    }),
  );
  await assign(groceries.id, "2026-08", "40000");
  await spend({ categoryId: groceries.id, date: "2026-08-10", amount: "-30000" });
  await assign(groceries.id, "2026-09", "5000");
  await spend({ categoryId: groceries.id, date: "2026-09-03", amount: "-12000" });
  await spend({
    categoryId: groceries.id,
    date: "2026-09-04",
    amount: "-8000",
    accountId: card.id,
  });
  await spend({ categoryId: phone.id, date: "2026-09-12", amount: "-3000" });
  await assign(groceries.id, "2026-10", "40000");
  await assign(dining.id, "2026-10", "20000");
  await spend({ categoryId: dining.id, date: "2026-10-05", amount: "2500" });
  await move("2026-10", dining.id, groceries.id, "5000");
  await assign(rent.id, "2026-10", "100000");
  await move("2026-10", rent.id, dining.id, "1000");

  const history = (query: string, headers: Record<string, string> = { cookie }) =>
    app.request(`${base}/reports/category-history?today=${TODAY}&${query}`, { headers });
  const report = (query: string) => ok<History>(history(query));
  const plan = (month: string) =>
    ok<PlanMonth>(send("GET", `${base}/months/${month}?today=${TODAY}`, cookie));
  return {
    cookie,
    base,
    list,
    bills,
    needs,
    rent,
    phone,
    groceries,
    dining,
    payment,
    paymentGroup,
    history,
    report,
    plan,
  };
}

describe("GET /v1/budgets/:id/reports/category-history", () => {
  it("gives each month the plan's own Assigned, Activity and Available", async () => {
    const s = await setup();
    const months = ["2026-08", "2026-09", "2026-10"];
    for (const c of [s.groceries, s.dining, s.phone, s.rent]) {
      const report = await s.report(`categoryId=${c.id}&from=2026-08&to=2026-10`);
      expect(report.months.map((m) => m.month)).toEqual(months);
      for (const [i, month] of months.entries()) {
        const card = (await s.plan(month)).categories.find((p) => p.categoryId === c.id);
        if (!card) throw new Error(`${c.name} missing in ${month}`);
        for (const key of FIGURES) {
          expect(report.months[i]?.[key], `${c.name} ${month} ${key}`).toBe(card[key]);
        }
      }
    }

    const groceries = await s.report(`categoryId=${s.groceries.id}&from=2026-08&to=2026-10`);
    expect(groceries).toMatchObject({ currency: "USD", name: s.groceries.name, hidden: false });
    // $100 carried + $50 covers September's $120 cash; $50 of the card's $80 is credit overspending.
    expect(groceries.months[1]).toMatchObject({
      assigned: "5000",
      activity: "-20000",
      available: "-5000",
      cashOverspent: "0",
      creditOverspent: "-5000",
    });
    // The move in counts in October's Assigned, as on the plan.
    expect(groceries.months[2]?.assigned).toBe("45000");
    const phone = await s.report(`categoryId=${s.phone.id}&from=2026-09&to=2026-09`);
    expect(phone.months[0]?.cashOverspent).toBe("-3000");
  });

  it("gives what the target asked of each month and whether it was met", async () => {
    const s = await setup();
    const { months, stats } = await s.report(
      `categoryId=${s.groceries.id}&from=2026-08&to=2026-10`,
    );
    // No target before it starts; September's $50 of $450 falls short, October's $450 meets it.
    expect(months.map((m) => [m.targetAmount, m.targetMet])).toEqual([
      [null, null],
      ["45000", false],
      ["45000", true],
    ]);
    expect(stats).toEqual({
      // ($400 + $50 + $450) / 3 and ($300 + $200 + $0) / 3, rounded half up.
      averageAssigned: "30000",
      averageSpent: "16667",
      monthsOverspent: 1,
      targetMonths: 2,
      targetMonthsMet: 1,
    });
  });

  it("lists money moved in and out, but not assigning from Ready to Assign", async () => {
    const s = await setup();
    const dining = await s.report(`categoryId=${s.dining.id}&from=2026-10&to=2026-10`);
    // Newest first: Rent's move in came after the move out to Groceries.
    expect(dining.months[0]?.moves).toMatchObject([
      { categoryId: s.dining.id, otherCategoryId: s.rent.id, amount: "1000" },
      { categoryId: s.dining.id, otherCategoryId: s.groceries.id, amount: "-5000" },
    ]);
    expect(dining.months[0]?.moves[0]?.userName).toBeTruthy();
    const groceries = await s.report(`categoryId=${s.groceries.id}&from=2026-08&to=2026-10`);
    expect(groceries.months.map((m) => m.moves.map((v) => v.amount))).toEqual([[], [], ["5000"]]);

    // A deleted category's money moved here keeps its name.
    const extra = await ok<{ id: string }>(
      send("POST", `${s.base}/categories`, s.cookie, { groupId: s.bills.id, name: "Gym" }),
    );
    await ok(
      send("PUT", `${s.base}/months/2026-10/categories/${extra.id}`, s.cookie, { assigned: "700" }),
    );
    const deleted = await send(
      "DELETE",
      `${s.base}/categories/${extra.id}?reassignToCategoryId=${s.dining.id}`,
      s.cookie,
    );
    expect(deleted.status).toBe(204);
    const after = await s.report(`categoryId=${s.dining.id}&from=2026-10&to=2026-10`);
    expect(after.months[0]?.moves[0]).toMatchObject({
      otherCategoryId: null,
      otherDeletedCategory: "Gym",
      amount: "700",
    });
  });

  it("sums a group's categories, leaving out moves between them", async () => {
    const s = await setup();
    await ok(
      send("PUT", `${s.base}/months/2026-09/categories/${s.dining.id}`, s.cookie, {
        assigned: "10000",
      }),
    );
    const range = "from=2026-08&to=2026-10";
    const group = await s.report(`groupId=${s.needs.id}&${range}`);
    expect(group).toMatchObject({ name: s.needs.name, hidden: false });
    const parts = await Promise.all(
      s.needs.categories.map((c) => s.report(`categoryId=${c.id}&${range}`)),
    );
    for (const [i, m] of group.months.entries()) {
      for (const key of FIGURES) {
        const sum = parts.reduce((t, p) => t + BigInt(p.months[i]?.[key] ?? "0"), 0n);
        expect(m[key], `${m.month} ${key}`).toBe(sum.toString());
      }
    }
    // Dining's $100 covers Groceries' $50 in the total, but Groceries still ended overspent.
    expect(group.months[1]).toMatchObject({ available: "5000", creditOverspent: "-5000" });
    expect(group.stats.monthsOverspent).toBe(1);
    // Groceries' target is the group's; Dining → Groceries stays inside, Rent → Dining comes in.
    expect(group.months.map((m) => m.targetAmount)).toEqual([null, "45000", "45000"]);
    expect(group.months[2]?.moves).toMatchObject([
      { categoryId: s.dining.id, otherCategoryId: s.rent.id, amount: "1000" },
    ]);
  });

  it("keeps to the plan's months", async () => {
    const s = await setup();
    const short = await s.report(`categoryId=${s.groceries.id}&from=2026-01&to=2027-06`);
    // From the plan's first month (before July's starting balances) to one past the current one.
    expect(short.firstMonth).toBe("2026-06");
    expect(short.months.map((m) => m.month)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    const widest = await s.report(`categoryId=${s.groceries.id}&from=0000-01&to=9999-12`);
    expect(widest.months).toHaveLength(6);
    const later = await s.report(`categoryId=${s.groceries.id}&from=2027-12&to=2027-12`);
    expect(later.months).toEqual([]);
    expect(later.stats).toMatchObject({ averageAssigned: "0", monthsOverspent: 0 });
  });

  it("refuses bad queries, categories without a plan and other people's budgets", async () => {
    const s = await setup();
    const status = async (query: string, headers?: Record<string, string>) =>
      (await s.history(query, headers)).status;
    const range = "from=2026-10&to=2026-10";
    expect(await status(`categoryId=${s.groceries.id}&from=2026-10&to=2026-09`)).toBe(400);
    expect(await status(range)).toBe(400);
    expect(await status(`categoryId=${s.groceries.id}&groupId=${s.needs.id}&${range}`)).toBe(400);
    expect(await status(`categoryId=${s.list.readyToAssignCategoryId}&${range}`)).toBe(400);
    expect(await status(`categoryId=${s.payment.id}&${range}`)).toBe(400);
    expect(await status(`groupId=${s.paymentGroup.id}&${range}`)).toBe(400);
    expect(await status(`categoryId=nope&${range}`)).toBe(404);
    expect(await status(`groupId=nope&${range}`)).toBe(404);
    // Uncategorized has no plan of its own but a history all the same.
    expect(await status(`categoryId=${s.list.uncategorizedCategoryId}&${range}`)).toBe(200);

    const other = await signUp(app);
    expect(await status(`categoryId=${s.groceries.id}&${range}`, { cookie: other.cookie })).toBe(
      404,
    );
    const { key } = await ok<{ key: string }>(
      send("POST", "/v1/me/api-keys", s.cookie, {
        name: "Script",
        access: "read",
        budgetIds: null,
        expiresInDays: 90,
      }),
    );
    expect(
      await status(`categoryId=${s.groceries.id}&${range}`, { authorization: `Bearer ${key}` }),
    ).toBe(200);
  });
});
