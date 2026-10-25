import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Payee = {
  id: string;
  name: string;
  categorization: "auto" | "always" | "never";
  defaultCategoryId: string | null;
  autoCategoryId: string | null;
  prefillCategoryId: string | null;
  recentCategoryIds: string[];
};
type Category = { id: string; name: string; linkedAccountId: string | null };
type ErrorBody = { error: { code: string } };

const TODAY = "2026-10-01";

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
  const budget = await createBudget(app, owner.cookie);
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (name: string, type: string) =>
    json<{ id: string }>(
      await send("POST", `${base}/accounts`, owner.cookie, {
        name,
        type,
        balance: "0",
        date: TODAY,
      }),
    );
  const account = await addAccount("Checking", "checking");
  const card = await addAccount("Visa", "credit_card");
  const categories = async () =>
    (
      await json<{ groups: { categories: Category[] }[] }>(
        await send("GET", `${base}/categories`, owner.cookie),
      )
    ).groups.flatMap((g) => g.categories);
  const all = await categories();
  const own = all.filter((c) => !c.linkedAccountId);
  const [a, b, c, d] = own as [Category, Category, Category, Category];
  const payment = all.find((x) => x.linkedAccountId === card.id) as Category;
  const spend = async (payeeName: string, categoryId: string | null, date = TODAY) => {
    const res = await send("POST", `${base}/transactions`, owner.cookie, {
      accountId: account.id,
      date,
      amount: "-500",
      payeeName,
      categoryId,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await json<{ id: string }>(res)).id;
  };
  const split = async (payeeName: string, categoryIds: string[]) => {
    const res = await send("POST", `${base}/transactions`, owner.cookie, {
      accountId: account.id,
      date: TODAY,
      amount: String(-100 * categoryIds.length),
      payeeName,
      categoryId: null,
      subtransactions: categoryIds.map((categoryId) => ({ amount: "-100", categoryId })),
    });
    expect(res.status, await res.clone().text()).toBe(201);
  };
  const payee = async (name: string, path = base) => {
    const list = (
      await json<{ payees: Payee[] }>(await send("GET", `${path}/payees`, owner.cookie))
    ).payees;
    const found = list.find((p) => p.name === name);
    if (!found) throw new Error(`no payee ${name}`);
    return found;
  };
  const update = (id: string, body: unknown) =>
    send("PATCH", `${base}/payees/${id}`, owner.cookie, body);
  const edit = async (id: string, body: unknown) => {
    const res = await send("PATCH", `${base}/transactions/${id}`, owner.cookie, body);
    expect(res.status, await res.clone().text()).toBe(200);
  };
  const remove = async (id: string) => {
    const res = await send("DELETE", `${base}/transactions/${id}`, owner.cookie);
    expect(res.status, await res.clone().text()).toBeLessThan(300);
  };
  return { owner, budget, base, a, b, c, d, payment, spend, split, payee, update, edit, remove };
}

describe("payee categorization", () => {
  it("auto-categorizes by two of the last three, by date", async () => {
    const { a, b, c, spend, payee } = await setup();
    await spend("Market", a.id, "2026-09-10");
    await spend("Market", a.id, "2026-09-11");
    // Entered later but dated earlier: the last three by date are b, a, a.
    await spend("Market", b.id, "2026-09-01");
    await spend("Market", b.id, "2026-09-02");
    expect(await payee("Market")).toMatchObject({
      categorization: "auto",
      autoCategoryId: a.id,
      prefillCategoryId: a.id,
      recentCategoryIds: [a.id, b.id],
    });
    await spend("Market", c.id, "2026-09-12");
    await spend("Market", c.id, "2026-09-13");
    expect((await payee("Market")).prefillCategoryId).toBe(c.id);
  });

  it("keeps the default through an edit the last three don't agree on", async () => {
    const { a, b, c, spend, payee, edit } = await setup();
    await spend("Market", a.id, "2026-09-01");
    await spend("Market", b.id, "2026-09-02");
    const last = await spend("Market", b.id, "2026-09-03");
    expect((await payee("Market")).autoCategoryId).toBe(b.id);
    // a, b, c don't agree, so b stays (replaying the history would give a).
    await edit(last, { categoryId: c.id });
    expect((await payee("Market")).autoCategoryId).toBe(b.id);
    // An edit that makes two of the last three agree switches it.
    await edit(last, { categoryId: a.id });
    expect((await payee("Market")).autoCategoryId).toBe(a.id);
  });

  it("keeps the default when a transaction is deleted", async () => {
    const { a, b, spend, payee, remove } = await setup();
    await spend("Market", a.id, "2026-09-01");
    await spend("Market", b.id, "2026-09-02");
    const last = await spend("Market", b.id, "2026-09-03");
    expect((await payee("Market")).autoCategoryId).toBe(b.id);
    await remove(last);
    // a, b left: a replay would give a; b stays.
    expect((await payee("Market")).autoCategoryId).toBe(b.id);
  });

  it("keeps the combine target's setting and default", async () => {
    const { owner, base, a, b, c, spend, payee, update } = await setup();
    await spend("Shop E", a.id, "2026-09-01");
    await spend("Shop E", b.id, "2026-09-05");
    await spend("Shop D", c.id, "2026-09-06");
    await spend("Shop D", c.id, "2026-09-07");
    const d = await payee("Shop D");
    await update(d.id, { categorization: "always", defaultCategoryId: b.id });
    const e = await payee("Shop E");
    const res = await send("POST", `${base}/payees/combine`, owner.cookie, {
      payeeIds: [d.id, e.id],
      name: "Shop E",
    });
    expect(res.status).toBe(200);
    // The merged history ends c, c; the target still says a.
    expect(await payee("Shop E")).toMatchObject({ categorization: "auto", autoCategoryId: a.id });
  });

  it("leaves splits and Uncategorized out of the default but suggests split lines", async () => {
    const { a, b, c, d, spend, split, payee } = await setup();
    await spend("Market", b.id);
    await spend("Market", b.id);
    await split("Market", [a.id, c.id]);
    await split("Market", [a.id, a.id]);
    await spend("Market", null);
    await spend("Market", d.id);
    const market = await payee("Market");
    expect(market.autoCategoryId).toBe(b.id);
    // Newest first, each once: d, then the second split's a, the first split's c.
    expect(market.recentCategoryIds).toEqual([d.id, a.id, c.id, b.id]);
  });

  it("always uses the chosen category, or none, and forgets the choice when switched back", async () => {
    const { a, b, spend, payee, update } = await setup();
    await spend("Market", a.id);
    const market = await payee("Market");

    let res = await update(market.id, { categorization: "always", defaultCategoryId: b.id });
    expect(res.status).toBe(200);
    expect(await json<Payee>(res)).toMatchObject({
      categorization: "always",
      defaultCategoryId: b.id,
      autoCategoryId: a.id,
      prefillCategoryId: b.id,
    });

    res = await update(market.id, { categorization: "never" });
    expect(await json<Payee>(res)).toMatchObject({
      categorization: "never",
      defaultCategoryId: null,
      autoCategoryId: a.id,
      prefillCategoryId: null,
    });

    res = await update(market.id, { categorization: "auto" });
    expect(await json<Payee>(res)).toMatchObject({
      categorization: "auto",
      prefillCategoryId: a.id,
    });
  });

  it("refuses always without a usable category", async () => {
    const { a, payment, spend, payee, update } = await setup();
    await spend("Market", a.id);
    const market = await payee("Market");
    const code = async (body: unknown) => {
      const res = await update(market.id, body);
      expect(res.status).toBe(400);
      return (await json<ErrorBody>(res)).error.code;
    };
    expect(await code({ categorization: "always" })).toBe("CATEGORY_REQUIRED");
    expect(await code({ categorization: "always", defaultCategoryId: null })).toBe(
      "CATEGORY_REQUIRED",
    );
    expect(await code({ categorization: "always", defaultCategoryId: payment.id })).toBe(
      "INVALID_CATEGORY",
    );
    const other = await setup();
    expect(await code({ categorization: "always", defaultCategoryId: other.a.id })).toBe(
      "INVALID_CATEGORY",
    );
    expect((await payee("Market")).categorization).toBe("auto");
  });

  it("refuses a hidden category as a new choice, but keeps one chosen before it was hidden", async () => {
    const { owner, base, a, b, spend, payee, update } = await setup();
    await spend("Market", a.id);
    const market = await payee("Market");
    expect(
      (await update(market.id, { categorization: "always", defaultCategoryId: a.id })).status,
    ).toBe(200);
    const hide = await send("PATCH", `${base}/categories/${b.id}`, owner.cookie, { hidden: true });
    expect(hide.status).toBe(200);
    const res = await update(market.id, { categorization: "always", defaultCategoryId: b.id });
    expect(res.status).toBe(400);
    expect((await json<ErrorBody>(res)).error.code).toBe("INVALID_CATEGORY");
    // Hiding the chosen category later doesn't block other changes to the payee.
    await send("PATCH", `${base}/categories/${a.id}`, owner.cookie, { hidden: true });
    expect((await update(market.id, { categorization: "always" })).status).toBe(200);
    // Switching to auto forgets it; undo (`restore`) brings it back, hidden or not.
    expect((await update(market.id, { categorization: "auto" })).status).toBe(200);
    const fresh = await update(market.id, { categorization: "always", defaultCategoryId: a.id });
    expect(fresh.status).toBe(400);
    const undo = await update(market.id, {
      categorization: "always",
      defaultCategoryId: a.id,
      restore: true,
    });
    expect(undo.status).toBe(200);
    expect((await payee("Market")).defaultCategoryId).toBe(a.id);
  });

  it("keeps the setting through a delete and its undo", async () => {
    const { owner, base, a, b, spend, payee, update } = await setup();
    await spend("Market", a.id);
    const market = await payee("Market");
    await update(market.id, { categorization: "always", defaultCategoryId: b.id });
    const deleted = await json<{ snapshot: unknown }>(
      await send("POST", `${base}/payees/delete`, owner.cookie, {
        payeeIds: [market.id],
        replacementPayeeId: null,
      }),
    );
    expect(
      (await send("POST", `${base}/payees/restore`, owner.cookie, deleted.snapshot)).status,
    ).toBe(204);
    expect(await payee("Market")).toMatchObject({
      categorization: "always",
      defaultCategoryId: b.id,
    });
  });

  it("carries each payee's setting and default into a fresh start", async () => {
    const { owner, budget, a, b, c, spend, payee, update } = await setup();
    await spend("Market", a.id);
    await spend("Bakery", c.id);
    await spend("Corner Shop", a.id);
    await update((await payee("Bakery")).id, { categorization: "always", defaultCategoryId: b.id });
    await update((await payee("Corner Shop")).id, { categorization: "never" });
    const res = await send("POST", `/v1/budgets/${budget.id}/fresh-start`, owner.cookie, {
      date: TODAY,
      name: "Fresh",
    });
    expect(res.status).toBe(201);
    const fresh = `/v1/budgets/${(await json<{ id: string }>(res)).id}`;
    const freshCategories = (
      await json<{ groups: { categories: Category[] }[] }>(
        await send("GET", `${fresh}/categories`, owner.cookie),
      )
    ).groups.flatMap((g) => g.categories);
    const named = (name: string) => freshCategories.find((x) => x.name === name)?.id;

    // No transactions came along, but the default did.
    expect(await payee("Market", fresh)).toMatchObject({
      categorization: "auto",
      autoCategoryId: named(a.name),
      prefillCategoryId: named(a.name),
      recentCategoryIds: [],
    });
    expect(await payee("Bakery", fresh)).toMatchObject({
      categorization: "always",
      defaultCategoryId: named(b.name),
      autoCategoryId: named(c.name),
    });
    expect(await payee("Corner Shop", fresh)).toMatchObject({
      categorization: "never",
      prefillCategoryId: null,
    });
  });
});
