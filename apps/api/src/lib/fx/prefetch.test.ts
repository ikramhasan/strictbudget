import { sql } from "@strictbudget/db";
import { fxRate } from "@strictbudget/db/schema";
import type { CurrencyCode } from "@strictbudget/engine";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, runJobs, signUp } from "../../../test/helpers";
import type { FakeFxProvider } from "./fake";

const TODAY = "2026-10-16";
const { app, db, jobs, close, fxProviders } = createTestApp({ serverDate: () => TODAY });
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  await db.execute(sql`delete from pgboss.job`);
  fx.reset();
});
afterAll(close);

async function budgetWith(currencies: string[], budgetCurrency = "USD") {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie, { currency: budgetCurrency });
  for (const currency of currencies) {
    const res = await app.request(`/v1/budgets/${budget.id}/accounts`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: `x-${currency}`,
        type: "checking",
        currency,
        date: TODAY,
        balance: "0",
      }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
  }
  return budget;
}

async function prefetch() {
  fx.calls.length = 0;
  await jobs.send(db, "fx.prefetch", null);
  await runJobs(app);
}

const cachedToday = (base: CurrencyCode) =>
  db
    .select({ quote: fxRate.quote, rate: fxRate.rate })
    .from(fxRate)
    .where(and(eq(fxRate.base, base), eq(fxRate.date, TODAY), eq(fxRate.rateDate, TODAY)));

describe("FX prefetch job", () => {
  it("fetches today's rates once per budget currency with a foreign account, then skips it", async () => {
    await budgetWith(["EUR", "GBP"]);
    await budgetWith(["EUR"]);
    await budgetWith([]); // no foreign account: nothing to fetch for it
    fx.seed(TODAY, "USD", { EUR: "0.92", GBP: "0.79" });

    await prefetch();
    expect(fx.calls).toEqual([{ date: TODAY, base: "USD", quotes: [] }]);
    expect((await cachedToday("USD")).map((r) => r.quote).sort()).toEqual(["EUR", "GBP"]);

    await prefetch();
    expect(fx.calls).toHaveLength(0);
  });

  it("tries again on the next run while the provider only has an earlier day", async () => {
    await budgetWith(["EUR"]);
    fx.seed("2026-10-15", "USD", { EUR: "0.91" });

    await prefetch();
    expect(fx.calls).toHaveLength(1);
    expect(await cachedToday("USD")).toHaveLength(0);

    // Hours later the day's rates are out (reset: a provider with nothing new is skipped for a
    // few minutes, and the next run comes long after that).
    fx.reset().seed(TODAY, "USD", { EUR: "0.92" });
    await prefetch();
    expect(fx.calls).toHaveLength(1);
    expect((await cachedToday("USD")).map((r) => r.quote)).toEqual(["EUR"]);
  });

  it("uses each budget's own currency as the base", async () => {
    await budgetWith(["USD"], "EUR");
    fx.seed(TODAY, "EUR", { USD: "1.09" });
    await prefetch();
    expect(fx.calls.map((c) => c.base)).toEqual(["EUR"]);
  });
});
