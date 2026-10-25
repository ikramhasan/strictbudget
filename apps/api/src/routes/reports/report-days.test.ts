import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

const TODAY = "2026-10-20";

type Group = { id: string; kind: string | null; categories: { id: string }[] };

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Spending on a few days of two months (Spending Trends' calendar). */
async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const checking = (await (
    await send("POST", `${base}/accounts`, cookie, {
      name: "Checking",
      type: "checking",
      balance: "100000",
      date: "2026-08-20",
    })
  ).json()) as { id: string };
  const { groups } = (await (await send("GET", `${base}/categories`, cookie)).json()) as {
    groups: Group[];
  };
  const [food, fun] = groups.filter((g) => !g.kind).flatMap((g) => g.categories);
  if (!food || !fun) throw new Error("starter data missing");
  const add = async (date: string, amount: string, categoryId: string) => {
    const res = await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
      accountId: checking.id,
      date,
      amount,
      categoryId,
    });
    expect(res.status).toBe(201);
  };
  await add("2026-09-30", "-1500", food.id);
  await add("2026-10-02", "-1000", food.id);
  await add("2026-10-02", "-250", fun.id);
  await add("2026-10-02", "400", fun.id);
  await add("2026-10-15", "-700", food.id);
  const get = async (path: string, query: Record<string, string>) => {
    const res = await send(
      "GET",
      `${base}/reports/${path}?${new URLSearchParams({ today: TODAY, ...query })}`,
      cookie,
    );
    expect(res.status).toBe(200);
    return res.json();
  };
  return { get, food, fun };
}

describe("report days", () => {
  it("sums spending per day", async () => {
    const t = await setup();
    const { rows } = (await t.get("activity", {
      from: "2026-09",
      to: "2026-10",
      groupBy: "day",
    })) as { rows: { day: string; net: string; count: number }[] };
    const byDay = Object.fromEntries(rows.map((r) => [r.day, [r.net, r.count]]));
    expect(byDay).toEqual({
      "2026-09-30": ["-1500", 1],
      // A refund on the same day nets against the day's spending.
      "2026-10-02": ["-850", 3],
      "2026-10-15": ["-700", 1],
    });
  });

  it("narrows the months to a day range for sums and lines", async () => {
    const t = await setup();
    const { rows } = (await t.get("activity", {
      from: "2026-10",
      to: "2026-10",
      fromDate: "2026-10-02",
      toDate: "2026-10-02",
      groupBy: "category",
    })) as { rows: { categoryId: string; net: string }[] };
    expect(Object.fromEntries(rows.map((r) => [r.categoryId, r.net]))).toEqual({
      [t.food.id]: "-1000",
      [t.fun.id]: "150",
    });
    const lines = (await t.get("transactions", {
      from: "2026-09",
      to: "2026-10",
      fromDate: "2026-09-30",
      toDate: "2026-09-30",
    })) as { total: string; count: number };
    expect(lines).toMatchObject({ total: "-1500", count: 1 });
    // A day range outside the months doesn't widen them.
    const outside = (await t.get("transactions", {
      from: "2026-10",
      to: "2026-10",
      fromDate: "2026-09-01",
    })) as { total: string };
    expect(outside.total).toBe("-1550");
  });
});
