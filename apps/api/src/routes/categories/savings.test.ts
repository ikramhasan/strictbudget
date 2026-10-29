import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  shareBudget,
  signUp,
} from "../../../test/helpers";
import { STARTER_SAVINGS } from "../../lib/starter-categories";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Target = {
  cadence: string;
  behavior: string;
  amount: string;
  startMonth: string;
  goal: string | null;
  goalAmount: string | null;
};
type Category = { id: string; name: string; savings: boolean; target: Target | null };
type Group = { id: string; name: string; kind: string | null; categories: Category[] };
type Need = {
  needed: string;
  funded: string;
  underfunded: string;
  dueDate: string | null;
  pastDue: boolean;
} | null;
type Month = {
  categories: { categoryId: string; available: string; target: Need }[];
  targets: { month: string };
};
type ErrorBody = { error: { code: string; details?: unknown } };

const TODAY = "2026-10-02";

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
  const account = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, cookie, {
      name: "Checking",
      type: "checking",
      balance: "5000000",
      date: "2026-08-20",
    }),
  );
  const groups = async () =>
    (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie))).groups;
  const categories = async () => (await groups()).flatMap((g) => g.categories);
  const named = async (name: string) => {
    const c = (await categories()).find((x) => x.name === name);
    if (!c) throw new Error(`${name} missing`);
    return c;
  };
  const setTarget = (categoryId: string, input: Record<string, unknown>) =>
    send("PUT", `${base}/categories/${categoryId}/target`, cookie, {
      dueDay: null,
      month: "2026-10",
      today: TODAY,
      ...input,
    });
  const assign = async (categoryId: string, m: string, assigned: string) => {
    const res = await send("PUT", `${base}/months/${m}/categories/${categoryId}`, cookie, {
      assigned,
      today: TODAY,
    });
    expect(res.status).toBe(200);
  };
  const spend = async (categoryId: string, date: string, amount: string) => {
    const res = await send("POST", `${base}/transactions`, cookie, {
      accountId: account.id,
      categoryId,
      date,
      amount,
    });
    expect(res.status).toBe(201);
  };
  const month = async (m: string, today = TODAY) => {
    const res = await send("GET", `${base}/months/${m}?today=${today}`, cookie);
    expect(res.status).toBe(200);
    return json<Month>(res);
  };
  const need = async (categoryId: string, m: string, today = TODAY) =>
    (await month(m, today)).categories.find((c) => c.categoryId === categoryId)?.target;
  return {
    cookie,
    budgetId: budget.id,
    base,
    groups,
    categories,
    named,
    setTarget,
    assign,
    spend,
    month,
    need,
  };
}

describe("savings categories", () => {
  it("starts new budgets with the emergency fund and vacation as savings", async () => {
    const { categories } = await setup();
    const savings = (await categories()).filter((c) => c.savings).map((c) => c.name);
    expect(savings).toEqual([...STARTER_SAVINGS]);
  });

  it("creates a savings category and switches a category either way", async () => {
    const { cookie, base, groups, named } = await setup();
    const [bills] = await groups();
    if (!bills) throw new Error("starter data missing");
    const created = await send("POST", `${base}/categories`, cookie, {
      groupId: bills.id,
      name: "House deposit",
      savings: true,
    });
    expect(created.status).toBe(201);
    expect(await json<Category>(created)).toMatchObject({ name: "House deposit", savings: true });
    const plain = await send("POST", `${base}/categories`, cookie, {
      groupId: bills.id,
      name: "Water",
    });
    expect((await json<Category>(plain)).savings).toBe(false);

    const groceries = await named("🛒 Groceries");
    const marked = await send("PATCH", `${base}/categories/${groceries.id}`, cookie, {
      savings: true,
    });
    expect(marked.status).toBe(200);
    expect((await json<Category>(marked)).savings).toBe(true);
    await send("PATCH", `${base}/categories/${groceries.id}`, cookie, { savings: false });
    expect((await named("🛒 Groceries")).savings).toBe(false);
  });

  it("keeps payment categories out of savings", async () => {
    const { cookie, base, groups } = await setup();
    await send("POST", `${base}/accounts`, cookie, {
      name: "Visa",
      type: "credit_card",
      balance: "-5000",
      date: "2026-10-01",
    });
    const payment = (await groups()).find((g) => g.kind === "credit_card_payments")?.categories[0];
    if (!payment) throw new Error("payment category missing");
    const res = await send("PATCH", `${base}/categories/${payment.id}`, cookie, { savings: true });
    expect(res.status).toBe(409);
    const after = (await groups()).find((g) => g.kind === "credit_card_payments")?.categories[0];
    expect(after?.savings).toBe(false);
  });
});

describe("savings goals", () => {
  it("keeps a safety fund: builds up at the monthly limit and refills after spending", async () => {
    const { named, setTarget, assign, spend, need, month } = await setup();
    const fund = await named("😌 Emergency fund");
    const res = await setTarget(fund.id, {
      cadence: "monthly",
      behavior: "refill",
      goal: "safety_fund",
      amount: "50000",
      goalAmount: "1000000",
    });
    expect(res.status).toBe(200);
    expect((await json<Category>(res)).target).toMatchObject({
      goal: "safety_fund",
      goalAmount: "1000000",
      amount: "50000",
    });
    expect(await need(fund.id, "2026-10")).toMatchObject({
      needed: "1000000",
      funded: "0",
      underfunded: "50000",
    });
    // The month's targets count only what the fund asks.
    expect((await month("2026-10")).targets.month).toBe("50000");

    await assign(fund.id, "2026-09", "980000");
    expect(await need(fund.id, "2026-10")).toMatchObject({
      funded: "980000",
      underfunded: "20000",
    });
    await assign(fund.id, "2026-10", "20000");
    await spend(fund.id, "2026-10-01", "-120000");
    expect(await need(fund.id, "2026-11", "2026-11-01")).toMatchObject({
      funded: "880000",
      underfunded: "50000",
    });
  });

  it("saves up for something: money already in counts, spending it doesn't undo it", async () => {
    const { named, setTarget, assign, spend, need } = await setup();
    const vacation = await named("🏝️ Vacation");
    await assign(vacation.id, "2026-09", "100000");
    const res = await setTarget(vacation.id, {
      cadence: "monthly",
      behavior: "set_aside",
      goal: "save_up",
      amount: "25000",
      goalAmount: "300000",
    });
    expect(res.status).toBe(200);
    expect(await need(vacation.id, "2026-10")).toMatchObject({
      needed: "300000",
      funded: "100000",
      underfunded: "25000",
    });
    await assign(vacation.id, "2026-10", "200000");
    await spend(vacation.id, "2026-10-02", "-280000");
    expect(await need(vacation.id, "2026-11", "2026-11-01")).toMatchObject({
      funded: "300000",
      underfunded: "0",
    });
    // Moving money out lowers it again.
    await assign(vacation.id, "2026-11", "-1000");
    expect(await need(vacation.id, "2026-12", "2026-12-01")).toMatchObject({
      funded: "299000",
      underfunded: "1000",
    });
  });

  it("saves up by a date, still asking after it, and keeps counting when edited", async () => {
    const { named, setTarget, assign, need, categories } = await setup();
    const vacation = await named("🏝️ Vacation");
    const res = await setTarget(vacation.id, {
      cadence: "custom",
      behavior: "set_aside",
      goal: "save_up",
      amount: "120000",
      goalAmount: "120000",
      dueDate: "2027-03-01",
      repeat: null,
    });
    expect(res.status).toBe(200);
    expect(await need(vacation.id, "2026-10")).toMatchObject({
      needed: "120000",
      underfunded: "20000",
      dueDate: "2027-03-01",
    });
    await assign(vacation.id, "2026-10", "20000");
    expect(await need(vacation.id, "2027-05", "2027-05-01")).toMatchObject({
      funded: "20000",
      underfunded: "100000",
      pastDue: true,
    });
    // A new monthly amount from a later month keeps the goal's start, so October still counts.
    await setTarget(vacation.id, {
      cadence: "monthly",
      behavior: "set_aside",
      goal: "save_up",
      amount: "30000",
      goalAmount: "150000",
      month: "2026-11",
    });
    const edited = (await categories()).find((c) => c.id === vacation.id)?.target;
    expect(edited?.startMonth).toBe("2026-10");
    expect(await need(vacation.id, "2026-11", "2026-11-01")).toMatchObject({
      funded: "20000",
      underfunded: "30000",
    });
  });

  it("keeps saving: a monthly set aside with no ceiling", async () => {
    const { named, setTarget, assign, need } = await setup();
    const fund = await named("😌 Emergency fund");
    expect(
      (
        await setTarget(fund.id, {
          cadence: "monthly",
          behavior: "set_aside",
          goal: "keep_saving",
          amount: "40000",
        })
      ).status,
    ).toBe(200);
    await assign(fund.id, "2026-09", "5000000");
    expect(await need(fund.id, "2026-10")).toMatchObject({ needed: "40000", underfunded: "40000" });
  });

  it("refuses goals saved on the wrong kind of target", async () => {
    const { named, setTarget } = await setup();
    const fund = await named("😌 Emergency fund");
    const refused = async (input: Record<string, unknown>) => {
      const res = await setTarget(fund.id, input);
      expect(res.status, JSON.stringify(input)).toBe(400);
      return json<ErrorBody>(res);
    };
    await refused({ cadence: "monthly", behavior: "set_aside", amount: "100", goalAmount: "500" });
    await refused({
      cadence: "monthly",
      behavior: "set_aside",
      goal: "safety_fund",
      amount: "100",
    });
    await refused({
      cadence: "monthly",
      behavior: "refill",
      goal: "safety_fund",
      amount: "600",
      goalAmount: "500",
    });
    await refused({ cadence: "monthly", behavior: "set_aside", goal: "save_up", amount: "100" });
    await refused({
      cadence: "weekly",
      behavior: "set_aside",
      goal: "save_up",
      amount: "100",
      goalAmount: "500",
      dueDay: 1,
    });
    await refused({
      cadence: "custom",
      behavior: "set_aside",
      goal: "save_up",
      amount: "100",
      goalAmount: "500",
      dueDate: "2027-03-01",
      repeat: null,
    });
    await refused({
      cadence: "monthly",
      behavior: "set_aside",
      goal: "keep_saving",
      amount: "100",
      goalAmount: "500",
    });
    await refused({ cadence: "monthly", behavior: "refill", goal: "keep_saving", amount: "100" });
  });

  it("converts a goal in another currency at today's rate", async () => {
    const { cookie, base, named, setTarget, need } = await setup();
    await send("PUT", `${base}/fx-rate-overrides`, cookie, {
      date: TODAY,
      currency: "EUR",
      rate: "1.1",
    });
    const fund = await named("😌 Emergency fund");
    const res = await setTarget(fund.id, {
      cadence: "monthly",
      behavior: "refill",
      goal: "safety_fund",
      amount: "50000",
      goalAmount: "1000000",
      currency: "EUR",
    });
    expect(res.status).toBe(200);
    expect(await need(fund.id, "2026-10")).toMatchObject({
      needed: "1100000",
      underfunded: "55000",
    });
  });

  it("restores a goal exactly as it was", async () => {
    const { cookie, base, named, setTarget, categories } = await setup();
    const fund = await named("😌 Emergency fund");
    await setTarget(fund.id, {
      cadence: "monthly",
      behavior: "refill",
      goal: "safety_fund",
      amount: "50000",
      goalAmount: "1000000",
    });
    const before = (await categories()).find((c) => c.id === fund.id)?.target;
    await send("DELETE", `${base}/categories/${fund.id}/target`, cookie);
    const res = await send("PUT", `${base}/categories/${fund.id}/target/restore`, cookie, {
      target: before,
    });
    expect(res.status).toBe(200);
    expect((await categories()).find((c) => c.id === fund.id)?.target).toEqual(before);
  });
});

describe("the savings suggestion", () => {
  it("is answered once for everyone on the budget, by an editor, and kept by a fresh start", async () => {
    const { cookie, budgetId, base } = await setup();
    const dismissed = async (b = base, as = cookie) =>
      (
        await json<{ savingsSuggestionDismissed: boolean }>(
          await send("GET", `${b}/categories`, as),
        )
      ).savingsSuggestionDismissed;
    expect(await dismissed()).toBe(false);
    const viewer = await shareBudget(app, cookie, budgetId, { role: "viewer" });
    const refused = await send("PUT", `${base}/savings-suggestion`, viewer.cookie, {
      dismissed: true,
    });
    expect(refused.status).toBe(403);
    const editor = await shareBudget(app, cookie, budgetId, { name: "Sam", role: "editor" });
    const res = await send("PUT", `${base}/savings-suggestion`, editor.cookie, { dismissed: true });
    expect(res.status).toBe(200);
    expect(await json<{ dismissed: boolean }>(res)).toEqual({ dismissed: true });
    expect(await dismissed(base, viewer.cookie)).toBe(true);

    const fresh = await json<{ id: string }>(
      await send("POST", `${base}/fresh-start`, cookie, { name: "Fresh", date: TODAY }),
    );
    expect(await dismissed(`/v1/budgets/${fresh.id}`)).toBe(true);
  });
});
