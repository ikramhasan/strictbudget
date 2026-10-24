import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Target = { cadence: string; behavior: string; amount: string; dueDate: string | null };
type Category = { id: string; name: string; target: Target | null };
type Group = { id: string; kind: string | null; categories: Category[] };
type Need = {
  needed: string;
  funded: string;
  underfunded: string;
  dueDate: string | null;
  snoozed: boolean;
} | null;
type MonthCategory = {
  categoryId: string;
  available: string;
  target: Need;
  autoAssign: { underfunded: string; reduceOverfunding: string };
  payment: { underfunded: string } | null;
};
type Month = { categories: MonthCategory[]; targets: { month: string; nextMonth: string } };
type ErrorBody = { error: { code: string } };

const TODAY = "2026-10-08";

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

/** A budget with a checking account and a card owing `owed` (minor units). */
async function setup(owed = "12000") {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const checking = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, cookie, {
      name: "Checking",
      type: "checking",
      balance: "100000",
      date: "2026-08-20",
    }),
  );
  const card = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, cookie, {
      name: "Card E",
      type: "credit_card",
      balance: `-${owed}`,
      date: "2026-10-01",
    }),
  );
  const groups = (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie)))
    .groups;
  const payment = groups.find((g) => g.kind === "credit_card_payments")?.categories[0];
  const [rent, phone] = groups.find((g) => !g.kind)?.categories ?? [];
  if (!payment || !rent || !phone) throw new Error("starter data missing");

  const setTarget = (categoryId: string, input: Record<string, unknown>) =>
    send("PUT", `${base}/categories/${categoryId}/target`, cookie, { month: "2026-10", ...input });
  const assign = async (categoryId: string, m: string, assigned: string) => {
    const res = await send("PUT", `${base}/months/${m}/categories/${categoryId}`, cookie, {
      assigned,
      today: TODAY,
    });
    expect(res.status).toBe(200);
  };
  const spend = async (accountId: string, categoryId: string | null, amount: string) => {
    const res = await send("POST", `${base}/transactions`, cookie, {
      accountId,
      categoryId,
      date: "2026-10-05",
      amount,
    });
    expect(res.status).toBe(201);
  };
  const month = async (m: string) => {
    const res = await send("GET", `${base}/months/${m}?today=${TODAY}`, cookie);
    expect(res.status).toBe(200);
    return json<Month>(res);
  };
  const row = async (categoryId: string, m = "2026-10") =>
    (await month(m)).categories.find((c) => c.categoryId === categoryId);
  return {
    base,
    cookie,
    checking,
    card,
    payment,
    rent,
    phone,
    setTarget,
    assign,
    spend,
    month,
    row,
  };
}

describe("credit card payment targets", () => {
  it("pays off the balance by a month: a sixth of $120.00 by March", async () => {
    const { payment, setTarget, row } = await setup();
    const res = await setTarget(payment.id, { cadence: "payoff_by_date", dueMonth: "2027-03" });
    expect(res.status).toBe(200);
    expect((await json<Category>(res)).target).toMatchObject({
      cadence: "payoff_by_date",
      behavior: "balance",
      amount: "0",
      dueDate: "2027-03-01",
    });
    const oct = await row(payment.id);
    expect(oct?.target).toMatchObject({
      needed: "12000",
      funded: "0",
      underfunded: "2000",
      dueDate: "2027-03-01",
      snoozed: false,
    });
    // Underfunded asks the target's share, not the whole balance.
    expect(oct?.autoAssign.underfunded).toBe("2000");
    expect((await row(payment.id, "2026-11"))?.target?.underfunded).toBe("2400");
  });

  it("leaves funded card spending out and counts credit overspending at once", async () => {
    const { card, payment, rent, phone, setTarget, assign, spend, row } = await setup("10000");
    await setTarget(payment.id, { cadence: "payoff_by_date", dueMonth: "2026-12" });
    // $10.00 of funded spending, $110.00 owed: still $100.00 to go, $33.34 a month.
    await assign(rent.id, "2026-10", "1000");
    await spend(card.id, rent.id, "-1000");
    expect((await row(payment.id))?.target).toMatchObject({
      needed: "10000",
      funded: "0",
      underfunded: "3334",
    });
    // $5.00 of credit overspending: $115.00 owed beyond the $10.00, so ($105.00) ÷ 3.
    await spend(card.id, phone.id, "-500");
    expect((await row(payment.id))?.target?.underfunded).toBe("3500");
  });

  it("assigning more than the share is on track and gives the rest back", async () => {
    const { payment, setTarget, assign, row, month } = await setup("12500");
    await setTarget(payment.id, { cadence: "payoff_by_date", dueMonth: "2027-03" });
    await assign(payment.id, "2026-10", "5000");
    const oct = await row(payment.id);
    expect(oct?.target).toMatchObject({ needed: "12500", funded: "5000", underfunded: "0" });
    // Reduce Overfunding takes back what's above this month's $20.84 share.
    expect(oct?.autoAssign.reduceOverfunding).toBe("2084");
    expect((await row(payment.id, "2026-11"))?.target?.underfunded).toBe("1500");
    // The month's targets count the share; next month's ($125.00 − $50.00) ÷ 5.
    expect((await month("2026-10")).targets).toMatchObject({ month: "2084", nextMonth: "1500" });
  });

  it("pays a specific amount monthly, whatever is paid or spent", async () => {
    const { card, phone, payment, setTarget, assign, spend, row } = await setup("10000");
    const res = await setTarget(payment.id, { cadence: "payment_monthly", amount: "3000" });
    expect(res.status).toBe(200);
    expect((await json<Category>(res)).target).toMatchObject({
      cadence: "payment_monthly",
      behavior: "set_aside",
      amount: "3000",
    });
    await spend(card.id, phone.id, "-500");
    const oct = await row(payment.id);
    expect(oct?.target).toMatchObject({ needed: "3000", funded: "0", underfunded: "3000" });
    // Credit overspending on the card doesn't change what Underfunded asks.
    expect(oct?.autoAssign.underfunded).toBe("3000");
    await assign(payment.id, "2026-10", "5000");
    expect((await row(payment.id))?.autoAssign.reduceOverfunding).toBe("3000");
    expect((await row(payment.id, "2026-11"))?.target?.underfunded).toBe("3000");
  });

  it("asks nothing in months before the card was opened", async () => {
    const { payment, setTarget, row, month } = await setup("10000");
    const res = await setTarget(payment.id, {
      month: "2026-09",
      cadence: "payment_monthly",
      amount: "3000",
    });
    expect(res.status).toBe(200);
    const sep = await row(payment.id, "2026-09");
    expect(sep?.target).toMatchObject({ needed: "3000", funded: "0", underfunded: "0" });
    expect(sep?.autoAssign.underfunded).toBe("0");
    expect((await month("2026-09")).targets).toMatchObject({ month: "0", nextMonth: "3000" });
    expect((await row(payment.id))?.target).toMatchObject({ underfunded: "3000" });
    expect((await month("2026-10")).targets.month).toBe("3000");
  });

  it("still asks its share while a payment leaves the category red", async () => {
    const { base, cookie, checking, card, payment, rent, setTarget, assign, spend, row } =
      await setup("10000");
    await setTarget(payment.id, { cadence: "payoff_by_date", dueMonth: "2026-12" });
    await assign(rent.id, "2026-10", "1000");
    await spend(card.id, rent.id, "-1000");
    // A $20.00 payment from checking: −$10.00 Available, $90.00 owed, still $100.00 to go.
    const res = await send("POST", `${base}/transactions`, cookie, {
      accountId: checking.id,
      categoryId: null,
      transferAccountId: card.id,
      date: "2026-10-06",
      amount: "-2000",
    });
    expect(res.status).toBe(201);
    const oct = await row(payment.id);
    expect(oct?.available).toBe("-1000");
    // Total Underfunded counts the overpayment too: $90.00 owed − (−$10.00).
    expect(oct?.payment?.underfunded).toBe("10000");
    expect(oct?.target).toMatchObject({ needed: "8000", funded: "-2000", underfunded: "3334" });
    expect(oct?.autoAssign.underfunded).toBe("3334");
    // The overpayment doesn't roll over: November asks $90.00 ÷ 2.
    expect((await row(payment.id, "2026-11"))?.target?.underfunded).toBe("4500");
  });

  it("only payment categories take payment targets, and they can't be snoozed", async () => {
    const { base, cookie, payment, rent, setTarget } = await setup();
    const spending = await setTarget(payment.id, {
      cadence: "monthly",
      behavior: "set_aside",
      amount: "10000",
      dueDay: null,
    });
    expect(spending.status).toBe(409);
    expect((await json<ErrorBody>(spending)).error.code).toBe("MANAGED_CATEGORY");
    const onRent = await setTarget(rent.id, { cadence: "payment_monthly", amount: "3000" });
    expect(onRent.status).toBe(409);
    // No pay-off target dated before this month, even saved from that month.
    expect(
      (await setTarget(payment.id, { cadence: "payoff_by_date", dueMonth: "2026-09" })).status,
    ).toBe(400);
    expect(
      (
        await setTarget(payment.id, {
          cadence: "payoff_by_date",
          dueMonth: "2026-09",
          month: "2026-09",
        })
      ).status,
    ).toBe(400);
    expect((await setTarget(payment.id, { cadence: "payment_monthly", amount: "0" })).status).toBe(
      400,
    );
    await setTarget(payment.id, { cadence: "payment_monthly", amount: "3000" });
    const snooze = await send("PUT", `${base}/categories/${payment.id}/target/snooze`, cookie, {
      month: "2026-10",
      snoozed: true,
      today: TODAY,
    });
    expect(snooze.status).toBe(409);
  });
});
