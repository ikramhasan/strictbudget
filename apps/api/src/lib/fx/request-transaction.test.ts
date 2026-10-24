import { sql } from "@strictbudget/db";
import { CURRENCY_CODES } from "@strictbudget/engine";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import { deferFxCacheWrites, resolveRate } from ".";
import type { FakeFxProvider } from "./fake";

// A write fetches its exchange rates before it locks anything, and caches them
// outside its transaction (kept when it fails), so a slow provider doesn't keep others waiting.
const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset().seed("2026-10-01", "EUR", { USD: "1.1" });
});
afterAll(close);

const TODAY = "2026-10-16";

async function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const res = await send("POST", `${base}/accounts`, cookie, {
    name: "Euros",
    type: "checking",
    currency: "EUR",
    balance: "0",
    date: "2026-10-01",
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const euros = (await res.json()) as { id: string };
  return { cookie, base, euros };
}

/** Resolves to "waiting" if `promise` hasn't settled within `ms`. */
const within = <T>(promise: Promise<T>, ms = 2000) =>
  Promise.race([promise, new Promise<"waiting">((r) => setTimeout(() => r("waiting"), ms))]);

/** Waits until the provider has been asked `n` times. */
async function asked(n: number) {
  for (let i = 0; i < 200 && fx.calls.length < n; i++) await new Promise((r) => setTimeout(r, 10));
  expect(fx.calls.length).toBeGreaterThanOrEqual(n);
}

async function cachedOn(date: string) {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from fx_rate where date = ${date}`,
  );
  return rows[0]?.n ?? 0;
}

describe("exchange rates in a write's transaction", () => {
  it("doesn't keep an account locked while a revaluation waits on a slow provider", async () => {
    const { cookie, base, euros } = await setup();
    const release = fx.hold();
    let done = false;
    const revaluing = send("POST", `${base}/accounts/${euros.id}/revalue`, cookie, {
      date: TODAY,
      today: TODAY,
    }).then((res) => {
      done = true;
      return res;
    });
    try {
      await asked(1);
      // Renaming updates the account's row, which the revaluation locks once it has its rate.
      const renamed = await within(
        send("PATCH", `${base}/accounts/${euros.id}?today=${TODAY}`, cookie, { name: "Euro cash" }),
      );
      expect(renamed).not.toBe("waiting");
      expect((renamed as Response).status).toBe(200);
      expect(done).toBe(false);
    } finally {
      release();
    }
    expect((await revaluing).status).toBe(200);
  });

  it("caches more rates than one statement can take", async () => {
    const { base } = await setup();
    const budgetId = base.split("/").at(-1) as string;
    const quotes = Object.fromEntries(
      CURRENCY_CODES.filter((c) => c !== "EUR").map((c) => [c, "1.5"]),
    );
    // Each date answers on itself, so every one is a fetch of its own.
    const dates = Array.from({ length: 70 }, (_, i) =>
      new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
    );
    for (const date of dates) fx.seed(date, "EUR", quotes);
    await deferFxCacheWrites(db, async () => {
      for (const date of dates) {
        await resolveRate(db, { fxProviders }, { budgetId, from: "EUR", to: "USD", date });
      }
    });
    const rows = Object.keys(quotes).length * dates.length;
    expect(rows).toBeGreaterThan(65_534 / 7);
    const [cached] = await db.execute<{ n: number }>(sql`select count(*)::int as n from fx_rate`);
    expect(cached?.n).toBe(rows);
  });

  it("keeps the rates a failed write fetched", async () => {
    const { cookie, base, euros } = await setup();
    const res = await send("POST", `${base}/transactions?today=${TODAY}`, cookie, {
      accountId: euros.id,
      date: "2026-10-06",
      amount: "-1000",
      payeeName: "Shop",
      categoryId: "no-such-category",
      memo: "",
      flag: null,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(fx.calls).toHaveLength(1);
    expect(await cachedOn("2026-10-06")).toBeGreaterThan(0);
  });
});
