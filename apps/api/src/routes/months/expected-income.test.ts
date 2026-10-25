import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type MonthTargets = { month: string; nextMonth: string; expectedIncome: string | null };

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("expected income", () => {
  it("is entered once and shows in every month", async () => {
    const { cookie } = await signUp(app);
    const budget = await createBudget(app, cookie);
    const base = `/v1/budgets/${budget.id}`;
    const targets = async (month: string) =>
      (
        (await (await send("GET", `${base}/months/${month}`, cookie)).json()) as {
          targets: MonthTargets;
        }
      ).targets;

    expect((await targets("2026-10")).expectedIncome).toBeNull();
    const res = await send("PUT", `${base}/expected-income`, cookie, { amount: "500000" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ expectedIncome: "500000" });
    expect((await targets("2026-10")).expectedIncome).toBe("500000");
    expect((await targets("2027-02")).expectedIncome).toBe("500000");

    // It can't be cleared: zero and negative amounts are refused.
    expect((await send("PUT", `${base}/expected-income`, cookie, { amount: "0" })).status).toBe(
      400,
    );
    await send("PUT", `${base}/expected-income`, cookie, { amount: "200000" });
    expect((await targets("2026-10")).expectedIncome).toBe("200000");
  });

  it("is the budget's: other users can't set it", async () => {
    const { cookie } = await signUp(app);
    const budget = await createBudget(app, cookie);
    const other = await signUp(app, { email: "other@example.com" });
    const res = await send("PUT", `/v1/budgets/${budget.id}/expected-income`, other.cookie, {
      amount: "1000",
    });
    expect(res.status).toBe(404);
  });
});
