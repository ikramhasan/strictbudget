import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

const TODAY = "2026-10-20";
const FIGURES = ["assigned", "activity", "available", "cashOverspent", "creditOverspent"] as const;

type Figures = Record<(typeof FIGURES)[number], string>;
type ReportMonth = Figures & { month: string; targetAmount: string | null };
type Report = {
  currency: string;
  firstMonth: string;
  months: string[];
  categories: {
    categoryId: string;
    groupId: string;
    uncategorized: boolean;
    hidden: boolean;
    months: ReportMonth[];
  }[];
};
type PlanMonth = {
  categories: (Figures & { categoryId: string })[];
  uncategorized: Omit<Figures, "assigned"> | null;
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
async function ok<T>(res: Response | Promise<Response>) {
  const r = await res;
  expect(r.status, await r.clone().text()).toBeLessThan(300);
  return json<T>(r);
}

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
  if (!rent || !phone || !groceries || !dining) throw new Error("starter data missing");
  const payment = list.groups.find((g) => g.kind)?.categories[0];
  if (!payment) throw new Error("no card payment category");

  const assign = (categoryId: string, month: string, assigned: string) =>
    ok(send("PUT", `${base}/months/${month}/categories/${categoryId}`, cookie, { assigned }));
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
  const report = (query: string) =>
    ok<Report>(send("GET", `${base}/reports/budget-vs-actual?today=${TODAY}&${query}`, cookie));
  const plan = (month: string) =>
    ok<PlanMonth>(send("GET", `${base}/months/${month}?today=${TODAY}`, cookie));
  return {
    cookie,
    base,
    card,
    list,
    rent,
    phone,
    groceries,
    dining,
    payment,
    assign,
    spend,
    report,
    plan,
  };
}

describe("GET /v1/budgets/:id/reports/budget-vs-actual", () => {
  it("gives each month the plan's own Assigned, Activity and Available", async () => {
    const s = await setup();
    await s.assign(s.groceries.id, "2026-08", "40000");
    await s.spend({ categoryId: s.groceries.id, date: "2026-08-10", amount: "-30000" });
    await s.assign(s.groceries.id, "2026-09", "5000");
    await s.spend({ categoryId: s.groceries.id, date: "2026-09-03", amount: "-12000" });
    await s.spend({
      categoryId: s.groceries.id,
      date: "2026-09-04",
      amount: "-8000",
      accountId: s.card.id,
    });
    await s.spend({ categoryId: s.phone.id, date: "2026-09-12", amount: "-3000" });
    await s.assign(s.rent.id, "2026-09", "100000");
    await s.spend({ categoryId: s.rent.id, date: "2026-09-01", amount: "-100000" });
    await s.assign(s.dining.id, "2026-10", "20000");
    await s.spend({ categoryId: s.dining.id, date: "2026-10-05", amount: "2500" });
    await ok(
      send("POST", `${s.base}/months/2026-10/moves`, s.cookie, {
        fromCategoryId: s.dining.id,
        toCategoryId: s.groceries.id,
        amount: "5000",
      }),
    );
    await s.spend({ categoryId: null, date: "2026-10-06", amount: "-700" });

    const report = await s.report("from=2026-08&to=2026-10");
    expect(report.currency).toBe("USD");
    for (const month of ["2026-08", "2026-09", "2026-10"]) {
      const plan = await s.plan(month);
      const index = report.months.indexOf(month);
      for (const row of report.categories) {
        const figures = row.months[index];
        if (row.uncategorized && !plan.uncategorized) {
          // Uncategorized is only on the plan in months with uncategorized transactions.
          expect(figures?.activity).toBe("0");
          continue;
        }
        const expected = row.uncategorized
          ? { assigned: "0", ...plan.uncategorized }
          : plan.categories.find((c) => c.categoryId === row.categoryId);
        if (!expected || !figures) throw new Error(`${row.categoryId} missing in ${month}`);
        for (const key of FIGURES) {
          expect(figures[key], `${month} ${row.categoryId} ${key}`).toBe(expected[key]);
        }
      }
    }

    const at = (categoryId: string, month: string) =>
      report.categories
        .find((r) => r.categoryId === categoryId)
        ?.months.find((m) => m.month === month);
    // $100 carried + $50 assigned covers the $120 of cash first; $50 of the card's $80 is short.
    expect(at(s.groceries.id, "2026-09")).toMatchObject({
      assigned: "5000",
      activity: "-20000",
      available: "-5000",
      cashOverspent: "0",
      creditOverspent: "-5000",
    });
    expect(at(s.phone.id, "2026-09")).toMatchObject({ cashOverspent: "-3000" });
    // The move shows in Assigned on both sides, as on the plan.
    expect(at(s.dining.id, "2026-10")).toMatchObject({ assigned: "15000", activity: "2500" });
    expect(at(s.groceries.id, "2026-10")?.assigned).toBe("5000");
  });

  it("lists active spending categories in plan order, Uncategorized first", async () => {
    const s = await setup();
    await s.assign(s.dining.id, "2026-10", "1000");
    await s.assign(s.rent.id, "2026-10", "1000");
    await s.assign(s.payment.id, "2026-10", "5000");
    await s.spend({ categoryId: s.list.uncategorizedCategoryId, date: "2026-10-02", amount: "-1" });
    await s.spend({
      categoryId: s.list.readyToAssignCategoryId,
      date: "2026-10-02",
      amount: "100000",
    });
    await s.spend({ categoryId: s.phone.id, date: "2026-10-03", amount: "-500" });
    await ok(send("PATCH", `${s.base}/categories/${s.phone.id}`, s.cookie, { hidden: true }));

    const report = await s.report("from=2026-10&to=2026-10");
    // Payment categories, Ready to Assign and untouched categories (Groceries) are left out.
    expect(report.categories.map((r) => [r.categoryId, r.uncategorized, r.hidden])).toEqual([
      [s.list.uncategorizedCategoryId, true, false],
      [s.rent.id, false, false],
      [s.phone.id, false, true],
      [s.dining.id, false, false],
    ]);
  });

  it("reaches back 12 months for the heatmap, within the plan's months", async () => {
    const s = await setup();
    const short = await s.report("from=2026-10&to=2026-10");
    // The plan's first month, as the plan screen gives it (the month before July's starting balances).
    const plan = await ok<{ firstMonth: string }>(
      send("GET", `${s.base}/months/2026-10?today=${TODAY}`, s.cookie),
    );
    expect(short.firstMonth).toBe(plan.firstMonth);
    expect(short.months).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    // Only the plan's months: from its first to one past the current month (no later assignments).
    const long = await s.report("from=2026-01&to=2027-06");
    expect(long.months).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    const later = await s.report("from=2027-12&to=2027-12");
    expect(later.months).toEqual([]);
    const widest = await s.report("from=0000-01&to=9999-12");
    expect(widest.months).toEqual(long.months);
  });

  it("gives what the target asks of each month", async () => {
    const s = await setup();
    await ok(
      send("PUT", `${s.base}/categories/${s.groceries.id}/target`, s.cookie, {
        cadence: "monthly",
        behavior: "set_aside",
        amount: "45000",
        dueDay: null,
        month: "2026-09",
        today: TODAY,
      }),
    );
    await s.assign(s.groceries.id, "2026-09", "45000");
    const report = await s.report("from=2026-08&to=2026-10");
    const row = report.categories.find((r) => r.categoryId === s.groceries.id);
    const amounts = row?.months.filter((m) => m.month >= "2026-08").map((m) => m.targetAmount);
    // No target before it starts.
    expect(amounts).toEqual([null, "45000", "45000"]);
  });

  it("refuses a backwards range and other people's budgets", async () => {
    const s = await setup();
    const back = await send(
      "GET",
      `${s.base}/reports/budget-vs-actual?from=2026-10&to=2026-09`,
      s.cookie,
    );
    expect(back.status).toBe(400);
    const other = await signUp(app);
    const res = await send(
      "GET",
      `${s.base}/reports/budget-vs-actual?from=2026-10&to=2026-10`,
      other.cookie,
    );
    expect(res.status).toBe(404);
  });
});
