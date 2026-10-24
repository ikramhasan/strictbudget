import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Target = { cadence: string; behavior: string; amount: string; dueDay: number | null };
type Category = { id: string; name: string; target: Target | null };
type Group = { id: string; kind: string | null; categories: Category[] };
type MonthCategory = {
  categoryId: string;
  target: { needed: string; funded: string; underfunded: string } | null;
  autoAssign: { underfunded: string; reduceOverfunding: string };
};
type Month = { categories: MonthCategory[]; targets: { month: string } };
type ErrorBody = { error: { code: string } };

const TODAY = "2026-10-13";

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

/** A $10,000 loan at 6%, $200 a month, paired with a category. */
async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const groups = (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie)))
    .groups;
  const [pay, other] = groups.find((g) => !g.kind)?.categories ?? [];
  if (!pay || !other) throw new Error("starter data missing");
  const checking = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, cookie, {
      name: "Checking",
      type: "checking",
      balance: "100000",
      date: "2026-10-01",
    }),
  );
  const loan = await json<{ id: string }>(
    await send("POST", `${base}/accounts`, cookie, {
      name: "G7 Loan",
      type: "personal_loan",
      balance: "-1000000",
      date: "2026-10-01",
      interestRate: "6",
      minimumPayment: "20000",
      pairedCategoryId: pay.id,
    }),
  );
  const setTarget = (categoryId: string, input: Record<string, unknown>) =>
    send("PUT", `${base}/categories/${categoryId}/target`, cookie, { month: "2026-10", ...input });
  const assign = async (categoryId: string, assigned: string) => {
    const res = await send("PUT", `${base}/months/2026-10/categories/${categoryId}`, cookie, {
      assigned,
      today: TODAY,
    });
    expect(res.status).toBe(200);
  };
  const row = async (m = "2026-10") => {
    const res = await send("GET", `${base}/months/${m}?today=${TODAY}`, cookie);
    expect(res.status).toBe(200);
    const month = await json<Month>(res);
    return { month, row: month.categories.find((c) => c.categoryId === pay.id) };
  };
  const payLoan = async (amount: string) => {
    const res = await send("POST", `${base}/accounts/${loan.id}/loan/payments`, cookie, {
      fromAccountId: checking.id,
      amount,
      date: TODAY,
      memo: "",
    });
    expect(res.status, await res.clone().text()).toBe(201);
  };
  const pairLoan = (categoryId: string | null) =>
    send("PATCH", `${base}/accounts/${loan.id}`, cookie, { pairedCategoryId: categoryId });
  const target = async (categoryId: string) =>
    (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie))).groups
      .flatMap((g) => g.categories)
      .find((c) => c.id === categoryId)?.target ?? null;
  return { pay, other, setTarget, assign, row, payLoan, pairLoan, target };
}

describe("Monthly Debt Payment targets", () => {
  it("asks the amount each month like set aside, whatever was paid", async () => {
    const { pay, setTarget, assign, row, payLoan } = await setup();
    const res = await setTarget(pay.id, { cadence: "debt_monthly", amount: "30000", dueDay: null });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await json<Category>(res)).target).toMatchObject({
      cadence: "debt_monthly",
      behavior: "set_aside",
      amount: "30000",
      dueDay: null,
    });

    let october = await row();
    expect(october.row?.target).toMatchObject({ needed: "30000", underfunded: "30000" });
    expect(october.month.targets.month).toBe("30000");

    // $100.00 assigned leaves $200.00; a $50.00 payment from the category doesn't change it.
    await assign(pay.id, "10000");
    await payLoan("5000");
    october = await row();
    expect(october.row?.target).toMatchObject({ funded: "10000", underfunded: "20000" });
    // Underfunded takes Assigned to $300.00, due on the month's last day.
    expect(october.row?.autoAssign.underfunded).toBe("30000");

    // November asks for $300.00 again; the $50.00 carried in doesn't count.
    expect((await row("2026-11")).row?.target).toMatchObject({ funded: "0", underfunded: "30000" });
  });

  it("is only for categories paired with a loan, which take nothing else", async () => {
    const { pay, other, setTarget } = await setup();
    const debtElsewhere = await setTarget(other.id, {
      cadence: "debt_monthly",
      amount: "30000",
      dueDay: null,
    });
    expect(debtElsewhere.status).toBe(409);
    const monthlyOnPaired = await setTarget(pay.id, {
      cadence: "monthly",
      behavior: "set_aside",
      amount: "30000",
      dueDay: null,
    });
    expect(monthlyOnPaired.status).toBe(409);
    expect((await json<ErrorBody>(monthlyOnPaired)).error.code).toBe("MANAGED_CATEGORY");
  });

  it("handles the loan being unpaired, re-paired or paired elsewhere", async () => {
    const { pay, other, setTarget, row, pairLoan, target } = await setup();
    await setTarget(pay.id, { cadence: "debt_monthly", amount: "4000", dueDay: null });

    // Unpaired, the target stays and keeps asking; it can still be edited.
    expect((await pairLoan(null)).status).toBe(200);
    expect((await row()).row?.target).toMatchObject({ needed: "4000" });
    expect(
      (await setTarget(pay.id, { cadence: "debt_monthly", amount: "5000", dueDay: 15 })).status,
    ).toBe(200);

    // Re-paired, it starts again from the loan's $200.00 minimum.
    await pairLoan(pay.id);
    expect(await target(pay.id)).toMatchObject({ cadence: "debt_monthly", amount: "20000" });

    // Paired with a category that has another target, that target is removed.
    await setTarget(other.id, {
      cadence: "monthly",
      behavior: "set_aside",
      amount: "3000",
      dueDay: null,
    });
    await pairLoan(other.id);
    expect(await target(other.id)).toBeNull();
    // The category it left keeps its debt target.
    expect((await target(pay.id))?.cadence).toBe("debt_monthly");
  });
});
