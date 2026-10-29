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

type Summary = {
  start: string;
  spent: string;
  remaining: string;
  status: string | null;
  safePerDay: string | null;
  projectedEnd: string;
  runOutDate: string | null;
};
type SpendingPace = {
  month: string;
  days: number;
  elapsed: number;
  finished: boolean;
  line: Summary & { points: { date: string; remaining: string | null; ideal: string }[] };
  categories: {
    categoryId: string;
    name: string;
    groupId: string;
    included: boolean;
    setting: string | null;
    reason: string | null;
    pace: Summary;
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

/** Groceries ($300 left over from October plus November's assignments) and three bills. */
async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const { id: checking } = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, cookie, {
      name: "Checking",
      type: "checking",
      balance: "500000",
      date: "2026-10-01",
    }),
  );
  await send("POST", `${base}/accounts`, cookie, {
    name: "Visa",
    type: "credit_card",
    balance: "0",
    date: "2026-10-01",
  });
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
  const groceries = await category("Pace Groceries");
  const rent = await category("Pace Rent");
  const phone = await category("Pace Phone");
  const gym = await category("Pace Gym");

  const assign = async (categoryId: string, month: string, assigned: string) =>
    expect(
      (
        await send("PUT", `${base}/months/${month}/categories/${categoryId}`, cookie, {
          assigned,
          today: TODAY,
        })
      ).status,
    ).toBe(200);
  const spend = async (categoryId: string, date: string, amount: string) =>
    expect(
      (
        await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
          accountId: checking,
          date,
          amount,
          categoryId,
        })
      ).status,
    ).toBe(201);

  await assign(groceries, "2026-10", "30000");
  await assign(groceries, "2026-11", "0");
  await assign(rent, "2026-11", "120000");
  // Rent: a monthly target due on the 1st. Phone: a scheduled bill. Gym: hidden.
  await send("PUT", `${base}/categories/${rent}/target`, cookie, {
    cadence: "monthly",
    behavior: "set_aside",
    amount: "120000",
    dueDay: 1,
    month: "2026-11",
    today: TODAY,
  });
  await send("POST", `${base}/scheduled-transactions`, cookie, {
    accountId: checking,
    frequency: "monthly",
    date: "2026-11-25",
    amount: "-5000",
    categoryId: phone,
    today: TODAY,
  });
  await send("PATCH", `${base}/categories/${gym}`, cookie, { hidden: true });
  const holiday = await category("Pace Holiday");
  await assign(holiday, "2026-11", "50000");
  expect(
    (
      await send("PUT", `${base}/categories/${holiday}/target`, cookie, {
        cadence: "custom",
        behavior: "balance",
        amount: "200000",
        dueDate: null,
        repeat: null,
        month: "2026-11",
        today: TODAY,
      })
    ).status,
  ).toBe(200);

  const get = async (query = "", as = cookie) =>
    send("GET", `${base}/reports/spending-pace?today=${TODAY}${query}`, as);
  const read = async (query = "") => {
    const res = await get(query);
    expect(res.status, await res.clone().text()).toBe(200);
    return json<SpendingPace>(res);
  };
  const setPace = (categoryId: string, pace: string | null, as = cookie) =>
    send("PUT", `${base}/reports/spending-pace/categories/${categoryId}`, as, { pace });
  return {
    cookie,
    budgetId: budget.id,
    groupId: group.id,
    ids: { groceries, rent, phone, gym, holiday },
    assign,
    spend,
    get,
    read,
    setPace,
  };
}

describe("spending pace", () => {
  it("runs the plan's spending categories down against an even pace", async () => {
    const t = await setup();
    await t.spend(t.ids.groceries, "2026-11-02", "-4000");
    await t.spend(t.ids.groceries, "2026-11-09", "-6000");
    await t.spend(t.ids.rent, "2026-11-01", "-120000");
    const pace = await t.read();
    expect(pace).toMatchObject({ month: "2026-11", days: 30, elapsed: 10, finished: false });
    // Only Groceries counts: rent is a bill, the holiday fund savings.
    expect(pace.line).toMatchObject({
      start: "30000",
      spent: "10000",
      remaining: "20000",
      status: "on_pace",
      safePerDay: "952",
      projectedEnd: "0",
      runOutDate: null,
    });
    expect(pace.line.points).toHaveLength(30);
    expect(pace.line.points[1]).toEqual({ date: "2026-11-02", remaining: "26000", ideal: "28000" });
    expect(pace.line.points[10]?.remaining).toBeNull();

    const byId = new Map(pace.categories.map((c) => [c.categoryId, c]));
    expect(byId.get(t.ids.groceries)).toMatchObject({ included: true, reason: null });
    expect(byId.get(t.ids.rent)).toMatchObject({
      included: false,
      reason: "bill",
      pace: { start: "120000", spent: "120000", status: "behind" },
    });
    expect(byId.get(t.ids.phone)).toMatchObject({ included: false, reason: "scheduled" });
    expect(byId.get(t.ids.gym)).toMatchObject({ included: false, reason: "hidden" });
    expect(byId.get(t.ids.holiday)).toMatchObject({ included: false, reason: "saving" });
    // No card payment or internal categories.
    expect(pace.categories.some((c) => c.name === "Visa")).toBe(false);
  });

  it("leaves savings categories out, whatever their target or schedules say", async () => {
    const t = await setup();
    const base = `/v1/budgets/${t.budgetId}`;
    // Phone has a scheduled transaction and rent a dated target; as savings both read as saving.
    for (const id of [t.ids.phone, t.ids.rent, t.ids.groceries]) {
      const res = await send("PATCH", `${base}/categories/${id}`, t.cookie, { savings: true });
      expect(res.status).toBe(200);
    }
    const byId = new Map((await t.read()).categories.map((c) => [c.categoryId, c]));
    for (const id of [t.ids.phone, t.ids.rent, t.ids.groceries]) {
      expect(byId.get(id)).toMatchObject({ included: false, reason: "saving" });
    }
    // Hidden still wins, and a category's own setting overrides it.
    expect(byId.get(t.ids.gym)).toMatchObject({ reason: "hidden" });
    await t.setPace(t.ids.groceries, "include");
    expect((await t.read()).categories.find((c) => c.categoryId === t.ids.groceries)).toMatchObject(
      { included: true, reason: "saving" },
    );
  });

  it("counts refunds, money assigned mid-month and money moved out", async () => {
    const t = await setup();
    await t.spend(t.ids.groceries, "2026-11-03", "-15000");
    expect((await t.read()).line).toMatchObject({ status: "behind", runOutDate: "2026-11-21" });
    await t.spend(t.ids.groceries, "2026-11-05", "2500");
    await t.assign(t.ids.groceries, "2026-11", "10000");
    expect((await t.read()).line).toMatchObject({
      start: "40000",
      spent: "12500",
      remaining: "27500",
      status: "on_pace",
    });
    await t.assign(t.ids.groceries, "2026-11", "-20000");
    expect((await t.read()).line).toMatchObject({
      start: "10000",
      remaining: "-2500",
      safePerDay: "0",
      runOutDate: "2026-11-03",
    });
  });

  it("keeps a category in or out when told to, and back to the rule with null", async () => {
    const t = await setup();
    await t.spend(t.ids.rent, "2026-11-01", "-120000");
    expect((await t.setPace(t.ids.rent, "include")).status).toBe(200);
    expect((await t.setPace(t.ids.groceries, "exclude")).status).toBe(200);
    let pace = await t.read();
    expect(pace.line).toMatchObject({ start: "120000", spent: "120000", remaining: "0" });
    expect(pace.categories.find((c) => c.categoryId === t.ids.rent)).toMatchObject({
      included: true,
      setting: "include",
      reason: "bill",
    });
    await t.setPace(t.ids.rent, null);
    await t.setPace(t.ids.groceries, null);
    pace = await t.read();
    expect(pace.line.start).toBe("30000");
    expect(pace.categories.every((c) => c.setting === null)).toBe(true);
  });

  it("draws one category's or one group's line", async () => {
    const t = await setup();
    await t.spend(t.ids.rent, "2026-11-01", "-120000");
    const rent = await t.read(`&categoryId=${t.ids.rent}`);
    expect(rent.line).toMatchObject({ start: "120000", remaining: "0", status: "behind" });
    // A group's line counts its categories in pace.
    expect((await t.read(`&groupId=${t.groupId}`)).line.start).toBe("30000");
    expect((await t.get("&categoryId=nope")).status).toBe(400);
    expect((await t.get("&groupId=nope")).status).toBe(400);
  });

  it("finishes a past month and refuses a future one", async () => {
    const t = await setup();
    await t.spend(t.ids.groceries, "2026-10-15", "-1000");
    const october = await t.read("&month=2026-10");
    expect(october).toMatchObject({ days: 31, elapsed: 31, finished: true });
    expect(october.line).toMatchObject({ start: "30000", remaining: "29000", safePerDay: null });
    expect(october.line.points.every((p) => p.remaining !== null)).toBe(true);
    expect((await t.get("&month=2026-12")).status).toBe(400);
  });

  it("lets viewers read but not change settings, and hides the budget from others", async () => {
    const t = await setup();
    const viewer = await shareBudget(app, t.cookie, t.budgetId, { role: "viewer" });
    expect((await t.get("", viewer.cookie)).status).toBe(200);
    expect((await t.setPace(t.ids.rent, "include", viewer.cookie)).status).toBe(403);
    const stranger = await signUp(app);
    expect((await t.get("", stranger.cookie)).status).toBe(404);
    expect((await t.setPace(t.ids.rent, "include", stranger.cookie)).status).toBe(404);
  });

  it("refuses settings on categories it doesn't list", async () => {
    const t = await setup();
    const { groups } = await json<{ groups: Group[] }>(
      await send("GET", `/v1/budgets/${t.budgetId}/categories`, t.cookie),
    );
    const visa = groups.find((g) => g.kind)?.categories[0];
    expect((await t.setPace(visa?.id ?? "", "include")).status).toBe(400);
    expect((await t.setPace("nope", "include")).status).toBe(404);
  });
});
