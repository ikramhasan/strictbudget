import { fxRate } from "@strictbudget/db/schema";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";
import { FakeFxProvider } from "../../lib/fx/fake";

const first = new FakeFxProvider("frankfurter");
const second = new FakeFxProvider("currency-api");
const { app, db, close } = createTestApp({ fxProviders: [first, second] });
beforeEach(async () => {
  first.reset();
  second.reset();
  await resetDatabase(db);
});
afterAll(close);

type Rate = {
  from: string;
  to: string;
  date: string;
  rate: string;
  rateDate: string;
  source: string;
};
type Override = { id: string; date: string; currency: string; rate: string };

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup() {
  const owner = await signUp(app);
  const budget = await createBudget(app, owner.cookie, { currency: "USD" });
  const base = `/v1/budgets/${budget.id}`;
  const lookup = (query: string, cookie = owner.cookie) =>
    send("GET", `${base}/fx-rates?${query}`, cookie);
  const rate = async (query: string) => {
    const res = await lookup(query);
    expect(res.status, await res.clone().text()).toBe(200);
    return json<Rate>(res);
  };
  const putOverride = (body: unknown, cookie = owner.cookie) =>
    send("PUT", `${base}/fx-rate-overrides`, cookie, body);
  return { owner, budget, base, lookup, rate, putOverride };
}

describe("FX rate lookup", () => {
  it("is 1 for the budget's own currency, with no provider call", async () => {
    const { rate } = await setup();
    expect(await rate("from=USD&date=2025-01-06")).toMatchObject({
      from: "USD",
      to: "USD",
      rate: "1",
      source: "identity",
    });
    expect(first.calls).toHaveLength(0);
  });

  it("fetches a historic market rate into the budget currency and caches every quote", async () => {
    const { rate } = await setup();
    first.seed("2019-05-10", "EUR", { USD: "1.1236", GBP: "0.86373", JPY: "123.27" });
    expect(await rate("from=EUR&date=2019-05-10")).toEqual({
      from: "EUR",
      to: "USD",
      date: "2019-05-10",
      rate: "1.1236",
      rateDate: "2019-05-10",
      source: "market",
    });
    // Same day again, the inverse, and a cross through the cached EUR pivot: no more calls.
    expect((await rate("from=EUR&date=2019-05-10")).rate).toBe("1.1236");
    expect((await rate("from=USD&to=EUR&date=2019-05-10")).rate).toBe("0.889996440014");
    expect((await rate("from=GBP&date=2019-05-10")).rate).toBe("1.300869484677");
    expect(first.calls).toEqual([{ date: "2019-05-10", base: "EUR", quotes: [] }]);
    expect(second.calls).toHaveLength(0);
  });

  it("answers a weekend with the previous business day and caches it under both dates", async () => {
    const { rate } = await setup();
    first.seed("2024-03-01", "EUR", { USD: "1.0813" });
    expect(await rate("from=EUR&date=2024-03-03")).toMatchObject({
      date: "2024-03-03",
      rateDate: "2024-03-01",
      rate: "1.0813",
    });
    const rows = await db.select({ date: fxRate.date, rateDate: fxRate.rateDate }).from(fxRate);
    expect(rows.map((r) => r.date).sort()).toEqual(["2024-03-01", "2024-03-03"]);
    expect(rows.every((r) => r.rateDate === "2024-03-01")).toBe(true);
    await rate("from=EUR&date=2024-03-01");
    await rate("from=EUR&date=2024-03-03");
    expect(first.calls).toHaveLength(1);
  });

  it("falls back to the next provider when the first fails or lacks the currency", async () => {
    const { rate } = await setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    first.failing = true;
    second.seed("2025-02-03", "EUR", { USD: "1.0335" });
    expect(await rate("from=EUR&date=2025-02-03")).toMatchObject({
      rate: "1.0335",
      source: "market",
    });
    // The first has EUR but not BDT; the second has it.
    first.failing = false;
    first.seed("2025-02-04", "BDT", { EUR: "0.0079" });
    second.seed("2025-02-04", "BDT", { USD: "0.00822" });
    expect((await rate("from=BDT&date=2025-02-04")).rate).toBe("0.00822");
    expect(first.calls.map((c) => c.base)).toEqual(["EUR", "BDT"]);
    expect(second.calls.map((c) => c.base)).toEqual(["EUR", "BDT"]);
    warn.mockRestore();
  });

  it("uses the nearest earlier known rate when every provider fails", async () => {
    const { rate } = await setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    first.seed("2025-03-03", "EUR", { USD: "1.0482" });
    await rate("from=EUR&date=2025-03-03");
    first.failing = true;
    second.failing = true;
    expect(await rate("from=EUR&date=2025-03-10")).toMatchObject({
      date: "2025-03-10",
      rate: "1.0482",
      rateDate: "2025-03-03",
      source: "market",
    });
    expect((await rate("from=USD&to=EUR&date=2025-03-10")).rate).toBe("0.954016409082");
    warn.mockRestore();
  });

  it("refuses with 422 when no rate is known at all", async () => {
    const { lookup } = await setup();
    const res = await lookup("from=EUR&date=2025-03-10");
    expect(res.status).toBe(422);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("FX_RATE_UNAVAILABLE");
  });

  it("holds a future date back to today", async () => {
    const { rate } = await setup();
    first.seed("2026-10-15", "EUR", { USD: "1.12" });
    expect(await rate("from=EUR&date=2026-12-01&today=2026-10-16")).toMatchObject({
      date: "2026-10-16",
      rateDate: "2026-10-15",
      rate: "1.12",
    });
    expect(first.calls).toEqual([{ date: "2026-10-16", base: "EUR", quotes: [] }]);
    // A recent date isn't cached under itself (its own rate may still come out), but a repeat
    // lookup within the hour is answered from the cached day.
    await rate("from=EUR&date=2026-10-16&today=2026-10-16");
    expect(first.calls).toHaveLength(1);
  });

  it("shares one fetch between concurrent identical lookups", async () => {
    const { rate } = await setup();
    first.seed("2025-04-01", "EUR", { USD: "1.0790" });
    const results = await Promise.all([
      rate("from=EUR&date=2025-04-01"),
      rate("from=EUR&date=2025-04-01"),
      rate("from=EUR&date=2025-04-01"),
    ]);
    expect(results.map((r) => r.rate)).toEqual(["1.079", "1.079", "1.079"]);
    expect(first.calls).toHaveLength(1);
  });

  it("prefers the budget's override over the market rate, both ways", async () => {
    const { rate, putOverride } = await setup();
    first.seed("2025-05-02", "EUR", { USD: "1.1300" });
    expect((await putOverride({ date: "2025-05-02", currency: "EUR", rate: "1.25" })).status).toBe(
      200,
    );
    expect(await rate("from=EUR&date=2025-05-02")).toMatchObject({
      rate: "1.25",
      source: "override",
    });
    expect((await rate("from=USD&to=EUR&date=2025-05-02")).rate).toBe("0.8");
    expect(await rate("from=EUR&date=2025-05-05")).toMatchObject({
      rate: "1.13",
      source: "market",
      rateDate: "2025-05-02",
    });
  });

  it("returns 404 to a non-member", async () => {
    const { lookup } = await setup();
    const stranger = await signUp(app);
    expect((await lookup("from=EUR&date=2025-03-10", stranger.cookie)).status).toBe(404);
  });

  it("validates the query", async () => {
    const { lookup } = await setup();
    expect((await lookup("from=XYZ&date=2025-03-10")).status).toBe(400);
    expect((await lookup("from=EUR&date=2025-13-10")).status).toBe(400);
    expect((await lookup("from=EUR")).status).toBe(400);
  });
});

describe("FX rate overrides", () => {
  it("creates, replaces, lists and deletes overrides", async () => {
    const { owner, base, putOverride } = await setup();
    const created = await json<Override>(
      await putOverride({ date: "2025-06-01", currency: "EUR", rate: "1.084200" }),
    );
    expect(created).toMatchObject({ date: "2025-06-01", currency: "EUR", rate: "1.0842" });
    const replaced = await json<Override>(
      await putOverride({ date: "2025-06-01", currency: "EUR", rate: "1.1" }),
    );
    expect(replaced).toMatchObject({ id: created.id, rate: "1.1" });
    await putOverride({ date: "2025-07-01", currency: "GBP", rate: "1.27" });

    const list = async () =>
      (
        await json<{ overrides: Override[] }>(
          await send("GET", `${base}/fx-rate-overrides`, owner.cookie),
        )
      ).overrides;
    expect((await list()).map((o) => [o.date, o.currency, o.rate])).toEqual([
      ["2025-07-01", "GBP", "1.27"],
      ["2025-06-01", "EUR", "1.1"],
    ]);

    const path = `${base}/fx-rate-overrides/${created.id}`;
    expect((await send("DELETE", path, owner.cookie)).status).toBe(204);
    expect((await send("DELETE", path, owner.cookie)).status).toBe(404);
    expect((await list()).map((o) => o.currency)).toEqual(["GBP"]);
  });

  it("refuses bad rates and the budget's own currency", async () => {
    const { putOverride } = await setup();
    for (const rate of ["0", "0.000", "-1", "1e3", "abc", "1.", "1.1234567890123", ""]) {
      const res = await putOverride({ date: "2025-06-01", currency: "EUR", rate });
      expect(res.status, rate).toBe(400);
    }
    expect((await putOverride({ date: "2025-06-01", currency: "EUR", rate: 1.1 })).status).toBe(
      400,
    );
    const same = await putOverride({ date: "2025-06-01", currency: "USD", rate: "1" });
    expect(same.status).toBe(400);
    expect((await json<{ error: { code: string } }>(same)).error.code).toBe("SAME_CURRENCY");
    expect(
      (await putOverride({ date: "2025-06-01", currency: "EUR", rate: "1.123456789012" })).status,
    ).toBe(200);
  });

  it("keeps a budget's overrides to its members", async () => {
    const { base, putOverride } = await setup();
    const created = await json<Override>(
      await putOverride({ date: "2025-06-01", currency: "EUR", rate: "1.1" }),
    );
    const stranger = await signUp(app);
    expect((await send("GET", `${base}/fx-rate-overrides`, stranger.cookie)).status).toBe(404);
    expect(
      (
        await send("PUT", `${base}/fx-rate-overrides`, stranger.cookie, {
          date: "2025-06-01",
          currency: "EUR",
          rate: "2",
        })
      ).status,
    ).toBe(404);
    expect(
      (await send("DELETE", `${base}/fx-rate-overrides/${created.id}`, stranger.cookie)).status,
    ).toBe(404);
    // An override id from another budget isn't found through this one.
    const other = await createBudget(app, stranger.cookie);
    expect(
      (
        await send(
          "DELETE",
          `/v1/budgets/${other.id}/fx-rate-overrides/${created.id}`,
          stranger.cookie,
        )
      ).status,
    ).toBe(404);
  });
});
