import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import type { FakeFxProvider } from "../../lib/fx/fake";

// A target can be in its own currency; its amount is converted into the budget's
// at the user's today's rate, rounded up, before the target math.
const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset().seed("2026-10-01", "EUR", { USD: "1.0842" }).seed("2026-11-01", "EUR", { USD: "1.2" });
});
afterAll(close);

const TODAY = "2026-10-16";

type Need = { needed: string; funded: string; underfunded: string } | null;
type CategoryMonth = {
  categoryId: string;
  target: Need;
  targetConversion: {
    currency: string;
    amount: string;
    amountInBase: string;
    rate: string;
  } | null;
  targetRateMissing: boolean;
  autoAssign: { underfunded: string };
};
type Month = { categories: CategoryMonth[]; targets: { month: string; nextMonth: string } };
type Category = { id: string; target: { amount: string; currency: string } | null };
type Group = { kind: string | null; categories: Category[] };

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
  const res = await send("POST", `${base}/accounts`, cookie, {
    name: "Checking",
    type: "checking",
    balance: "1000000",
    date: "2026-10-01",
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const groups = async () =>
    (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie))).groups;
  const [holiday, rent] = (await groups()).filter((g) => !g.kind).flatMap((g) => g.categories);
  if (!holiday || !rent) throw new Error("starter data missing");
  const setTarget = (categoryId: string, input: Record<string, unknown>) =>
    send("PUT", `${base}/categories/${categoryId}/target`, cookie, {
      cadence: "monthly",
      behavior: "set_aside",
      amount: "150000",
      dueDay: null,
      month: "2026-10",
      today: TODAY,
      ...input,
    });
  const month = async (m = "2026-10", today = TODAY) => {
    const r = await send("GET", `${base}/months/${m}?today=${today}`, cookie);
    expect(r.status).toBe(200);
    const body = await json<Month>(r);
    return { ...body, of: (id: string) => body.categories.find((c) => c.categoryId === id) };
  };
  const assign = (categoryId: string, assigned: string) =>
    send("PUT", `${base}/months/2026-10/categories/${categoryId}`, cookie, {
      assigned,
      today: TODAY,
    });
  return { cookie, base, groups, holiday, rent, setTarget, month, assign };
}

describe("targets in their own currency", () => {
  it("asks for a EUR target in USD at today's rate, rounded up", async () => {
    const { holiday, setTarget, month, groups } = await setup();
    const saved = await setTarget(holiday.id, { currency: "EUR" });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect((await json<Category>(saved)).target).toMatchObject({
      amount: "150000",
      currency: "EUR",
    });
    const listed = (await groups()).flatMap((g) => g.categories).find((c) => c.id === holiday.id);
    expect(listed?.target?.currency).toBe("EUR");

    // €1,500.00 × 1.0842 = $1,626.30.
    const m = await month();
    expect(m.of(holiday.id)).toMatchObject({
      target: { needed: "162630", funded: "0", underfunded: "162630" },
      targetConversion: {
        currency: "EUR",
        amount: "150000",
        amountInBase: "162630",
        rate: "1.0842",
      },
      targetRateMissing: false,
      autoAssign: { underfunded: "162630" },
    });
    expect(m.targets.month).toBe("162630");
  });

  it("rounds a fraction of a cent up so the target is never underfunded by rounding", async () => {
    const { holiday, setTarget, month, assign } = await setup();
    // €10.01 × 1.0842 = $10.852842 → $10.86.
    await setTarget(holiday.id, { currency: "EUR", amount: "1001" });
    expect((await month()).of(holiday.id)?.target?.needed).toBe("1086");
    expect((await assign(holiday.id, "1086")).status).toBe(200);
    expect((await month()).of(holiday.id)?.target).toMatchObject({
      funded: "1086",
      underfunded: "0",
    });
  });

  it("meets the target once the full converted amount is assigned", async () => {
    const { holiday, setTarget, month, assign } = await setup();
    await setTarget(holiday.id, { currency: "EUR" });
    expect((await assign(holiday.id, "162629")).status).toBe(200);
    expect((await month()).of(holiday.id)?.target?.underfunded).toBe("1");
    expect((await assign(holiday.id, "162630")).status).toBe(200);
    const m = await month();
    expect(m.of(holiday.id)?.target).toMatchObject({ funded: "162630", underfunded: "0" });
    expect(m.of(holiday.id)?.autoAssign.underfunded).toBe("162630");
  });

  it("follows a later rate in a later month", async () => {
    const { holiday, setTarget, month } = await setup();
    await setTarget(holiday.id, { currency: "EUR" });
    // Seen from October, November asks at October's rate.
    expect((await month("2026-11")).of(holiday.id)?.target?.needed).toBe("162630");
    expect((await month()).targets.nextMonth).toBe("162630");
    // On November 2nd the rate is 1.2: €1,500.00 = $1,800.00.
    const november = await month("2026-11", "2026-11-02");
    expect(november.of(holiday.id)).toMatchObject({
      target: { needed: "180000" },
      targetConversion: { rate: "1.2", amountInBase: "180000" },
    });
    expect(november.targets.month).toBe("180000");
  });

  it("leaves a target without a rate out of the month's math", async () => {
    const { holiday, rent, setTarget, month } = await setup();
    // No provider has GBP rates and none were cached.
    await setTarget(holiday.id, { currency: "GBP" });
    await setTarget(rent.id, { amount: "10000" });
    const m = await month();
    expect(m.of(holiday.id)).toMatchObject({
      target: null,
      targetConversion: null,
      targetRateMissing: true,
      autoAssign: { underfunded: "0" },
    });
    expect(m.targets.month).toBe("10000");
  });

  it("keeps a target in the budget's currency as it was", async () => {
    const { rent, setTarget, month } = await setup();
    const saved = await json<Category>(await setTarget(rent.id, { amount: "10000" }));
    expect(saved.target?.currency).toBe("USD");
    const m = await month();
    expect(m.of(rent.id)).toMatchObject({
      target: { needed: "10000", underfunded: "10000" },
      targetConversion: null,
      targetRateMissing: false,
      autoAssign: { underfunded: "10000" },
    });
    expect(m.targets.month).toBe("10000");
  });

  it("puts a target back in its currency on undo", async () => {
    const { cookie, base, holiday, setTarget } = await setup();
    const saved = await json<{ target: Record<string, unknown> }>(
      await setTarget(holiday.id, { currency: "EUR" }),
    );
    await send("DELETE", `${base}/categories/${holiday.id}/target`, cookie);
    const restored = await send("PUT", `${base}/categories/${holiday.id}/target/restore`, cookie, {
      target: saved.target,
    });
    expect(restored.status).toBe(200);
    expect((await json<Category>(restored)).target).toMatchObject({
      amount: "150000",
      currency: "EUR",
    });
  });

  it("restarts a target whose currency changed", async () => {
    const { holiday, setTarget } = await setup();
    await setTarget(holiday.id, { month: "2026-09" });
    const same = await json<{ target: { startMonth: string } }>(
      await setTarget(holiday.id, { month: "2026-10" }),
    );
    expect(same.target.startMonth).toBe("2026-09");
    const changed = await json<{ target: { startMonth: string } }>(
      await setTarget(holiday.id, { month: "2026-10", currency: "EUR" }),
    );
    expect(changed.target.startMonth).toBe("2026-10");
  });

  it("keeps Pay Off Balance by Date in the budget's currency", async () => {
    const { cookie, base, groups } = await setup();
    const card = await send("POST", `${base}/accounts`, cookie, {
      name: "Card",
      type: "credit_card",
      balance: "-10000",
      date: "2026-10-01",
    });
    expect(card.status).toBe(201);
    const payment = (await groups()).find((g) => g.kind)?.categories[0];
    if (!payment) throw new Error("no payment category");
    const res = await send("PUT", `${base}/categories/${payment.id}/target`, cookie, {
      cadence: "payoff_by_date",
      dueMonth: "2026-12",
      currency: "EUR",
      month: "2026-10",
      today: TODAY,
    });
    expect(res.status).toBe(422);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("TARGET_CURRENCY");
  });
});
