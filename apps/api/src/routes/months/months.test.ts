import { newId } from "@strictbudget/db";
import { budgetMember, categoryAssignment, moneyMove, user } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Totals = {
  assigned: string;
  activity: string;
  cashActivity: string;
  creditActivity: string;
  available: string;
  cashOverspent: string;
  creditOverspent: string;
};
type Month = {
  month: string;
  currency: string;
  firstMonth: string;
  lastMonth: string;
  readyToAssign: string;
  readyToAssignBreakdown: Record<string, string>;
  futureMonths: { month: string; assigned: string; targets: unknown }[];
  nextMonthTargets: unknown;
  overdraft: boolean;
  assignedInFuture: string;
  futureShortfall: { month: string; readyToAssign: string } | null;
  note: string;
  categories: (Totals & {
    categoryId: string;
    payment:
      | (Record<
          | "balance"
          | "priorBalance"
          | "spendingAndOutflows"
          | "paymentsAndInflows"
          | "underfunded"
          | "overspentCategories"
          | "creditOverspending"
          | "fundedSpending"
          | "paymentsMade",
          string
        > & { hasUncategorized: boolean })
      | null;
    autoAssign: Record<string, string>;
    underfundedParts: { amount: string; step: number; date: string }[];
    upcoming: {
      amount: string;
      transactions: { date: string; accountName: string; memo: string; amount: string }[];
    } | null;
  })[];
  groups: (Totals & { groupId: string })[];
  hidden: Totals;
  uncategorized: Omit<Totals, "assigned"> | null;
  targets: { month: string; nextMonth: string };
};
type Category = { id: string; name: string };
type Group = { id: string; kind: string | null; categories: Category[] };
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
  const savings = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, cookie, {
      name: "Savings",
      type: "savings",
      balance: "0",
      date: "2026-08-20",
    }),
  );
  const { groups } = await json<{ groups: Group[] }>(
    await send("GET", `${base}/categories`, cookie),
  );
  const [bills, needs] = groups.filter((g) => !g.kind);
  const [rent, phone] = bills?.categories ?? [];
  const [groceries] = needs?.categories ?? [];
  if (!bills || !needs || !rent || !phone || !groceries) throw new Error("starter data missing");

  const spend = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions`, cookie, {
      accountId: account.id,
      categoryId: null,
      ...input,
    });
    expect(res.status).toBe(201);
  };
  const assign = (categoryId: string, month: string, amount: bigint) =>
    db.insert(categoryAssignment).values({
      id: newId(),
      budgetId: budget.id,
      categoryId,
      month: `${month}-01`,
      amount,
      currency: "USD",
    });
  const month = async (m: string, today = TODAY) => {
    const res = await send("GET", `${base}/months/${m}?today=${today}`, cookie);
    expect(res.status).toBe(200);
    const body = await json<Month>(res);
    const byCategory = (id: string) => body.categories.find((c) => c.categoryId === id);
    const byGroup = (id: string) => body.groups.find((g) => g.groupId === id);
    return { ...body, byCategory, byGroup };
  };
  const put = (categoryId: string, m: string, assigned: string, today = TODAY) =>
    send("PUT", `${base}/months/${m}/categories/${categoryId}`, cookie, { assigned, today });
  const { readyToAssignCategoryId } = await json<{ readyToAssignCategoryId: string }>(
    await send("GET", `${base}/categories`, cookie),
  );
  return {
    cookie,
    base,
    put,
    readyToAssignCategoryId,
    account,
    savings,
    bills,
    needs,
    rent,
    phone,
    groceries,
    spend,
    assign,
    month,
  };
}

const t = (assigned: string, activity: string, available: string) => ({
  assigned,
  activity,
  available,
});

/** setup() plus two credit cards, Visa (owing `visaDebt`) and Amex. */
async function cards(visaDebt = 0n) {
  const ctx = await setup();
  const card = async (name: string, debt = 0n) => {
    const acct = await json<{ id: string; paymentCategoryId: string }>(
      await send("POST", `${ctx.base}/accounts`, ctx.cookie, {
        name,
        type: "credit_card",
        balance: (-debt).toString(),
        date: "2026-08-20",
      }),
    );
    return acct;
  };
  const visa = await card("Visa", visaDebt);
  const amex = await card("Amex");
  const { groups } = await json<{ groups: Group[] }>(
    await send("GET", `${ctx.base}/categories`, ctx.cookie),
  );
  const credit = groups.find((g) => g.kind === "credit_card_payments");
  if (!credit) throw new Error("Credit Card Payments group missing");
  const create = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${ctx.base}/transactions`, ctx.cookie, {
      accountId: ctx.account.id,
      categoryId: null,
      ...input,
    });
    expect(res.status).toBe(201);
    return json<{ id: string }>(res);
  };
  return { ...ctx, visa, amex, credit, create };
}

describe("upcoming scheduled transactions", () => {
  async function scheduled() {
    const ctx = await cards();
    const schedule = async (input: Record<string, unknown>) => {
      const res = await send("POST", `${ctx.base}/scheduled-transactions`, ctx.cookie, {
        accountId: ctx.account.id,
        today: TODAY,
        ...input,
      });
      expect(res.status, await res.clone().text()).toBe(201);
    };
    return { ...ctx, schedule };
  }

  it("counts the month's occurrences after today, inflows netted, and funds what's short", async () => {
    const { schedule, month, assign, rent, phone, groceries } = await scheduled();
    await schedule({ date: "2026-10-20", amount: "-3000", categoryId: rent.id, memo: "x-a" });
    await schedule({ date: "2026-10-22", amount: "2500", categoryId: rent.id });
    await schedule({
      date: "2026-10-07",
      frequency: "weekly",
      amount: "-1000",
      categoryId: groceries.id,
    });
    await assign(phone.id, "2026-10", 5000n);
    await schedule({ date: "2026-10-20", amount: "-3000", categoryId: phone.id });

    const oct = await month("2026-10");
    // −$30.00 and +$25.00 → −$5.00, the earliest date first in Underfunded's order.
    expect(oct.byCategory(rent.id)).toMatchObject({
      upcoming: { amount: "-500" },
      autoAssign: { underfunded: "500" },
      underfundedParts: [{ amount: "500", step: 2, date: "2026-10-20" }],
    });
    expect(oct.byCategory(rent.id)?.upcoming?.transactions.map((t) => t.date)).toEqual([
      "2026-10-22",
      "2026-10-20",
    ]);
    // Weekly from 10/07, four in October, four in November.
    expect(oct.byCategory(groceries.id)?.upcoming).toMatchObject({ amount: "-4000" });
    expect((await month("2026-11")).byCategory(groceries.id)?.upcoming?.amount).toBe("-4000");
    // Covered by Available, nothing to fund.
    expect(oct.byCategory(phone.id)).toMatchObject({
      upcoming: { amount: "-3000" },
      autoAssign: { underfunded: "5000" },
    });
    expect((await month("2026-09")).byCategory(rent.id)?.upcoming).toBeNull();
  });

  it("counts split lines, card spending and card payments where they land", async () => {
    const { schedule, month, rent, phone, groceries, visa } = await scheduled();
    await schedule({
      date: "2026-10-23",
      amount: "-900",
      subtransactions: [
        { amount: "-400", categoryId: rent.id },
        { amount: "-500", categoryId: phone.id },
      ],
    });
    await schedule({
      accountId: visa.id,
      date: "2026-10-21",
      amount: "-700",
      categoryId: groceries.id,
    });
    await schedule({ date: "2026-10-21", amount: "-500", transferAccountId: visa.id });

    const oct = await month("2026-10");
    expect(oct.byCategory(rent.id)?.upcoming?.amount).toBe("-400");
    expect(oct.byCategory(phone.id)?.upcoming?.amount).toBe("-500");
    // Spending on a card counts in its category, not the card's payment category.
    expect(oct.byCategory(groceries.id)).toMatchObject({
      upcoming: { amount: "-700" },
      autoAssign: { underfunded: "700" },
    });
    // The scheduled payment comes out of the payment category.
    expect(oct.byCategory(visa.paymentCategoryId)).toMatchObject({
      upcoming: { amount: "-500", transactions: [{ date: "2026-10-21" }] },
      underfundedParts: [{ amount: "500", step: 5, date: "2026-10-21" }],
    });
  });
});

describe("budget months", () => {
  it("adds up each category's activity in the month, split lines one by one", async () => {
    const { month, spend, rent, phone, groceries, bills, savings } = await setup();
    await spend({ date: "2026-10-01", amount: "-2500", categoryId: rent.id });
    await spend({ date: "2026-10-02", amount: "-500", categoryId: rent.id });
    await spend({
      date: "2026-10-02",
      amount: "-3000",
      subtransactions: [
        { amount: "-1000", categoryId: phone.id },
        { amount: "-2000", categoryId: groceries.id },
      ],
    });
    await spend({ date: "2026-10-02", amount: "-9900", transferAccountId: savings.id });
    await spend({ date: "2026-09-30", amount: "-700", categoryId: phone.id });

    const oct = await month("2026-10");
    expect(oct.month).toBe("2026-10");
    expect(oct.currency).toBe("USD");
    expect(oct.byCategory(rent.id)).toMatchObject(t("0", "-3000", "-3000"));
    expect(oct.byCategory(phone.id)).toMatchObject(t("0", "-1000", "-1000"));
    expect(oct.byCategory(groceries.id)).toMatchObject(t("0", "-2000", "-2000"));
    expect(oct.byGroup(bills.id)).toMatchObject(t("0", "-4000", "-4000"));
    expect(oct.uncategorized).toBeNull();
  });

  it("splits activity into cash and credit spending by account", async () => {
    const { cookie, base, month, spend, phone, groceries, bills, savings } = await setup();
    const card = async (name: string) =>
      json<{ id: string }>(
        await send("POST", `${base}/accounts`, cookie, {
          name,
          type: name === "Visa" ? "credit_card" : "line_of_credit",
          balance: "0",
          date: "2026-08-20",
        }),
      );
    const visa = await card("Visa");
    const amex = await card("Amex");
    await spend({ date: "2026-10-01", amount: "-400", categoryId: phone.id });
    await spend({ date: "2026-10-01", amount: "1000", categoryId: phone.id });
    await spend({ accountId: visa.id, date: "2026-10-01", amount: "-500", categoryId: phone.id });
    await spend({ accountId: visa.id, date: "2026-10-01", amount: "200", categoryId: phone.id });
    await spend({
      accountId: visa.id,
      date: "2026-10-01",
      amount: "-600",
      subtransactions: [
        { amount: "-700", categoryId: phone.id },
        { amount: "100", categoryId: groceries.id },
      ],
    });
    await spend({ accountId: amex.id, date: "2026-10-02", amount: "-300", categoryId: phone.id });
    await spend({ accountId: amex.id, date: "2026-10-02", amount: "-100" });
    await spend({ date: "2026-10-02", amount: "-200" });
    await spend({ date: "2026-10-02", amount: "-900", transferAccountId: visa.id });
    await spend({ date: "2026-10-02", amount: "-900", transferAccountId: savings.id });
    // Future-dated card spending doesn't count yet.
    await spend({ accountId: visa.id, date: "2026-10-20", amount: "-5000", categoryId: phone.id });

    const oct = await month("2026-10");
    const split = (activity: string, cash: string, credit: string) => ({
      activity,
      cashActivity: cash,
      creditActivity: credit,
    });
    expect(oct.byCategory(phone.id)).toMatchObject(split("-700", "600", "-1300"));
    expect(oct.byCategory(groceries.id)).toMatchObject(split("100", "0", "100"));
    expect(oct.byGroup(bills.id)).toMatchObject(split("-700", "600", "-1300"));
    expect(oct.uncategorized).toMatchObject(split("-300", "-200", "-100"));
    // The "… will be deducted" note quotes only the cash part (Available −$3.00).
    expect(oct.uncategorized).toMatchObject({
      available: "-300",
      cashOverspent: "-200",
      creditOverspent: "-100",
    });
    // Observation only: Available and Ready to Assign are what they were before the split.
    expect(oct.byCategory(phone.id)).toMatchObject({ assigned: "0", available: "-700" });
    expect((await month("2026-11")).byCategory(phone.id)).toMatchObject(split("0", "0", "0"));
  });

  describe("funded card spending", () => {
    it("moves only the funded part, cash first", async () => {
      const { month, assign, create, rent, visa } = await cards();
      await assign(rent.id, "2026-10", 1000n);
      // Entered before the cash spending; cash is still funded first.
      await create({ accountId: visa.id, date: "2026-10-01", amount: "-800", categoryId: rent.id });
      await create({ date: "2026-10-02", amount: "-600", categoryId: rent.id });

      const oct = await month("2026-10");
      expect(oct.byCategory(rent.id)).toMatchObject({ activity: "-1400", available: "-400" });
      expect(oct.byCategory(visa.paymentCategoryId)).toMatchObject({
        assigned: "0",
        activity: "400",
        available: "400",
        cashActivity: "0",
        creditActivity: "0",
      });
      expect((await month("2026-11")).byCategory(visa.paymentCategoryId)).toMatchObject({
        activity: "0",
        available: "400",
      });
    });

    it("nets each card's spending and returns, and keeps cards apart", async () => {
      const { month, assign, create, phone, groceries, credit, visa, amex } = await cards();
      await assign(phone.id, "2026-10", 2000n);
      await create({
        accountId: visa.id,
        date: "2026-10-01",
        amount: "-500",
        categoryId: phone.id,
      });
      await create({ accountId: visa.id, date: "2026-10-01", amount: "200", categoryId: phone.id });
      await create({
        accountId: visa.id,
        date: "2026-10-01",
        amount: "-600",
        subtransactions: [
          { amount: "-700", categoryId: phone.id },
          { amount: "100", categoryId: groceries.id },
        ],
      });
      await create({
        accountId: amex.id,
        date: "2026-10-02",
        amount: "-300",
        categoryId: phone.id,
      });

      const oct = await month("2026-10");
      // Phone: $10 net on Visa and $3 on Amex, all funded. Groceries' +$1 return on Visa leaves
      // Visa's payment category.
      expect(oct.byCategory(visa.paymentCategoryId)).toMatchObject({ available: "900" });
      expect(oct.byCategory(amex.paymentCategoryId)).toMatchObject({ available: "300" });
      expect(oct.byCategory(phone.id)).toMatchObject({ available: "700" });
      expect(oct.byCategory(groceries.id)).toMatchObject({ available: "100" });
      expect(oct.byGroup(credit.id)).toMatchObject({ activity: "1200", available: "1200" });
      expect(oct.readyToAssign).toBe("98000");
    });

    it("funds nothing from an empty category and follows edits and deletes", async () => {
      const { cookie, base, month, assign, create, rent, visa } = await cards();
      const tx = await create({
        accountId: visa.id,
        date: "2026-10-01",
        amount: "-500",
        categoryId: rent.id,
      });
      const pay = async () =>
        (await month("2026-10")).byCategory(visa.paymentCategoryId)?.available;
      expect(await pay()).toBe("0");
      await assign(rent.id, "2026-10", 300n);
      expect(await pay()).toBe("300");
      const edit = await send("PATCH", `${base}/transactions/${tx.id}`, cookie, { amount: "-200" });
      expect(edit.status).toBe(200);
      expect(await pay()).toBe("200");
      await send("DELETE", `${base}/transactions/${tx.id}`, cookie);
      expect(await pay()).toBe("0");
    });

    it("funds the earliest purchase first", async () => {
      const { month, assign, create, rent, visa, amex } = await cards();
      await assign(rent.id, "2026-10", 500n);
      // Visa is the older card and its purchase is entered first; the date decides.
      await create({ accountId: visa.id, date: "2026-10-02", amount: "-400", categoryId: rent.id });
      await create({ accountId: amex.id, date: "2026-10-01", amount: "-300", categoryId: rent.id });
      const oct = await month("2026-10");
      expect(oct.byCategory(amex.paymentCategoryId)).toMatchObject({ available: "300" });
      expect(oct.byCategory(visa.paymentCategoryId)).toMatchObject({ available: "200" });
      expect(oct.byCategory(rent.id)).toMatchObject({ available: "-200" });
    });

    it("refills earlier unfunded card spending with a later return", async () => {
      const { month, create, rent, visa, amex } = await cards(10000n);
      await create({ accountId: amex.id, date: "2026-10-01", amount: "-300", categoryId: rent.id });
      await create({ accountId: visa.id, date: "2026-10-02", amount: "500", categoryId: rent.id });
      const oct = await month("2026-10");
      // Amex stays unfunded and keeps its overspent categories; only $2 of
      // Visa's $5 return leaves its payment category.
      expect(oct.byCategory(amex.paymentCategoryId)).toMatchObject({
        available: "0",
        payment: { overspentCategories: "300" },
      });
      expect(oct.byCategory(visa.paymentCategoryId)).toMatchObject({ available: "-200" });
      expect(oct.byCategory(rent.id)).toMatchObject({ available: "200", creditOverspent: "0" });
    });

    it("funds September's card spending from September's money only", async () => {
      const { month, assign, create, rent, visa } = await cards();
      await assign(rent.id, "2026-09", 500n);
      await create({ accountId: visa.id, date: "2026-09-10", amount: "-300", categoryId: rent.id });
      await create({ accountId: visa.id, date: "2026-10-01", amount: "-400", categoryId: rent.id });
      // September funds $3; October has the $2 left over for its $4.
      expect((await month("2026-09")).byCategory(visa.paymentCategoryId)?.available).toBe("300");
      const oct = await month("2026-10");
      expect(oct.byCategory(visa.paymentCategoryId)).toMatchObject({
        activity: "200",
        available: "500",
      });
      expect(oct.byCategory(rent.id)).toMatchObject({ available: "-200" });
    });
  });

  describe("credit overspending and existing debt", () => {
    const over = (cash: string, credit: string) => ({
      cashOverspent: cash,
      creditOverspent: credit,
    });

    it("keeps credit overspending out of next month's Ready to Assign", async () => {
      const { month, assign, create, rent, phone, visa } = await cards();
      await assign(rent.id, "2026-10", 1000n);
      // Rent $10, Wallet −$6, Visa −$8 → −$4 credit; Phone −$25 cash.
      await create({ date: "2026-10-01", amount: "-600", categoryId: rent.id });
      await create({ accountId: visa.id, date: "2026-10-01", amount: "-800", categoryId: rent.id });
      await create({ date: "2026-10-01", amount: "-2500", categoryId: phone.id });

      const oct = await month("2026-10");
      expect(oct.byCategory(rent.id)).toMatchObject({ available: "-400", ...over("0", "-400") });
      expect(oct.byCategory(phone.id)).toMatchObject(over("-2500", "0"));
      expect(oct.readyToAssign).toBe("99000");
      // Only the $25 of cash overspending comes out of November.
      expect((await month("2026-11")).readyToAssign).toBe("96500");
    });

    it("splits a mixed shortfall cash first", async () => {
      const { month, put, create, rent, visa } = await cards();
      await create({ date: "2026-10-01", amount: "-300", categoryId: rent.id });
      await create({ accountId: visa.id, date: "2026-10-01", amount: "-200", categoryId: rent.id });
      const check = async (cash: string, credit: string, funded: string, november: string) => {
        const oct = await month("2026-10");
        expect(oct.byCategory(rent.id)).toMatchObject(over(cash, credit));
        expect(oct.byCategory(visa.paymentCategoryId)?.available).toBe(funded);
        expect((await month("2026-11")).readyToAssign).toBe(november);
      };
      await check("-300", "-200", "0", "99700");
      await put(rent.id, "2026-10", "200");
      await check("-100", "-200", "0", "99700");
      await put(rent.id, "2026-10", "400");
      await check("0", "-100", "100", "99600");
    });

    it("moves money on when credit overspending is covered, even in a past month", async () => {
      const { month, assign, create, rent, visa } = await cards();
      // −$5 on the card in September, covered in September afterwards.
      await create({ accountId: visa.id, date: "2026-09-15", amount: "-500", categoryId: rent.id });
      expect((await month("2026-09")).byCategory(rent.id)).toMatchObject(over("0", "-500"));
      // It doesn't roll over, and October's Ready to Assign doesn't lose it.
      const before = await month("2026-10");
      expect(before.byCategory(rent.id)?.available).toBe("0");
      expect(before.readyToAssign).toBe("100000");
      await assign(rent.id, "2026-09", 500n);
      const oct = await month("2026-10");
      expect(oct.byCategory(visa.paymentCategoryId)?.available).toBe("500");
    });

    it("reports what each card owes against what's set aside", async () => {
      // Visa starts with $100 of old debt.
      const { month, put, create, rent, visa, amex } = await cards(10000n);
      await create({ accountId: visa.id, date: "2026-10-01", amount: "-400", categoryId: rent.id });
      await put(rent.id, "2026-10", "200");
      const pay = async () => (await month("2026-10")).byCategory(visa.paymentCategoryId);

      // $2 funded of $4: $2 credit overspending plus $100 of old debt is underfunded.
      expect(await pay()).toMatchObject({
        available: "200",
        payment: { balance: "-10400", underfunded: "10200", overspentCategories: "200" },
      });
      // Old debt is funded by assigning straight to the payment category (from Ready to Assign).
      const res = await put(visa.paymentCategoryId, "2026-10", "1000");
      expect(res.status).toBe(200);
      expect(await pay()).toMatchObject({
        assigned: "1000",
        available: "1200",
        payment: { underfunded: "9200", overspentCategories: "200" },
      });
      expect((await month("2026-10")).readyToAssign).toBe("98800");
      // Nothing owed: nothing underfunded. Other categories have no payment details.
      expect((await month("2026-10")).byCategory(amex.paymentCategoryId)?.payment).toMatchObject({
        balance: "0",
        underfunded: "0",
        overspentCategories: "0",
      });
      expect((await month("2026-10")).byCategory(rent.id)?.payment).toBeNull();
    });

    it("reports the card's raw credit overspending for its register", async () => {
      // Rent has $1, the card spends $3 in it ($2 overspent).
      const { month, put, create, rent, visa } = await cards();
      await put(rent.id, "2026-10", "100");
      await create({ accountId: visa.id, date: "2026-10-01", amount: "-300", categoryId: rent.id });
      const pay = async () => (await month("2026-10")).byCategory(visa.paymentCategoryId)?.payment;
      expect(await pay()).toMatchObject({ overspentCategories: "200", creditOverspending: "200" });
      // $5 straight to the payment category covers the card: the inspector's Overspent
      // Categories drops to $0, the register's Overspending (Oct) stays $2.00.
      await put(visa.paymentCategoryId, "2026-10", "500");
      expect(await pay()).toMatchObject({ overspentCategories: "0", creditOverspending: "200" });
      // Covering Rent clears it; September's overspending isn't October's.
      await put(rent.id, "2026-10", "300");
      await create({ accountId: visa.id, date: "2026-09-20", amount: "-400", categoryId: rent.id });
      expect(await pay()).toMatchObject({ creditOverspending: "0" });
    });
  });

  describe("payments, returns and statement credits", () => {
    it("takes payments out of the payment category", async () => {
      const { month, put, create, rent, visa } = await cards();
      await put(rent.id, "2026-10", "1400");
      await create({
        accountId: visa.id,
        date: "2026-10-01",
        amount: "-1400",
        categoryId: rent.id,
      });
      await create({ date: "2026-10-02", amount: "-600", transferAccountId: visa.id });

      const oct = await month("2026-10");
      expect(oct.byCategory(visa.paymentCategoryId)).toMatchObject({
        activity: "800",
        available: "800",
        payment: {
          balance: "-800",
          priorBalance: "0",
          spendingAndOutflows: "-1400",
          paymentsAndInflows: "600",
          underfunded: "0",
          fundedSpending: "1400",
          paymentsMade: "-600",
        },
      });
      // Money only left the budget's cash account and the payment category: Ready to Assign holds.
      expect(oct.readyToAssign).toBe("98600");
      // What's left rolls over; the next month's breakdown starts from the prior balance.
      const nov = await month("2026-11");
      expect(nov.byCategory(visa.paymentCategoryId)).toMatchObject({
        available: "800",
        payment: { priorBalance: "-800", spendingAndOutflows: "0", paymentsMade: "0" },
      });
    });

    it("lists the card's month in its payment category's activity", async () => {
      const { cookie, base, put, create, rent, visa } = await cards(1000n);
      await put(rent.id, "2026-10", "500");
      await create({ accountId: visa.id, date: "2026-10-01", amount: "-500", categoryId: rent.id });
      await create({ date: "2026-10-02", amount: "-300", transferAccountId: visa.id });
      await create({ accountId: visa.id, date: "2026-09-30", amount: "-100", categoryId: rent.id });
      await create({
        accountId: visa.id,
        date: "2026-10-02",
        amount: "-80",
        categoryId: null,
        subtransactions: [
          { amount: "-50", categoryId: rent.id },
          { amount: "-30", categoryId: rent.id },
        ],
      });
      const res = await send(
        "GET",
        `${base}/months/2026-10/activity?categoryId=${visa.paymentCategoryId}&today=${TODAY}`,
        cookie,
      );
      expect(res.status).toBe(200);
      const { transactions } = await json<{
        transactions: { amount: string; categoryName: string | null }[];
      }>(res);
      // The purchase, the split's lines and the payment; not September's or the Starting Balance.
      expect(transactions.map((t) => t.amount).sort()).toEqual(["-30", "-50", "-500", "300"]);
      // "Group: Category"; the payment shows the payment category.
      expect(transactions.find((t) => t.amount === "-500")?.categoryName).toMatch(/: /);
      expect(transactions.find((t) => t.amount === "300")?.categoryName).toBe(
        "Credit Card Payments: Visa",
      );
    });

    it("goes red when more is paid than set aside, and takes it from next month", async () => {
      const { month, create, visa } = await cards(1000n);
      // $10 of old debt, nothing set aside, $10 paid: more than was set aside.
      await create({ date: "2026-10-02", amount: "-1000", transferAccountId: visa.id });
      const oct = await month("2026-10");
      expect(oct.byCategory(visa.paymentCategoryId)).toMatchObject({
        available: "-1000",
        cashOverspent: "-1000",
        creditOverspent: "0",
        payment: { balance: "0", underfunded: "0" },
      });
      expect(oct.readyToAssign).toBe("100000");
      const nov = await month("2026-11");
      expect(nov.byCategory(visa.paymentCategoryId)?.available).toBe("0");
      expect(nov.readyToAssign).toBe("99000");
    });

    it("counts a split's transfer line as a payment, and only from budget accounts", async () => {
      const { cookie, base, month, create, visa } = await cards(2000n);
      await create({
        date: "2026-10-02",
        amount: "-1000",
        subtransactions: [
          { amount: "-700", transferAccountId: visa.id },
          { amount: "-300", categoryId: null },
        ],
      });
      const asset = await json<{ id: string }>(
        await send("POST", `${base}/accounts`, cookie, {
          name: "House",
          type: "asset",
          balance: "100000",
          date: "2026-08-20",
        }),
      );
      // From a tracking account: no payment. Its card side is Uncategorized, a return like any
      // other, so it takes its $5 out of the payment category.
      await create({
        accountId: asset.id,
        date: "2026-10-02",
        amount: "-500",
        transferAccountId: visa.id,
      });
      const pay = (await month("2026-10")).byCategory(visa.paymentCategoryId);
      expect(pay).toMatchObject({
        available: "-1200",
        payment: { paymentsMade: "-700", fundedSpending: "-500", balance: "-800" },
      });
    });

    it("treats a categorized transfer from a tracking account as a refund", async () => {
      const { cookie, base, month, create, rent, visa, readyToAssignCategoryId } =
        await cards(2000n);
      const asset = await json<{ id: string }>(
        await send("POST", `${base}/accounts`, cookie, {
          name: "House",
          type: "asset",
          balance: "100000",
          date: "2026-08-20",
        }),
      );
      // Into Inflow: Ready to Assign it only lowers what's owed, like a statement credit.
      await create({
        accountId: visa.id,
        date: "2026-10-02",
        amount: "200",
        transferAccountId: asset.id,
        categoryId: readyToAssignCategoryId,
      });
      // Into a spending category it moves money from the payment category, like a refund.
      await create({
        accountId: visa.id,
        date: "2026-10-02",
        amount: "500",
        transferAccountId: asset.id,
        categoryId: rent.id,
      });
      const oct = await month("2026-10");
      expect(oct.byCategory(visa.paymentCategoryId)).toMatchObject({
        available: "-500",
        payment: { paymentsMade: "0", balance: "-1300" },
      });
      expect(oct.byCategory(rent.id)).toMatchObject({ available: "500" });
    });

    it("leaves the payment category alone for statement credits and cash advances", async () => {
      const { month, put, create, rent, visa, account, readyToAssignCategoryId } = await cards();
      await put(rent.id, "2026-10", "500");
      await create({ accountId: visa.id, date: "2026-10-01", amount: "-500", categoryId: rent.id });
      // A statement credit to Ready to Assign only lowers what's owed.
      await create({
        accountId: visa.id,
        date: "2026-10-01",
        amount: "200",
        categoryId: readyToAssignCategoryId,
      });
      // A cash advance (card → budget account) raises it, with nothing set aside.
      await create({
        accountId: visa.id,
        date: "2026-10-02",
        amount: "-100",
        transferAccountId: account.id,
      });
      const oct = await month("2026-10");
      expect(oct.byCategory(visa.paymentCategoryId)).toMatchObject({
        available: "500",
        payment: { paymentsMade: "0", paymentsAndInflows: "200" },
      });
    });

    it("keeps a refund to a paid-off card out of the payment category", async () => {
      const { month, put, create, rent, visa } = await cards();
      await put(rent.id, "2026-09", "1000");
      await create({
        accountId: visa.id,
        date: "2026-09-10",
        amount: "-1000",
        categoryId: rent.id,
      });
      // Paid off in September, then refunded in October: the card is above zero, so the refund is
      // cash and stays out of the payment category.
      await create({ date: "2026-09-20", amount: "-1000", transferAccountId: visa.id });
      await create({ accountId: visa.id, date: "2026-10-01", amount: "1000", categoryId: rent.id });
      const oct = await month("2026-10");
      expect(oct.byCategory(rent.id)).toMatchObject({ available: "1000", cashActivity: "1000" });
      expect(oct.byCategory(visa.paymentCategoryId)).toMatchObject({
        available: "0",
        payment: { fundedSpending: "0", balance: "1000" },
      });
      expect(oct.readyToAssign).toBe((await month("2026-09")).readyToAssign);
    });
  });

  describe("positive card balances", () => {
    it("adds an overpayment above zero to Ready to Assign", async () => {
      const { month, create, amex } = await cards();
      const before = (await month("2026-09")).readyToAssign;
      await create({ date: "2026-09-05", amount: "-1000", transferAccountId: amex.id });
      const sep = await month("2026-09");
      expect(BigInt(sep.readyToAssign) - BigInt(before)).toBe(1000n);
      // The payment category is overpaid: red, and October gives the $10 back.
      expect(sep.byCategory(amex.paymentCategoryId)).toMatchObject({
        available: "-1000",
        cashOverspent: "-1000",
      });
      expect((await month("2026-10")).readyToAssign).toBe(before);
    });

    it("makes spending on a positive card cash, from the day after the payment", async () => {
      const { month, create, rent, phone, visa, amex } = await cards();
      // Paid on 09/03, spent on 09/05: cash overspending, deducted in October.
      await create({ date: "2026-09-03", amount: "-1000", transferAccountId: amex.id });
      await create({ accountId: amex.id, date: "2026-09-05", amount: "-400", categoryId: rent.id });
      // Paid and spent on 09/05: the spending counts first, so it's credit.
      await create({ date: "2026-09-05", amount: "-1000", transferAccountId: visa.id });
      await create({
        accountId: visa.id,
        date: "2026-09-05",
        amount: "-400",
        categoryId: phone.id,
      });
      const sep = await month("2026-09");
      expect(sep.byCategory(rent.id)).toMatchObject({
        cashActivity: "-400",
        creditActivity: "0",
        cashOverspent: "-400",
      });
      expect(sep.byCategory(phone.id)).toMatchObject({
        creditActivity: "-400",
        creditOverspent: "-400",
      });
      expect(sep.byCategory(amex.paymentCategoryId)?.available).toBe("-1000");
      expect(sep.byCategory(visa.paymentCategoryId)?.available).toBe("-1000");
      // October gets back both overpayments and loses the cash overspending: +$20 above zero in
      // September less $4 for Visa's credit spending, then −$20 overpaid and −$4 cash overspent.
      const oct = await month("2026-10");
      expect(BigInt(oct.readyToAssign) - BigInt(sep.readyToAssign)).toBe(-2000n - 400n);
    });

    it("splits spending that crosses zero, uncategorized included", async () => {
      const { month, create, rent, amex } = await cards();
      await create({ date: "2026-09-01", amount: "-500", transferAccountId: amex.id });
      await create({ accountId: amex.id, date: "2026-09-02", amount: "-400" });
      await create({ accountId: amex.id, date: "2026-09-03", amount: "-300", categoryId: rent.id });
      const sep = await month("2026-09");
      expect(sep.uncategorized).toMatchObject({ cashActivity: "-400", cashOverspent: "-400" });
      expect(sep.byCategory(rent.id)).toMatchObject({
        cashActivity: "-100",
        creditActivity: "-200",
        cashOverspent: "-100",
        creditOverspent: "-200",
      });
    });

    it("counts card money to Ready to Assign only above zero", async () => {
      const { month, create, readyToAssignCategoryId, visa, amex } = await cards(500n);
      const before = BigInt((await month("2026-09")).readyToAssign);
      // A statement credit on Visa (owing $5) lowers the debt only.
      await create({
        accountId: visa.id,
        date: "2026-09-05",
        amount: "200",
        categoryId: readyToAssignCategoryId,
      });
      expect(BigInt((await month("2026-09")).readyToAssign)).toBe(before);
      // Amex at +$3, $5 out to Ready to Assign: −$3.
      await create({ date: "2026-09-01", amount: "-300", transferAccountId: amex.id });
      await create({
        accountId: amex.id,
        date: "2026-09-06",
        amount: "-500",
        categoryId: readyToAssignCategoryId,
      });
      expect(BigInt((await month("2026-09")).readyToAssign)).toBe(before);
    });

    it("adds a cash advance's new debt to Ready to Assign", async () => {
      const { month, create, account, visa, amex } = await cards(500n);
      const before = BigInt((await month("2026-09")).readyToAssign);
      // Visa owes $5: a $3 advance is all new debt.
      await create({
        accountId: visa.id,
        date: "2026-09-05",
        amount: "-300",
        transferAccountId: account.id,
      });
      expect(BigInt((await month("2026-09")).readyToAssign) - before).toBe(300n);
      // Amex at +$6 moving $8: +$6 for the overpayment, then +$2 of new debt.
      await create({ date: "2026-09-01", amount: "-600", transferAccountId: amex.id });
      await create({
        accountId: amex.id,
        date: "2026-09-06",
        amount: "-800",
        transferAccountId: account.id,
      });
      expect(BigInt((await month("2026-09")).readyToAssign) - before).toBe(300n + 600n + 200n);
      expect((await month("2026-09")).byCategory(amex.paymentCategoryId)?.available).toBe("-600");
    });

    it("pays down debt with a return first, the rest is cash", async () => {
      const { month, create, rent, visa } = await cards(300n);
      const before = (await month("2026-09")).readyToAssign;
      await create({ accountId: visa.id, date: "2026-09-09", amount: "500", categoryId: rent.id });
      const sep = await month("2026-09");
      expect(sep.byCategory(rent.id)).toMatchObject({ available: "500", cashActivity: "200" });
      expect(sep.byCategory(visa.paymentCategoryId)).toMatchObject({
        available: "-300",
        payment: { fundedSpending: "-300" },
      });
      expect(sep.readyToAssign).toBe(before);
    });

    it("pays another card from the part above zero only", async () => {
      const { month, create, visa, amex } = await cards(2000n);
      const before = BigInt((await month("2026-09")).readyToAssign);
      // Amex at +$10 sends $6 to Visa (owing $20): a $6 payment, nothing to Ready to Assign.
      await create({ date: "2026-09-01", amount: "-1000", transferAccountId: amex.id });
      await create({
        accountId: amex.id,
        date: "2026-09-03",
        amount: "-600",
        transferAccountId: visa.id,
      });
      let sep = await month("2026-09");
      expect(BigInt(sep.readyToAssign) - before).toBe(1000n);
      expect(sep.byCategory(visa.paymentCategoryId)).toMatchObject({
        available: "-600",
        payment: { paymentsMade: "-600" },
      });
      // Visa (owing $14) sends $8 to Amex (+$4): new debt; Amex goes to +$12, so $8 more
      // above zero for Ready to Assign, and no payment.
      await create({
        accountId: visa.id,
        date: "2026-09-05",
        amount: "-800",
        transferAccountId: amex.id,
      });
      sep = await month("2026-09");
      expect(BigInt(sep.readyToAssign) - before).toBe(1000n + 800n);
      expect(sep.byCategory(amex.paymentCategoryId)?.payment).toMatchObject({
        paymentsMade: "-1000",
      });
      expect(sep.byCategory(visa.paymentCategoryId)?.payment).toMatchObject({
        paymentsMade: "-600",
      });
    });

    it("funds and returns card money through Uncategorized like any category", async () => {
      const { month, spend, create, visa } = await cards(2000n);
      // $7 in Uncategorized from an uncategorized inflow.
      await spend({ date: "2026-09-02", amount: "700" });
      await create({ accountId: visa.id, date: "2026-09-09", amount: "-300" });
      let sep = await month("2026-09");
      expect(sep.byCategory(visa.paymentCategoryId)?.available).toBe("300");
      expect(sep.uncategorized).toMatchObject({ available: "400" });
      // An uncategorized return takes its money back out.
      await create({ accountId: visa.id, date: "2026-09-10", amount: "500" });
      sep = await month("2026-09");
      expect(sep.byCategory(visa.paymentCategoryId)?.available).toBe("-200");
      expect(sep.uncategorized).toMatchObject({ available: "900" });
    });

    // A plain uncategorized inflow and an uncategorized transfer from a tracking account both act as a
    // return in Uncategorized. It refills Uncategorized's unfunded card spending first (Amex's
    // −$1), takes the rest of what pays down debt out of the payment category, and Uncategorized
    // keeps what's left into the next month.
    it.each([
      ["a plain inflow", false],
      ["a transfer from a tracking account", true],
    ])("treats an uncategorized card inflow as a return in Uncategorized: %s", async (_, track) => {
      const { cookie, base, month, spend, create, visa, amex } = await cards(2000n);
      const asset = await json<{ id: string }>(
        await send("POST", `${base}/accounts`, cookie, {
          name: "House",
          type: "asset",
          balance: "100000",
          date: "2026-08-20",
        }),
      );
      const today = "2026-10-20";
      await spend({ date: "2026-10-02", amount: "-200" });
      await create({ accountId: amex.id, date: "2026-10-03", amount: "-100" });
      const before = await month("2026-11", today);
      const inflow = (amount: string) =>
        create({
          accountId: visa.id,
          date: "2026-10-14",
          amount,
          ...(track ? { transferAccountId: asset.id } : {}),
        });

      // $5 on a card owing $20: $1 refills Amex's unfunded spending (which stays unfunded), $4
      // leaves Visa's payment.
      const first = await inflow("500");
      let oct = await month("2026-10", today);
      expect(oct.byCategory(visa.paymentCategoryId)?.available).toBe("-400");
      expect(oct.byCategory(amex.paymentCategoryId)?.available).toBe("0");
      expect(oct.uncategorized).toMatchObject({ available: "200" });
      // November: Uncategorized's $2 cash overspending is gone, the payment's −$4 is deducted.
      let nov = await month("2026-11", today);
      expect(BigInt(nov.readyToAssign) - BigInt(before.readyToAssign)).toBe(-200n);

      // $25: $20 pays down the debt ($19 out of the payment), the $5 above zero is cash.
      expect((await send("DELETE", `${base}/transactions/${first.id}`, cookie)).status).toBe(204);
      await inflow("2500");
      oct = await month("2026-10", today);
      expect(oct.byCategory(visa.paymentCategoryId)?.available).toBe("-1900");
      expect(oct.uncategorized).toMatchObject({ available: "2200" });
      nov = await month("2026-11", today);
      expect(BigInt(nov.readyToAssign) - BigInt(before.readyToAssign)).toBe(-1700n);
      // Uncategorized carries its $22 into November: $22 of uncategorized spending is covered.
      await spend({ date: "2026-11-02", amount: "-2200" });
      nov = await month("2026-11", "2026-11-05");
      expect(nov.uncategorized).toMatchObject({ available: "0", cashOverspent: "0" });
    });

    it("gives a split's cash part to its lines in order", async () => {
      const { month, create, rent, phone, amex } = await cards();
      await create({ date: "2026-09-01", amount: "-500", transferAccountId: amex.id });
      // Amex at +$5: the first line (Phone, the smaller) takes $3 of cash, Rent gets $2 cash and
      // $3 credit; largest-first would have given Rent all $5.
      await create({
        accountId: amex.id,
        date: "2026-09-03",
        amount: "-800",
        subtransactions: [
          { amount: "-300", categoryId: phone.id },
          { amount: "-500", categoryId: rent.id },
        ],
      });
      const sep = await month("2026-09");
      expect(sep.byCategory(phone.id)).toMatchObject({ cashActivity: "-300", creditActivity: "0" });
      expect(sep.byCategory(rent.id)).toMatchObject({
        cashActivity: "-200",
        creditActivity: "-300",
      });
    });

    it("funds equal same-day purchases in the order they were entered", async () => {
      const { month, assign, create, rent, visa, amex } = await cards();
      await assign(rent.id, "2026-09", 500n);
      // Amex's purchase is entered first, so its id is smaller: it's funded first.
      await create({ accountId: amex.id, date: "2026-09-06", amount: "-400", categoryId: rent.id });
      await create({ accountId: visa.id, date: "2026-09-06", amount: "-400", categoryId: rent.id });
      const sep = await month("2026-09");
      expect(sep.byCategory(amex.paymentCategoryId)?.available).toBe("400");
      expect(sep.byCategory(visa.paymentCategoryId)?.available).toBe("100");
    });

    it("closes a positive card out of Ready to Assign once, and keeps its payment category", async () => {
      const { cookie, base, month, create, amex } = await cards();
      await create({ date: "2026-09-01", amount: "-1000", transferAccountId: amex.id });
      const open = (await month("2026-09")).readyToAssign;
      const res = await send("POST", `${base}/accounts/${amex.id}/close`, cookie, {
        date: "2026-09-10",
      });
      expect(res.status).toBe(200);
      const sep = await month("2026-09");
      // A card at +$10 closed → Ready to Assign −$10; the payment category stays at −$10.
      expect(BigInt(sep.readyToAssign) - BigInt(open)).toBe(-1000n);
      expect(sep.byCategory(amex.paymentCategoryId)?.available).toBe("-1000");
      const { groups } = await json<{
        groups: { categories: { id: string; hidden: boolean }[] }[];
      }>(await send("GET", `${base}/categories`, cookie));
      const payment = groups
        .flatMap((g) => g.categories)
        .find((c) => c.id === amex.paymentCategoryId);
      expect(payment?.hidden).toBe(false);
    });
  });

  it("leaves transactions dated after the user's today out", async () => {
    const { month, spend, rent } = await setup();
    await spend({ date: "2026-10-20", amount: "-2500", categoryId: rent.id });
    expect((await month("2026-10")).byCategory(rent.id)).toMatchObject(t("0", "0", "0"));
    expect((await month("2026-10", "2026-10-20")).byCategory(rent.id)).toMatchObject(
      t("0", "-2500", "-2500"),
    );
  });

  it("rolls available over and starts the month after overspending at zero", async () => {
    const { month, spend, assign, rent, phone } = await setup();
    await assign(rent.id, "2026-09", 10000n);
    await spend({ date: "2026-09-10", amount: "-2500", categoryId: rent.id });
    await spend({ date: "2026-09-10", amount: "-400", categoryId: phone.id });
    await assign(rent.id, "2026-10", 1000n);
    await spend({ date: "2026-10-01", amount: "-500", categoryId: rent.id });

    const sep = await month("2026-09");
    expect(sep.byCategory(rent.id)).toMatchObject(t("10000", "-2500", "7500"));
    expect(sep.byCategory(phone.id)).toMatchObject(t("0", "-400", "-400"));

    const oct = await month("2026-10");
    expect(oct.byCategory(rent.id)).toMatchObject(t("1000", "-500", "8000"));
    expect(oct.byCategory(phone.id)).toMatchObject(t("0", "0", "0"));

    // Future months carry what's left.
    expect((await month("2026-11")).byCategory(rent.id)).toMatchObject(t("0", "0", "8000"));
  });

  it("tells an overdraft from money assigned beyond what there is", async () => {
    const { month, assign, spend, rent, groceries } = await setup();
    await assign(rent.id, "2026-10", 80000n);
    expect((await month("2026-10")).overdraft).toBe(false);
    // $1,000 of income, $800 assigned, $999 overspent in September: −$799.00, which Rent's $800
    // could still cover.
    await spend({ date: "2026-09-15", amount: "-99900", categoryId: groceries.id });
    const oct = await month("2026-10");
    expect(oct.readyToAssign).toBe("-79900");
    expect(oct.overdraft).toBe(false);
    // $5 of cash overspending in October leaves the categories $4 short.
    await spend({ date: "2026-10-02", amount: "-500", categoryId: groceries.id });
    expect((await month("2026-10")).overdraft).toBe(true);
  });

  it("keeps hidden categories out of their group's totals", async () => {
    const { cookie, base, month, spend, rent, phone, groceries, bills, needs } = await setup();
    await spend({ date: "2026-10-01", amount: "-2500", categoryId: rent.id });
    await spend({ date: "2026-10-01", amount: "-100", categoryId: phone.id });
    await spend({ date: "2026-10-01", amount: "-40", categoryId: groceries.id });
    await send("PATCH", `${base}/categories/${rent.id}`, cookie, { hidden: true });
    await send("PATCH", `${base}/category-groups/${needs.id}`, cookie, { hidden: true });

    const oct = await month("2026-10");
    expect(oct.byGroup(bills.id)).toMatchObject(t("0", "-100", "-100"));
    expect(oct.hidden).toMatchObject(t("0", "-2540", "-2540"));
    expect(oct.byCategory(rent.id)).toMatchObject(t("0", "-2500", "-2500"));
  });

  it("shows uncategorized spending only in months that have some", async () => {
    const { month, spend } = await setup();
    await spend({ date: "2026-10-01", amount: "-200" });
    expect((await month("2026-10")).uncategorized).toEqual({
      activity: "-200",
      cashActivity: "-200",
      creditActivity: "0",
      available: "-200",
      cashOverspent: "-200",
      creditOverspent: "0",
    });
    expect((await month("2026-11")).uncategorized).toBeNull();
  });

  it("runs from the month before the oldest transaction to the month after today's", async () => {
    const { month, assign, rent } = await setup();
    expect(await month("2026-10")).toMatchObject({ firstMonth: "2026-07", lastMonth: "2026-11" });
    // A month with money assigned (even $0) opens the one after it.
    await assign(rent.id, "2026-11", 0n);
    expect(await month("2026-10")).toMatchObject({ lastMonth: "2026-12" });
  });

  it("lists every group, empty ones included, and no internal categories", async () => {
    const { cookie, base, month } = await setup();
    const group = await json<{ id: string }>(
      await send("POST", `${base}/category-groups`, cookie, { name: "Empty" }),
    );
    const oct = await month("2026-10");
    expect(oct.byGroup(group.id)).toMatchObject(t("0", "0", "0"));
    const { groups } = await json<{ groups: Group[] }>(
      await send("GET", `${base}/categories`, cookie),
    );
    const listed = groups.flatMap((g) => g.categories.map((c) => c.id)).sort();
    expect(oct.categories.map((c) => c.categoryId).sort()).toEqual(listed);
  });

  it("refuses bad months and non-members", async () => {
    const { cookie, base } = await setup();
    const bad = await send("GET", `${base}/months/2026-13`, cookie);
    expect(bad.status).toBe(400);
    const other = await signUp(app);
    const res = await send("GET", `${base}/months/2026-10`, other.cookie);
    expect(res.status).toBe(404);
    expect((await json<ErrorBody>(res)).error.code).toBe("NOT_FOUND");
  });

  describe("assigning and Ready to Assign", () => {
    // The budget starts with $1,000.00 of income (Checking's starting balance, August 20).
    it("starts with the budget's income ready to assign", async () => {
      const { month } = await setup();
      expect(await month("2026-10")).toMatchObject({
        readyToAssign: "100000",
        assignedInFuture: "0",
        futureMonths: [],
      });
    });

    it("assigns money, replacing the category's amount", async () => {
      const { put, month, rent, bills } = await setup();
      const res = await put(rent.id, "2026-10", "25000");
      expect(res.status).toBe(200);
      const body = await json<Month>(res);
      expect(body.readyToAssign).toBe("75000");
      expect(body.categories.find((c) => c.categoryId === rent.id)).toMatchObject(
        t("25000", "0", "25000"),
      );
      await put(rent.id, "2026-10", "10000");
      const oct = await month("2026-10");
      expect(oct.byCategory(rent.id)).toMatchObject(t("10000", "0", "10000"));
      expect(oct.byGroup(bills.id)).toMatchObject(t("10000", "0", "10000"));
      expect(oct.readyToAssign).toBe("90000");
      // What's left rolls into November; Ready to Assign stays.
      const nov = await month("2026-11");
      expect(nov.byCategory(rent.id)).toMatchObject(t("0", "0", "10000"));
      expect(nov.readyToAssign).toBe("90000");
    });

    it("takes last month's overspending out of this month", async () => {
      const { spend, month } = await setup();
      await spend({ date: "2026-09-10", amount: "-2500" });
      expect((await month("2026-09")).readyToAssign).toBe("100000");
      expect((await month("2026-10")).readyToAssign).toBe("97500");
    });

    it("counts money assigned in later months, without pushing a month below zero", async () => {
      const { put, month, rent, phone } = await setup();
      await put(rent.id, "2026-10", "5000");
      await put(phone.id, "2026-11", "2000");
      expect(await month("2026-10")).toMatchObject({
        readyToAssign: "93000",
        assignedInFuture: "2000",
        futureMonths: [{ month: "2026-11", assigned: "2000" }],
      });
      expect((await month("2026-11")).readyToAssign).toBe("93000");

      await put(phone.id, "2026-11", "120000");
      expect((await month("2026-10")).readyToAssign).toBe("0");
      // November assigned more than there is.
      expect((await month("2026-11")).readyToAssign).toBe("-25000");
      // The current month names the first later month that's short.
      await put(rent.id, "2026-12", "1000");
      expect((await month("2026-10")).futureShortfall).toEqual({
        month: "2026-11",
        readyToAssign: "-25000",
      });
      await put(phone.id, "2026-11", "0");
      expect((await month("2026-10")).futureShortfall).toBeNull();
    });

    it("keeps a note per month", async () => {
      const { cookie, base, month } = await setup();
      const setNote = (m: string, note: string) =>
        send("PUT", `${base}/months/${m}/note`, cookie, { note });
      expect((await setNote("2026-10", "Rent due early")).status).toBe(200);
      expect((await month("2026-10")).note).toBe("Rent due early");
      expect((await month("2026-11")).note).toBe("");
      await setNote("2026-10", "Rent paid");
      expect((await month("2026-10")).note).toBe("Rent paid");
      await setNote("2026-10", "  ");
      expect((await month("2026-10")).note).toBe("");
      const other = await signUp(app);
      expect(
        (await send("PUT", `${base}/months/2026-10/note`, other.cookie, { note: "x" })).status,
      ).toBe(404);
    });

    it("leaves income dated after today out", async () => {
      const { spend, month, readyToAssignCategoryId } = await setup();
      await spend({ date: "2026-10-20", amount: "50000", categoryId: readyToAssignCategoryId });
      expect((await month("2026-10")).readyToAssign).toBe("100000");
      expect((await month("2026-10", "2026-10-20")).readyToAssign).toBe("150000");
    });

    it("keeps a month open after its money is taken back out", async () => {
      const { put, month, rent } = await setup();
      expect((await put(rent.id, "2026-11", "100")).status).toBe(200);
      expect((await month("2026-10")).lastMonth).toBe("2026-12");
      await put(rent.id, "2026-11", "0");
      expect((await month("2026-10")).lastMonth).toBe("2026-12");
    });

    it("refuses months the budget doesn't show, internal categories and outsiders", async () => {
      const { put, rent, readyToAssignCategoryId, base } = await setup();
      const late = await put(rent.id, "2026-12", "100");
      expect(late.status).toBe(400);
      expect((await json<ErrorBody>(late)).error.code).toBe("MONTH_OUT_OF_RANGE");
      expect((await put(rent.id, "2026-06", "100")).status).toBe(400);
      expect((await put(readyToAssignCategoryId, "2026-10", "100")).status).toBe(404);
      expect((await put(rent.id, "2026-10", "1.5")).status).toBe(400);
      const other = await signUp(app);
      const res = await send("PUT", `${base}/months/2026-10/categories/${rent.id}`, other.cookie, {
        assigned: "100",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("moving money", () => {
    type Move = {
      kind: string;
      fromCategoryId: string | null;
      toCategoryId: string | null;
      fromDeletedCategory: string | null;
      toDeletedCategory: string | null;
      deletion: boolean;
      month: string;
      amount: string;
      autoAssign: { batchId: string; method: string } | null;
      userId: string | null;
      userName: string | null;
      memberRole: string | null;
    };

    async function moveSetup() {
      const ctx = await setup();
      const move = (fromCategoryId: string, toCategoryId: string, amount: string, m = "2026-10") =>
        send("POST", `${ctx.base}/months/${m}/moves`, ctx.cookie, {
          fromCategoryId,
          toCategoryId,
          amount,
          today: TODAY,
        });
      const moves = async () =>
        (await json<{ moves: Move[] }>(await send("GET", `${ctx.base}/moves`, ctx.cookie))).moves;
      return { ...ctx, move, moves };
    }

    it("covers overspending from a later month's assigned money", async () => {
      const { put, spend, month, moves, groceries, phone, cookie, base } = await moveSetup();
      await put(groceries.id, "2026-11", "500");
      await spend({ date: "2026-10-01", amount: "-200", categoryId: phone.id });
      const res = await send("POST", `${base}/months/2026-10/moves`, cookie, {
        fromCategoryId: groceries.id,
        toCategoryId: phone.id,
        amount: "200",
        fromMonth: "2026-11",
        today: TODAY,
      });
      expect(res.status).toBe(200);
      expect((await month("2026-10")).byCategory(phone.id)).toMatchObject(t("200", "-200", "0"));
      expect((await month("2026-11")).byCategory(groceries.id)?.assigned).toBe("300");
      expect(
        (await moves()).map((m) => [m.kind, m.month, m.fromCategoryId, m.toCategoryId]),
      ).toEqual(
        expect.arrayContaining([
          ["removed", "2026-11", groceries.id, null],
          ["assigned", "2026-10", null, phone.id],
        ]),
      );
    });

    it("moves assigned money between categories", async () => {
      const { put, move, month, rent, phone } = await moveSetup();
      await put(rent.id, "2026-10", "5000");
      const res = await move(rent.id, phone.id, "1000");
      expect(res.status).toBe(200);
      const oct = await month("2026-10");
      expect(oct.byCategory(rent.id)).toMatchObject(t("4000", "0", "4000"));
      expect(oct.byCategory(phone.id)).toMatchObject(t("1000", "0", "1000"));
      expect(oct.readyToAssign).toBe("95000");
    });

    it("covers overspending, and moves money back to Ready to Assign", async () => {
      const { put, move, month, spend, rent, phone, readyToAssignCategoryId } = await moveSetup();
      await put(rent.id, "2026-10", "5000");
      await spend({ date: "2026-10-01", amount: "-1500", categoryId: phone.id });
      await move(rent.id, phone.id, "1500");
      expect((await month("2026-10")).byCategory(phone.id)).toMatchObject(t("1500", "-1500", "0"));
      await move(rent.id, readyToAssignCategoryId, "2000");
      const oct = await month("2026-10");
      expect(oct.byCategory(rent.id)).toMatchObject(t("1500", "0", "1500"));
      expect(oct.readyToAssign).toBe("97000");
      // And from Ready to Assign, as assigning does.
      await move(readyToAssignCategoryId, rent.id, "500");
      expect((await month("2026-10")).byCategory(rent.id)).toMatchObject(t("2000", "0", "2000"));
    });

    it("lists every change to assigned money, newest first", async () => {
      const { put, move, moves, rent, phone, readyToAssignCategoryId } = await moveSetup();
      await put(rent.id, "2026-10", "5000");
      await put(rent.id, "2026-10", "5000"); // unchanged: not a move
      await move(rent.id, phone.id, "1000");
      await move(phone.id, readyToAssignCategoryId, "400");
      await put(rent.id, "2026-10", "3000");
      expect(await moves()).toMatchObject([
        { kind: "removed", fromCategoryId: rent.id, toCategoryId: null, amount: "1000" },
        { kind: "removed", fromCategoryId: phone.id, toCategoryId: null, amount: "400" },
        { kind: "moved", fromCategoryId: rent.id, toCategoryId: phone.id, amount: "1000" },
        {
          kind: "assigned",
          fromCategoryId: null,
          toCategoryId: rent.id,
          month: "2026-10",
          amount: "5000",
          userName: "Test User",
        },
      ]);
    });

    it("keeps a deleted category's moves and logs the delete", async () => {
      const { cookie, base, put, move, moves, spend, rent, phone, groceries, needs } =
        await moveSetup();
      const del = (id: string, to?: string) =>
        send(
          "DELETE",
          `${base}/categories/${id}${to ? `?reassignToCategoryId=${to}` : ""}`,
          cookie,
        );
      // Money only: it goes back to Ready to Assign ("Removed $20.00 from deleted category").
      await put(rent.id, "2026-10", "2000");
      expect((await del(rent.id)).status).toBe(204);
      expect(await moves()).toMatchObject([
        {
          kind: "removed",
          fromCategoryId: null,
          fromDeletedCategory: rent.name,
          toCategoryId: null,
          deletion: true,
          amount: "2000",
        },
        { kind: "assigned", toCategoryId: null, toDeletedCategory: rent.name, deletion: false },
      ]);
      // Negative assigned money: "Moved $5.00 from Ready to Assign to deleted category".
      await put(phone.id, "2026-10", "1000");
      await move(phone.id, groceries.id, "1500");
      await spend({ date: "2026-10-01", amount: "-100", categoryId: groceries.id });
      expect((await del(phone.id)).status).toBe(204);
      expect((await moves())[0]).toMatchObject({
        kind: "moved",
        fromCategoryId: null,
        fromDeletedCategory: null,
        toDeletedCategory: phone.name,
        deletion: true,
        amount: "500",
      });
      // With transactions, to the category picked: "Moved $15.00 from deleted category … to …".
      const other = needs.categories.find((c) => c.id !== groceries.id);
      if (!other) throw new Error("starter data missing");
      expect((await del(groceries.id, other.id)).status).toBe(204);
      expect((await moves())[0]).toMatchObject({
        kind: "moved",
        fromDeletedCategory: groceries.name,
        toCategoryId: other.id,
        deletion: true,
        amount: "1500",
      });
    });

    it("lists the last 34 days of moves", async () => {
      const { base, put, moves, rent, readyToAssignCategoryId } = await moveSetup();
      await put(rent.id, "2026-10", "2000");
      const budgetId = base.split("/").at(-1) ?? "";
      const old = (days: number) =>
        db.insert(moneyMove).values({
          id: newId(),
          budgetId,
          fromCategoryId: readyToAssignCategoryId,
          toCategoryId: rent.id,
          month: "2026-10-01",
          amount: BigInt(days),
          currency: "USD",
          createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
        });
      await old(33);
      await old(35);
      expect((await moves()).map((m) => m.amount)).toEqual(["2000", "33"]);
    });

    it("marks one Auto-Assign's moves as a batch with its method", async () => {
      const { cookie, base, put, moves, rent, phone } = await moveSetup();
      await put(rent.id, "2026-09", "3000");
      await put(phone.id, "2026-10", "200");
      const res = await send("POST", `${base}/months/2026-10/auto-assign`, cookie, {
        option: "assignedLastMonth",
        categoryIds: [rent.id, phone.id],
        today: TODAY,
      });
      expect(res.status).toBe(200);
      const [first, second, plain] = await moves();
      // Rent gets September's 30.00, Phone gives back its 2.00: one batch, both directions.
      expect([first, second]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "assigned", toCategoryId: rent.id, amount: "3000" }),
          expect.objectContaining({ kind: "removed", fromCategoryId: phone.id, amount: "200" }),
        ]),
      );
      expect(first?.autoAssign).toEqual({
        batchId: expect.any(String),
        method: "assignedLastMonth",
      });
      expect(second?.autoAssign).toEqual(first?.autoAssign);
      expect(plain).toMatchObject({ kind: "assigned", toCategoryId: phone.id, autoAssign: null });

      // Another Auto-Assign is another batch.
      await send("POST", `${base}/months/2026-10/auto-assign`, cookie, {
        option: "resetAssigned",
        categoryIds: [rent.id],
        today: TODAY,
      });
      const [reset] = await moves();
      expect(reset?.autoAssign?.method).toBe("resetAssigned");
      expect(reset?.autoAssign?.batchId).not.toBe(first?.autoAssign?.batchId);
    });

    it("lists a month's moves however old, with who moved them", async () => {
      const { cookie, base, put, rent, phone, readyToAssignCategoryId } = await moveSetup();
      const budgetId = base.split("/").at(-1) ?? "";
      await put(rent.id, "2026-10", "2000");
      await put(rent.id, "2026-09", "700");
      await db.insert(moneyMove).values({
        id: newId(),
        budgetId,
        fromCategoryId: readyToAssignCategoryId,
        toCategoryId: phone.id,
        month: "2026-10-01",
        amount: 90n,
        currency: "USD",
        createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      });
      // A second member moves money too, then leaves the budget.
      const partner = await signUp(app, { name: "Pat" });
      const [partnerUser] = await db.select().from(user).where(eq(user.email, partner.email));
      await db.insert(budgetMember).values({
        id: newId(),
        budgetId,
        userId: partnerUser?.id ?? "",
        role: "editor",
      });
      expect((await put(phone.id, "2026-10", "500")).status).toBe(200);
      const monthMoves = async () =>
        (await json<{ moves: Move[] }>(await send("GET", `${base}/months/2026-10/moves`, cookie)))
          .moves;
      // `put` signs in as the owner, so the partner's own request goes through their cookie.
      expect(
        (
          await send("PUT", `${base}/months/2026-10/categories/${phone.id}`, partner.cookie, {
            assigned: "600",
            today: TODAY,
          })
        ).status,
      ).toBe(200);

      expect(await monthMoves()).toMatchObject([
        // Avatar colours: the owner 1, the next member to join 2.
        {
          toCategoryId: phone.id,
          amount: "100",
          userName: "Pat",
          memberRole: "editor",
          avatarColor: 2,
        },
        {
          toCategoryId: phone.id,
          amount: "500",
          userName: "Test User",
          memberRole: "owner",
          avatarColor: 1,
        },
        { toCategoryId: rent.id, amount: "2000" },
        { toCategoryId: phone.id, amount: "90", userId: null, memberRole: null, avatarColor: null },
      ]);

      await db.delete(budgetMember).where(eq(budgetMember.userId, partnerUser?.id ?? ""));
      const [left] = await monthMoves();
      expect(left).toMatchObject({ userName: "Pat", memberRole: null, avatarColor: null });
      expect(left?.userId).toBe(partnerUser?.id);
      expect((await send("GET", `${base}/months/2026-10/moves`, partner.cookie)).status).toBe(404);
    });

    it("refuses bad moves", async () => {
      const { move, rent, phone, readyToAssignCategoryId } = await moveSetup();
      expect((await move(rent.id, rent.id, "100")).status).toBe(400);
      expect((await move(rent.id, phone.id, "0")).status).toBe(400);
      expect((await move(rent.id, phone.id, "-5")).status).toBe(400);
      expect((await move(rent.id, phone.id, "100", "2027-05")).status).toBe(400);
      expect((await move(rent.id, "nope", "100")).status).toBe(404);
      // Ready to Assign to Ready to Assign isn't a move either.
      expect((await move(readyToAssignCategoryId, readyToAssignCategoryId, "1")).status).toBe(400);
    });

    it("takes a deleted category's assigned money along with its transactions", async () => {
      const { cookie, base, put, spend, month, rent, phone } = await moveSetup();
      await put(rent.id, "2026-09", "3000");
      await put(rent.id, "2026-10", "2000");
      await put(phone.id, "2026-10", "100");
      await spend({ date: "2026-10-01", amount: "-500", categoryId: rent.id });
      const res = await send(
        "DELETE",
        `${base}/categories/${rent.id}?reassignToCategoryId=${phone.id}`,
        cookie,
      );
      expect(res.status).toBe(204);
      const oct = await month("2026-10");
      expect(oct.byCategory(phone.id)).toMatchObject(t("2100", "-500", "4600"));
      expect(oct.readyToAssign).toBe("94900");
    });
  });

  describe("activity drill-down", () => {
    type Row = { id: string; transactionId: string; payeeName: string | null; amount: string };
    const activity = async (base: string, cookie: string, m: string, query: string) => {
      const res = await send("GET", `${base}/months/${m}/activity?today=${TODAY}&${query}`, cookie);
      return {
        status: res.status,
        rows: res.ok ? (await json<{ transactions: Row[] }>(res)).transactions : [],
      };
    };

    it("lists a category's transactions in the month, split lines one by one", async () => {
      const { cookie, base, spend, rent, phone } = await setup();
      await spend({
        date: "2026-10-01",
        amount: "-2500",
        categoryId: rent.id,
        payeeName: "Landlord",
      });
      await spend({
        date: "2026-10-02",
        amount: "-3000",
        payeeName: "Shop",
        subtransactions: [
          { amount: "-1000", categoryId: rent.id },
          { amount: "-2000", categoryId: phone.id },
        ],
      });
      // Other months and future-dated transactions aren't this month's activity.
      await spend({ date: "2026-09-30", amount: "-700", categoryId: rent.id });
      await spend({ date: "2026-10-20", amount: "-900", categoryId: rent.id });

      const { status, rows } = await activity(base, cookie, "2026-10", `categoryId=${rent.id}`);
      expect(status).toBe(200);
      expect(rows.map((r) => [r.payeeName, r.amount])).toEqual([
        ["Shop", "-1000"],
        ["Landlord", "-2500"],
      ]);
      expect(rows[0]?.transactionId).not.toBe(rows[0]?.id);
    });

    it("lists a group's visible categories and Uncategorized", async () => {
      const { cookie, base, spend, rent, phone, bills } = await setup();
      await spend({ date: "2026-10-01", amount: "-100", categoryId: rent.id });
      await spend({ date: "2026-10-01", amount: "-200", categoryId: phone.id });
      await spend({ date: "2026-10-01", amount: "-300" });
      await send("PATCH", `${base}/categories/${phone.id}`, cookie, { hidden: true });

      const group = await activity(base, cookie, "2026-10", `groupId=${bills.id}`);
      expect(group.rows.map((r) => r.amount)).toEqual(["-100"]);
      const none = await activity(base, cookie, "2026-10", "uncategorized=true");
      expect(none.rows.map((r) => r.amount)).toEqual(["-300"]);
    });

    it("needs exactly one target and a member", async () => {
      const { cookie, base, rent, bills } = await setup();
      expect((await activity(base, cookie, "2026-10", "")).status).toBe(400);
      expect(
        (await activity(base, cookie, "2026-10", `categoryId=${rent.id}&groupId=${bills.id}`))
          .status,
      ).toBe(400);
      expect((await activity(base, cookie, "2026-10", "categoryId=nope")).status).toBe(404);
      const other = await signUp(app);
      expect((await activity(base, other.cookie, "2026-10", `categoryId=${rent.id}`)).status).toBe(
        404,
      );
    });
  });

  describe("auto-assign", () => {
    it("lists each option's amount and applies one to every visible category", async () => {
      const { cookie, base, put, spend, month, rent, phone, groceries } = await setup();
      await put(rent.id, "2026-09", "3000");
      await spend({ date: "2026-08-25", amount: "-300", categoryId: phone.id });
      await spend({ date: "2026-09-10", amount: "-1200", categoryId: phone.id });
      await send("PATCH", `${base}/categories/${groceries.id}`, cookie, { hidden: true });
      await put(groceries.id, "2026-09", "500");

      const oct = await month("2026-10");
      expect(oct.byCategory(rent.id)).toMatchObject({
        autoAssign: {
          assignedLastMonth: "3000",
          spentLastMonth: "0",
          averageAssigned: "3000",
          averageSpent: "0",
          resetAvailable: "-3000",
          resetAssigned: "0",
        },
      });
      // August and September: $15.00 spent over two months.
      expect(oct.byCategory(phone.id)).toMatchObject({
        autoAssign: { spentLastMonth: "1200", averageSpent: "750" },
      });

      const res = await send("POST", `${base}/months/2026-10/auto-assign`, cookie, {
        option: "assignedLastMonth",
        today: TODAY,
      });
      expect(res.status).toBe(200);
      const after = await month("2026-10");
      expect(after.byCategory(rent.id)).toMatchObject(t("3000", "0", "6000"));
      // Hidden categories are left out.
      expect(after.byCategory(groceries.id)).toMatchObject({ assigned: "0" });
      const moves = await json<{ moves: { kind: string; amount: string }[] }>(
        await send("GET", `${base}/moves`, cookie),
      );
      expect(moves.moves[0]).toMatchObject({ kind: "assigned", amount: "3000" });
    });

    it("applies to the categories asked for, and resets", async () => {
      const { cookie, base, put, month, rent, phone } = await setup();
      await put(rent.id, "2026-09", "3000");
      await put(phone.id, "2026-10", "200");
      const auto = (option: string, categoryIds?: string[]) =>
        send("POST", `${base}/months/2026-10/auto-assign`, cookie, {
          option,
          categoryIds,
          today: TODAY,
        });

      expect((await auto("resetAvailable", [rent.id])).status).toBe(200);
      let oct = await month("2026-10");
      expect(oct.byCategory(rent.id)).toMatchObject(t("-3000", "0", "0"));
      expect(oct.byCategory(phone.id)).toMatchObject(t("200", "0", "200"));
      expect(oct.readyToAssign).toBe("99800");

      expect((await auto("resetAssigned")).status).toBe(200);
      oct = await month("2026-10");
      expect(oct.byCategory(rent.id)).toMatchObject(t("0", "0", "3000"));
      expect(oct.byCategory(phone.id)).toMatchObject(t("0", "0", "0"));
    });

    it("covers overspending when resetting Available", async () => {
      const { cookie, base, spend, month, rent } = await setup();
      await spend({ date: "2026-10-01", amount: "-2500", categoryId: rent.id });
      const res = await send("POST", `${base}/months/2026-10/auto-assign`, cookie, {
        option: "resetAvailable",
        categoryIds: [rent.id],
        today: TODAY,
      });
      expect(res.status).toBe(200);
      const oct = await month("2026-10");
      expect(oct.byCategory(rent.id)).toMatchObject(t("2500", "-2500", "0"));
      expect(oct.readyToAssign).toBe("97500");
    });

    it("refuses unknown categories and months out of range", async () => {
      const { cookie, base } = await setup();
      const res = await send("POST", `${base}/months/2026-10/auto-assign`, cookie, {
        option: "resetAssigned",
        categoryIds: ["nope"],
      });
      expect(res.status).toBe(404);
      const far = await send("POST", `${base}/months/2027-06/auto-assign`, cookie, {
        option: "resetAssigned",
        today: TODAY,
      });
      expect(far.status).toBe(400);
    });
  });

  describe("underfunded and reduce overfunding", () => {
    const target = (
      ctx: { cookie: string; base: string },
      categoryId: string,
      input: Record<string, unknown> = {},
    ) =>
      send("PUT", `${ctx.base}/categories/${categoryId}/target`, ctx.cookie, {
        cadence: "monthly",
        behavior: "set_aside",
        amount: "10000",
        dueDay: null,
        month: "2026-10",
        ...input,
      });
    const auto = (
      ctx: { cookie: string; base: string },
      option: string,
      extra: Record<string, unknown> = {},
    ) =>
      send("POST", `${ctx.base}/months/2026-10/auto-assign`, ctx.cookie, {
        option,
        today: TODAY,
        ...extra,
      });

    it("lists what each category asks for and what's over", async () => {
      const ctx = await setup();
      const { put, spend, month, rent, phone, groceries } = ctx;
      expect((await target(ctx, rent.id)).status).toBe(200);
      expect((await target(ctx, phone.id, { behavior: "refill", dueDay: 15 })).status).toBe(200);
      await put(rent.id, "2026-10", "15000");
      await spend({ date: "2026-10-01", amount: "-2500", categoryId: groceries.id });

      const oct = await month("2026-10");
      // Rent: $150.00 against $100.00, so $50.00 is over.
      expect(oct.byCategory(rent.id)).toMatchObject({
        autoAssign: { underfunded: "15000", reduceOverfunding: "10000" },
        underfundedParts: [],
      });
      // Phone: due on the 15th. Groceries: no target, only its overspending.
      expect(oct.byCategory(phone.id)).toMatchObject({
        autoAssign: { underfunded: "10000", reduceOverfunding: "0" },
        underfundedParts: [{ amount: "10000", step: 2, date: "2026-10-15" }],
      });
      expect(oct.byCategory(groceries.id)).toMatchObject({
        autoAssign: { underfunded: "2500" },
        underfundedParts: [{ amount: "2500", step: 1, date: "" }],
      });
      // October's Targets: each target's month amount, met or not.
      expect(oct.targets).toEqual({ month: "20000", nextMonth: "20000", expectedIncome: null });
    });

    it("meets the target or covers overspending, whichever is more", async () => {
      const ctx = await setup();
      const { put, spend, month, rent, phone } = ctx;
      await target(ctx, rent.id);
      await target(ctx, phone.id);
      await spend({ date: "2026-10-01", amount: "-3000", categoryId: rent.id });
      await put(phone.id, "2026-10", "10000");
      await spend({ date: "2026-10-01", amount: "-13000", categoryId: phone.id });
      const oct = await month("2026-10");
      expect(oct.byCategory(rent.id)?.autoAssign.underfunded).toBe("10000");
      expect(oct.byCategory(phone.id)?.autoAssign.underfunded).toBe("13000");
    });

    // Funded spending isn't assigned money, and the average starts at the first month with money
    // in the category.
    it("leaves funded spending out of a payment category's Auto-Assign amounts", async () => {
      const ctx = await cards();
      const { put, month, create, rent, visa } = ctx;
      await put(visa.paymentCategoryId, "2026-09", "300");
      await put(visa.paymentCategoryId, "2026-10", "700");
      await put(rent.id, "2026-10", "500");
      await create({ accountId: visa.id, date: "2026-10-01", amount: "-400", categoryId: rent.id });
      const nov = await month("2026-11");
      expect(nov.byCategory(visa.paymentCategoryId)?.autoAssign).toMatchObject({
        assignedLastMonth: "700",
        spentLastMonth: "0",
        averageAssigned: "500",
        averageSpent: "0",
      });
    });

    it("tells each later month's targets for the panel's pie or check", async () => {
      const ctx = await setup();
      const { put, month, groceries, rent } = ctx;
      await target(ctx, groceries.id, { amount: "500" });
      await put(groceries.id, "2026-11", "300");
      let oct = await month("2026-10");
      expect(oct.futureMonths).toEqual([
        { month: "2026-11", assigned: "300", targets: { needed: "500", funded: "300" } },
      ]);
      await put(groceries.id, "2026-11", "500");
      await put(rent.id, "2026-12", "100"); // December: assigned, but no targets ask there
      oct = await month("2026-10");
      expect(oct.futureMonths.map((m) => m.targets)).toEqual([
        { needed: "500", funded: "500" },
        { needed: "500", funded: "0" },
      ]);
      expect(oct.nextMonthTargets).toEqual({ needed: "500", funded: "500" });
    });

    it("breaks Ready to Assign down line by line", async () => {
      const ctx = await cards();
      const { month, put, spend, create, rent, phone, amex } = ctx;
      const ctxReadyToAssign = ctx.readyToAssignCategoryId;
      // September: $1,000.00 in (August), $20.00 assigned, $5.00 of cash overspending.
      await put(rent.id, "2026-09", "2000");
      await spend({ date: "2026-09-05", amount: "-500", categoryId: phone.id });
      // October: $30.00 assigned, Amex paid $8.00 above zero, $5.00 in; $50.00 in November.
      await put(rent.id, "2026-10", "3000");
      await create({ date: "2026-10-01", amount: "-800", transferAccountId: amex.id });
      await spend({ date: "2026-10-01", amount: "500", categoryId: ctxReadyToAssign });
      await put(rent.id, "2026-11", "5000");
      const oct = await month("2026-10");
      expect(oct.readyToAssignBreakdown).toEqual({
        leftOver: "98000",
        inflows: "500",
        debtInflows: "800",
        cashOverspending: "-500",
        assigned: "-3000",
        assignedInFuture: "-5000",
        total: "90800",
      });
      expect(oct.readyToAssign).toBe("90800");
    });

    it("funds card payment targets before plain card alerts", async () => {
      const ctx = await cards(1000n);
      const { put, month, rent, visa, amex } = ctx;
      await target(ctx, amex.paymentCategoryId, { cadence: "payment_monthly", amount: "1000" });
      await put(rent.id, "2026-10", "99500"); // $5.00 left to assign
      const before = await month("2026-10");
      expect(before.readyToAssign).toBe("500");
      expect((await auto(ctx, "underfunded")).status).toBe(200);
      const oct = await month("2026-10");
      expect(oct.byCategory(amex.paymentCategoryId)?.assigned).toBe("500");
      expect(oct.byCategory(visa.paymentCategoryId)?.assigned).toBe("0");
    });

    it("funds in priority order and stops when Ready to Assign runs out", async () => {
      const ctx = await setup();
      const { put, spend, month, rent, phone, groceries } = ctx;
      await target(ctx, rent.id); // end of month
      await target(ctx, phone.id, { dueDay: 15 }); // due on a date: before end of month
      await spend({ date: "2026-10-01", amount: "-500", categoryId: groceries.id }); // first
      // $1,000.00 in; leave $60.00 to assign.
      const { groups } = await json<{ groups: Group[] }>(
        await send("GET", `${ctx.base}/categories`, ctx.cookie),
      );
      const spare = groups.find((g) => g.id === ctx.needs.id)?.categories[1];
      if (!spare) throw new Error("starter data missing");
      await put(spare.id, "2026-10", "94000");
      expect((await month("2026-10")).readyToAssign).toBe("6000");

      expect((await auto(ctx, "underfunded")).status).toBe(200);
      const oct = await month("2026-10");
      expect(oct.byCategory(groceries.id)).toMatchObject(t("500", "-500", "0"));
      expect(oct.byCategory(phone.id)).toMatchObject(t("5500", "0", "5500"));
      expect(oct.byCategory(rent.id)).toMatchObject(t("0", "0", "0"));
      expect(oct.readyToAssign).toBe("0");

      // A selection is funded in full, even past Ready to Assign.
      expect((await auto(ctx, "underfunded", { categoryIds: [rent.id] })).status).toBe(200);
      const after = await month("2026-10");
      expect(after.byCategory(rent.id)).toMatchObject(t("10000", "0", "10000"));
      expect(after.readyToAssign).toBe("-10000");
    });

    it("keeps a view's Underfunded to Ready to Assign, in order", async () => {
      const ctx = await setup();
      const { put, month, rent, phone } = ctx;
      await target(ctx, rent.id);
      await target(ctx, phone.id, { dueDay: 15 });
      await put(ctx.groceries.id, "2026-10", "95000");
      expect(
        (await auto(ctx, "underfunded", { categoryIds: [rent.id, phone.id], scope: "view" }))
          .status,
      ).toBe(200);
      const oct = await month("2026-10");
      expect(oct.byCategory(phone.id)?.assigned).toBe("5000");
      expect(oct.byCategory(rent.id)?.assigned).toBe("0");
    });

    it("takes back what's over, up to what's Available", async () => {
      const ctx = await setup();
      const { put, spend, month, rent, phone } = ctx;
      await target(ctx, rent.id);
      await target(ctx, phone.id, { behavior: "refill" });
      await put(rent.id, "2026-10", "15000");
      await spend({ date: "2026-10-01", amount: "-12000", categoryId: rent.id });
      await put(phone.id, "2026-09", "15000");

      expect((await auto(ctx, "reduceOverfunding")).status).toBe(200);
      const oct = await month("2026-10");
      expect(oct.byCategory(rent.id)).toMatchObject(t("12000", "-12000", "0"));
      expect(oct.byCategory(phone.id)).toMatchObject(t("-5000", "0", "10000"));
    });

    it("funds what fell due before the budget began last in its first month", async () => {
      const ctx = await setup();
      const { month, rent, phone, groceries } = ctx;
      await target(ctx, rent.id, { dueDay: 5 }); // before the start
      await target(ctx, phone.id, { dueDay: 20 });
      await target(ctx, groceries.id); // end of month: the 31st
      const oct = await month("2026-10", "2026-10-12");
      expect(oct.byCategory(rent.id)?.underfundedParts).toEqual([
        { amount: "10000", step: 3, date: "2026-10-05" },
      ]);
      expect(oct.byCategory(phone.id)?.underfundedParts).toEqual([
        { amount: "10000", step: 2, date: "2026-10-20" },
      ]);
      expect(oct.byCategory(groceries.id)?.underfundedParts).toEqual([
        { amount: "10000", step: 2, date: "2026-10-31" },
      ]);
      // Only in the first month.
      const nov = await month("2026-11", "2026-10-12");
      expect(nov.byCategory(rent.id)?.underfundedParts[0]?.step).toBe(2);
    });

    it("flags a card with uncategorized transactions this month", async () => {
      const ctx = await cards();
      const spendOnVisa = (date: string) =>
        send("POST", `${ctx.base}/transactions`, ctx.cookie, {
          accountId: ctx.visa.id,
          categoryId: null,
          date,
          amount: "-500",
        });
      expect((await spendOnVisa("2026-09-20")).status).toBe(201);
      const flag = async () =>
        (await ctx.month("2026-10")).byCategory(ctx.visa.paymentCategoryId)?.payment
          ?.hasUncategorized;
      expect(await flag()).toBe(false);
      expect((await spendOnVisa("2026-10-01")).status).toBe(201);
      expect(await flag()).toBe(true);
    });

    it("asks a card's payment category for what's owed, and gives back the rest", async () => {
      const ctx = await cards(5000n);
      await ctx.put(ctx.amex.paymentCategoryId, "2026-10", "600");
      const oct = await ctx.month("2026-10");
      expect(oct.byCategory(ctx.visa.paymentCategoryId)).toMatchObject({
        autoAssign: { underfunded: "5000", reduceOverfunding: "0" },
        underfundedParts: [{ amount: "5000", step: 5, date: "" }],
      });
      expect(oct.byCategory(ctx.amex.paymentCategoryId)).toMatchObject({
        autoAssign: { underfunded: "600", reduceOverfunding: "0" },
      });
    });
  });
});
