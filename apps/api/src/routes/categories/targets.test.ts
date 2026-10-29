import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Target = {
  cadence: string;
  behavior: string;
  amount: string;
  dueDay: number | null;
  dueDate: string | null;
  repeatEvery: number | null;
  repeatUnit: string | null;
  startMonth: string;
  startDay: number | null;
  snoozedMonth: string | null;
};
type Category = { id: string; name: string; target: Target | null };
type Group = { id: string; kind: string | null; categories: Category[] };
type Need = {
  needed: string;
  funded: string;
  underfunded: string;
  dueDate: string | null;
  pastDue: boolean;
} | null;
type Month = { categories: { categoryId: string; available: string; target: Need }[] };
type ErrorBody = { error: { code: string } };

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
      balance: "100000",
      date: "2026-08-20",
    }),
  );
  const groups = async () =>
    (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie))).groups;
  const [bills] = (await groups()).filter((g) => !g.kind);
  const [rent, phone] = bills?.categories ?? [];
  if (!rent || !phone) throw new Error("starter data missing");

  const setTarget = (categoryId: string, input: Record<string, unknown>) =>
    send("PUT", `${base}/categories/${categoryId}/target`, cookie, {
      cadence: "monthly",
      behavior: "set_aside",
      amount: "10000",
      dueDay: null,
      month: "2026-10",
      today: TODAY,
      ...input,
    });
  const assign = (categoryId: string, m: string, assigned: string) =>
    send("PUT", `${base}/months/${m}/categories/${categoryId}`, cookie, {
      assigned,
      today: TODAY,
    });
  const spend = async (categoryId: string, date: string, amount: string) => {
    const res = await send("POST", `${base}/transactions`, cookie, {
      accountId: account.id,
      categoryId,
      date,
      amount,
    });
    expect(res.status).toBe(201);
  };
  const need = async (categoryId: string, m: string) => {
    const res = await send("GET", `${base}/months/${m}?today=${TODAY}`, cookie);
    expect(res.status).toBe(200);
    return (await json<Month>(res)).categories.find((c) => c.categoryId === categoryId)?.target;
  };
  const findCategory = async (id: string) =>
    (await groups()).flatMap((g) => g.categories).find((c) => c.id === id);
  return { cookie, base, rent, phone, setTarget, assign, spend, need, findCategory, groups };
}

describe("category targets", () => {
  it("creates, edits and removes a target", async () => {
    const { base, cookie, rent, setTarget, findCategory } = await setup();
    const created = await setTarget(rent.id, { dueDay: 15 });
    expect(created.status).toBe(200);
    expect((await json<Category>(created)).target).toEqual({
      cadence: "monthly",
      behavior: "set_aside",
      amount: "10000",
      currency: "USD",
      dueDay: 15,
      dueDate: null,
      repeatEvery: null,
      repeatUnit: null,
      startMonth: "2026-10",
      startDay: null,
      snoozedMonth: null,
      goal: null,
      goalAmount: null,
    });
    expect((await findCategory(rent.id))?.target?.amount).toBe("10000");

    await setTarget(rent.id, { behavior: "refill", amount: "5000" });
    expect((await findCategory(rent.id))?.target).toMatchObject({
      behavior: "refill",
      amount: "5000",
      dueDay: null,
    });

    const removed = await send("DELETE", `${base}/categories/${rent.id}/target`, cookie);
    expect(removed.status).toBe(200);
    expect((await json<Category>(removed)).target).toBeNull();
    expect((await findCategory(rent.id))?.target).toBeNull();
  });

  it("starts in the month it's set from; saving from an earlier month moves the start back", async () => {
    const { rent, setTarget, findCategory } = await setup();
    await setTarget(rent.id, { month: "2026-11" });
    expect((await findCategory(rent.id))?.target?.startMonth).toBe("2026-11");
    await setTarget(rent.id, { month: "2026-12" });
    expect((await findCategory(rent.id))?.target?.startMonth).toBe("2026-11");
    await setTarget(rent.id, { month: "2026-09" });
    expect((await findCategory(rent.id))?.target?.startMonth).toBe("2026-09");
  });

  it("a changed target starts again in the month it's saved from", async () => {
    const { rent, setTarget, findCategory, need } = await setup();
    await setTarget(rent.id, { month: "2026-09" });
    // $80.00 from October: September shows no target any more.
    await setTarget(rent.id, { amount: "8000", month: "2026-10" });
    expect((await findCategory(rent.id))?.target?.startMonth).toBe("2026-10");
    expect(await need(rent.id, "2026-09")).toBeNull();
    // A change from a later month moves it forward too; saved unchanged, it stays.
    await setTarget(rent.id, { amount: "9000", month: "2026-11" });
    expect((await findCategory(rent.id))?.target?.startMonth).toBe("2026-11");
    await setTarget(rent.id, { amount: "9000", month: "2026-10" });
    await setTarget(rent.id, { amount: "9000", month: "2026-11" });
    expect((await findCategory(rent.id))?.target?.startMonth).toBe("2026-10");
    // A new due day alone isn't a change.
    await setTarget(rent.id, { amount: "9000", dueDay: 15, month: "2026-11" });
    expect((await findCategory(rent.id))?.target?.startMonth).toBe("2026-10");
  });

  it("restores a target exactly as it was, or removes it", async () => {
    const { cookie, base, rent, setTarget, findCategory } = await setup();
    await setTarget(rent.id, { amount: "10000" });
    const before = (await findCategory(rent.id))?.target;
    await setTarget(rent.id, { amount: "13000", month: "2026-11" });
    expect((await findCategory(rent.id))?.target?.startMonth).toBe("2026-11");
    const restore = (target: unknown) =>
      send("PUT", `${base}/categories/${rent.id}/target/restore`, cookie, { target });
    expect((await restore(before)).status).toBe(200);
    expect((await findCategory(rent.id))?.target).toEqual(before);
    expect((await restore(null)).status).toBe(200);
    expect((await findCategory(rent.id))?.target).toBeNull();
    expect((await restore(before)).status).toBe(200);
    expect((await findCategory(rent.id))?.target).toEqual(before);
    const payment = { ...before, cadence: "payment_monthly" };
    expect((await restore(payment)).status).toBe(409);
  });

  it("set aside counts this month's Assigned", async () => {
    const { rent, phone, setTarget, assign, spend, need } = await setup();
    await setTarget(rent.id, {});
    await setTarget(phone.id, {});
    await assign(rent.id, "2026-10", "4000");
    expect(await need(rent.id, "2026-10")).toMatchObject({
      needed: "10000",
      funded: "4000",
      underfunded: "6000",
      dueDate: null,
    });
    await assign(rent.id, "2026-10", "10000");
    await spend(rent.id, "2026-10-01", "-3000");
    expect((await need(rent.id, "2026-10"))?.underfunded).toBe("0");
    // Money carried in from September doesn't count.
    await assign(phone.id, "2026-09", "7000");
    expect((await need(phone.id, "2026-10"))?.underfunded).toBe("10000");
  });

  it("refill counts carried money and Assigned, not spending or refunds", async () => {
    const { rent, phone, setTarget, assign, spend, need } = await setup();
    await setTarget(rent.id, { behavior: "refill" });
    await setTarget(phone.id, { behavior: "refill" });
    await assign(rent.id, "2026-09", "7000");
    await spend(rent.id, "2026-10-01", "-2000");
    expect(await need(rent.id, "2026-10")).toMatchObject({
      needed: "10000",
      funded: "7000",
      underfunded: "3000",
      dueDate: null,
    });
    await assign(rent.id, "2026-10", "-2000");
    expect((await need(rent.id, "2026-10"))?.underfunded).toBe("5000");
    await assign(phone.id, "2026-10", "4000");
    await spend(phone.id, "2026-10-02", "2000");
    expect((await need(phone.id, "2026-10"))?.funded).toBe("4000");
  });

  it("ignores carried money in a future month and asks nothing before the start", async () => {
    const { rent, setTarget, assign, need } = await setup();
    await setTarget(rent.id, { behavior: "refill" });
    await assign(rent.id, "2026-10", "7000");
    expect((await need(rent.id, "2026-11"))?.funded).toBe("0");
    expect(await need(rent.id, "2026-09")).toBeNull();
  });

  it("refuses payment categories and invalid amounts", async () => {
    const { base, cookie, rent, setTarget, groups } = await setup();
    await send("POST", `${base}/accounts`, cookie, {
      name: "Visa",
      type: "credit_card",
      balance: "0",
      date: "2026-08-20",
    });
    const payment = (await groups()).find((g) => g.kind === "credit_card_payments")?.categories[0];
    if (!payment) throw new Error("payment category missing");
    const res = await setTarget(payment.id, {});
    expect(res.status).toBe(409);
    expect((await json<ErrorBody>(res)).error.code).toBe("MANAGED_CATEGORY");
    expect((await setTarget(rent.id, { amount: "0" })).status).toBe(400);
    expect((await setTarget(rent.id, { dueDay: 32 })).status).toBe(400);
  });

  it("asks a weekly amount per occurrence of its weekday", async () => {
    const { rent, setTarget, need } = await setup();
    const res = await setTarget(rent.id, { cadence: "weekly", amount: "1000", dueDay: 6 });
    expect(res.status).toBe(200);
    expect((await need(rent.id, "2026-10"))?.needed).toBe("5000");
    expect((await need(rent.id, "2026-11"))?.needed).toBe("4000");
  });

  it("asks a target made weekly mid-month only for the weeks from that day", async () => {
    const { rent, phone, setTarget, need } = await setup();
    const weekly = { cadence: "weekly", amount: "1000", dueDay: 6, today: "2026-10-12" };
    await setTarget(rent.id, weekly);
    expect((await need(rent.id, "2026-10"))?.needed).toBe("3000");
    expect((await need(rent.id, "2026-11"))?.needed).toBe("4000");
    // Editing it keeps its start day; a monthly target made weekly starts that day too.
    await setTarget(rent.id, { ...weekly, amount: "2000", today: "2026-10-20" });
    expect((await need(rent.id, "2026-10"))?.needed).toBe("6000");
    await setTarget(phone.id, { amount: "2000", today: "2026-10-12" });
    await setTarget(phone.id, { ...weekly, today: "2026-10-20" });
    expect((await need(phone.id, "2026-10"))?.needed).toBe("2000");
    // Saved from another month, it asks for every week there.
    await setTarget(phone.id, { ...weekly, amount: "500", month: "2026-11" });
    expect((await need(phone.id, "2026-11"))?.needed).toBe("2000");
  });

  it("spreads a yearly target over the months left", async () => {
    const { rent, setTarget, assign, need, findCategory } = await setup();
    await setTarget(rent.id, {
      cadence: "yearly",
      amount: "100000",
      dueDate: "2026-12-30",
      dueDay: undefined,
    });
    expect((await findCategory(rent.id))?.target).toMatchObject({
      cadence: "yearly",
      dueDate: "2026-12-30",
      dueDay: null,
    });
    expect(await need(rent.id, "2026-10")).toMatchObject({
      needed: "100000",
      funded: "0",
      underfunded: "33334",
      dueDate: "2026-12-30",
    });
    await assign(rent.id, "2026-10", "33334");
    expect((await need(rent.id, "2026-11"))?.underfunded).toBe("33333");
  });

  it("repeats custom targets and keeps balance targets to a month", async () => {
    const { rent, phone, setTarget, need, findCategory } = await setup();
    await setTarget(rent.id, {
      cadence: "custom",
      amount: "30000",
      dueDate: "2026-11-01",
      repeat: { every: 2, unit: "month" },
      dueDay: undefined,
    });
    expect((await need(rent.id, "2026-12"))?.dueDate).toBe("2027-01-01");
    await setTarget(phone.id, {
      cadence: "custom",
      behavior: "balance",
      amount: "30000",
      dueDate: "2026-12-15",
      repeat: null,
      dueDay: undefined,
    });
    expect((await findCategory(phone.id))?.target?.dueDate).toBe("2026-12-01");
    expect((await need(phone.id, "2026-10"))?.underfunded).toBe("10000");
  });

  it("keeps a one-time target on past its due month, asking nothing; balance targets count Available", async () => {
    const { rent, phone, setTarget, assign, spend, need } = await setup();
    await setTarget(rent.id, {
      cadence: "custom",
      amount: "10000",
      dueDate: "2026-09-15",
      repeat: null,
      dueDay: undefined,
    });
    expect(await assign(rent.id, "2026-10", "3000")).toHaveProperty("status", 200);
    expect(await need(rent.id, "2026-10")).toMatchObject({
      needed: "10000",
      funded: "3000",
      underfunded: "0",
      dueDate: "2026-09-15",
      pastDue: true,
    });
    // Balance: $40.00 carried in, $20.00 spent in October → $180.00 over three months.
    await setTarget(phone.id, {
      cadence: "custom",
      behavior: "balance",
      amount: "20000",
      dueDate: "2026-12-01",
      repeat: null,
      dueDay: undefined,
    });
    await assign(phone.id, "2026-09", "4000");
    await spend(phone.id, "2026-10-01", "-2000");
    expect(await need(phone.id, "2026-10")).toMatchObject({
      funded: "2000",
      underfunded: "6000",
      pastDue: false,
    });
  });

  it("refuses cadence fields that don't fit", async () => {
    const { rent, setTarget } = await setup();
    const custom = { cadence: "custom", dueDay: undefined, dueDate: "2026-12-01", repeat: null };
    expect((await setTarget(rent.id, { cadence: "weekly", dueDay: 7 })).status).toBe(400);
    expect((await setTarget(rent.id, { cadence: "yearly", dueDay: undefined })).status).toBe(400);
    expect((await setTarget(rent.id, { cadence: "monthly", behavior: "balance" })).status).toBe(
      400,
    );
    expect((await setTarget(rent.id, { ...custom, dueDate: null })).status).toBe(400);
    expect(
      (
        await setTarget(rent.id, {
          ...custom,
          behavior: "balance",
          repeat: { every: 1, unit: "month" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await setTarget(rent.id, { ...custom, repeat: { every: 3, unit: "year" } })).status,
    ).toBe(400);
    expect(
      (await setTarget(rent.id, { ...custom, behavior: "balance", dueDate: null })).status,
    ).toBe(200);
  });

  it("is only for members", async () => {
    const { base, rent } = await setup();
    const other = await signUp(app, { email: "other@example.com" });
    const res = await send("PUT", `${base}/categories/${rent.id}/target`, other.cookie, {
      cadence: "monthly",
      behavior: "set_aside",
      amount: "100",
      dueDay: null,
      month: "2026-10",
    });
    expect(res.status).toBe(404);
  });

  describe("snooze", () => {
    type MonthRow = {
      categoryId: string;
      assigned: string;
      target: { snoozed: boolean } | null;
      autoAssign: { underfunded: string; reduceOverfunding: string };
      bar: { tone: string; sections: { size: string }[] } | null;
    };
    const monthRow = async (ctx: { base: string; cookie: string }, id: string, m: string) => {
      const res = await send("GET", `${ctx.base}/months/${m}?today=${TODAY}`, ctx.cookie);
      return (await json<{ categories: MonthRow[] }>(res)).categories.find(
        (c) => c.categoryId === id,
      );
    };
    const snooze = (
      ctx: { base: string; cookie: string },
      id: string,
      month: string,
      snoozed = true,
    ) =>
      send("PUT", `${ctx.base}/categories/${id}/target/snooze`, ctx.cookie, {
        month,
        snoozed,
        today: TODAY,
      });

    it("asks for nothing more in the month it's snoozed, and again the next", async () => {
      const ctx = await setup();
      const { rent, setTarget, findCategory } = ctx;
      await setTarget(rent.id, {});
      expect((await monthRow(ctx, rent.id, "2026-10"))?.bar?.tone).toBe("underfunded");

      const res = await snooze(ctx, rent.id, "2026-10");
      expect(res.status).toBe(200);
      expect((await findCategory(rent.id))?.target?.snoozedMonth).toBe("2026-10");
      const oct = await monthRow(ctx, rent.id, "2026-10");
      expect(oct).toMatchObject({
        target: { snoozed: true },
        autoAssign: { underfunded: "0" },
        bar: { tone: "funded" },
      });
      const nov = await monthRow(ctx, rent.id, "2026-11");
      expect(nov).toMatchObject({
        target: { snoozed: false },
        autoAssign: { underfunded: "10000" },
      });

      expect((await snooze(ctx, rent.id, "2026-10", false)).status).toBe(200);
      expect((await findCategory(rent.id))?.target?.snoozedMonth).toBeNull();
    });

    it("still covers overspending and gives back what's over", async () => {
      const ctx = await setup();
      const { rent, phone, setTarget, assign, spend } = ctx;
      await setTarget(rent.id, {});
      await setTarget(phone.id, {});
      await spend(rent.id, "2026-10-01", "-3000");
      await assign(phone.id, "2026-10", "15000");
      await snooze(ctx, rent.id, "2026-10");
      await snooze(ctx, phone.id, "2026-10");
      expect((await monthRow(ctx, rent.id, "2026-10"))?.autoAssign.underfunded).toBe("3000");
      expect((await monthRow(ctx, phone.id, "2026-10"))?.autoAssign.reduceOverfunding).toBe(
        "10000",
      );
    });

    it("snoozes only the current month, and only a target", async () => {
      const ctx = await setup();
      const { rent, phone, setTarget } = ctx;
      await setTarget(rent.id, {});
      const future = await snooze(ctx, rent.id, "2026-11");
      expect(future.status).toBe(400);
      expect((await json<ErrorBody>(future)).error.code).toBe("SNOOZE_CURRENT_MONTH");
      expect((await snooze(ctx, phone.id, "2026-10")).status).toBe(404);
    });
  });
});
