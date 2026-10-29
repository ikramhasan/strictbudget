import { budget as budgetTable } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  signUp,
  type TestBudget,
} from "../../../test/helpers";
import type { FakeFxProvider } from "../../lib/fx/fake";

const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset().seed("2026-08-01", "EUR", { USD: "1.1" }).seed("2026-09-10", "EUR", { USD: "1.2" });
});
afterAll(close);

const TODAY = "2026-10-15";

type Account = { id: string; name: string; balances: Record<string, string> };
type Category = { id: string; name: string };
type Group = { id: string; name: string; kind: string | null; categories: Category[] };
type Month = { firstMonth: string; lastMonth: string; readyToAssign: string };
type Imported = { budget: TestBudget; counts: Record<string, number> };

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function ok<T>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const r = await res;
  expect(r.status, await r.clone().text()).toBe(status);
  return (await r.json()) as T;
}

/** A budget with a bit of everything a backup has to carry. */
async function richBudget() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie, { name: "Household" });
  const base = `/v1/budgets/${budget.id}`;
  const account = (input: Record<string, unknown>) =>
    ok<Account>(send("POST", `${base}/accounts`, cookie, { date: "2026-08-01", ...input }), 201);
  const post = (input: Record<string, unknown>) =>
    ok<{ id: string }>(
      send("POST", `${base}/transactions`, cookie, { categoryId: null, ...input }),
      201,
    );

  const checking = await account({ name: "Checking", type: "checking", balance: "500000" });
  const savings = await account({ name: "Savings", type: "savings", balance: "100000" });
  const visa = await account({ name: "Visa", type: "credit_card", balance: "-25000" });
  const euro = await account({ name: "Euro", type: "checking", balance: "20000", currency: "EUR" });
  const house = await account({ name: "House", type: "asset", balance: "30000000" });
  const mortgage = await account({
    name: "Mortgage",
    type: "mortgage",
    balance: "-20000000",
    interestRate: "6.125",
    minimumPayment: "150000",
  });
  const old = await account({ name: "Old", type: "cash", balance: "0" });
  await send("POST", `${base}/accounts/${old.id}/close`, cookie, { date: TODAY });

  const list = await ok<{ groups: Group[]; readyToAssignCategoryId: string }>(
    send("GET", `${base}/categories`, cookie),
  );
  const groups = list.groups;
  const [rent, phone, power] = groups.find((g) => g.name === "Bills")?.categories ?? [];
  const [groceries, transport] = groups.find((g) => g.name === "Needs")?.categories ?? [];
  if (!rent || !phone || !power || !groceries || !transport) throw new Error("categories missing");
  await send("PATCH", `${base}/categories/${power.id}`, cookie, { hidden: true });
  await send("PUT", `${base}/reports/spending-pace/categories/${rent.id}`, cookie, {
    pace: "include",
  });
  await send("PUT", `${base}/reports/savings-rate/categories/${transport.id}`, cookie, {
    countsAsSaving: true,
  });
  await send("PATCH", base, cookie, { savingsRateGoal: 1500 });
  const assign = (categoryId: string, month: string, assigned: string) =>
    ok(
      send("PUT", `${base}/months/${month}/categories/${categoryId}`, cookie, {
        assigned,
        today: TODAY,
      }),
    );
  await assign(rent.id, "2026-08", "150000");
  await assign(groceries.id, "2026-09", "40000");
  await assign(groceries.id, "2026-10", "45000");
  await assign(phone.id, "2026-11", "6000");
  await ok(
    send("PUT", `${base}/categories/${groceries.id}/target`, cookie, {
      cadence: "monthly",
      behavior: "set_aside",
      amount: "45000",
      dueDay: null,
      month: "2026-10",
      today: TODAY,
    }),
  );
  await ok(send("PUT", `${base}/months/2026-10/note`, cookie, { note: "Tight month" }));
  await ok(send("PUT", `${base}/flags/red`, cookie, { name: "Reimburse" }));
  await ok(
    send("POST", `${base}/views`, cookie, { name: "Food", categoryIds: [groceries.id] }),
    201,
  );
  await ok(
    send("PUT", `${base}/fx-rate-overrides`, cookie, {
      date: "2026-09-01",
      currency: "EUR",
      rate: "1.15",
    }),
  );

  await post({
    accountId: checking.id,
    date: "2026-08-05",
    amount: "-140000",
    payeeName: "Landlord",
    categoryId: rent.id,
    cleared: "cleared",
  });
  await post({
    accountId: visa.id,
    date: "2026-09-12",
    amount: "-12000",
    payeeName: "Market",
    flag: "red",
    subtransactions: [
      { amount: "-8000", categoryId: groceries.id, memo: "food" },
      { amount: "-4000", categoryId: transport.id },
    ],
  });
  // A split with a transfer line, and a plain transfer paying the card.
  await post({
    accountId: checking.id,
    date: "2026-09-20",
    amount: "-30000",
    payeeName: "Mixed",
    subtransactions: [
      { amount: "-10000", categoryId: groceries.id },
      { amount: "-20000", transferAccountId: savings.id },
    ],
  });
  await post({
    accountId: checking.id,
    date: "2026-10-02",
    amount: "-15000",
    transferAccountId: visa.id,
  });
  await post({ accountId: euro.id, date: "2026-09-10", amount: "-5000", categoryId: groceries.id });
  await post({ accountId: checking.id, date: "2026-10-03", amount: "-2500", payeeName: "Cafe" });
  await post({
    accountId: checking.id,
    date: "2026-10-04",
    amount: "120000",
    payeeName: "Employer",
    categoryId: list.readyToAssignCategoryId,
  });
  await post({
    accountId: checking.id,
    date: "2026-10-06",
    amount: "-150000",
    transferAccountId: mortgage.id,
  });
  await ok(
    send("POST", `${base}/accounts/${checking.id}/reconcile`, cookie, {
      balance: "200000",
      date: TODAY,
    }),
  );
  await ok(
    send("POST", `${base}/scheduled-transactions`, cookie, {
      accountId: checking.id,
      frequency: "monthly",
      date: "2026-12-01",
      amount: "-140000",
      payeeName: "Landlord",
      categoryId: rent.id,
      memo: "rent",
      today: TODAY,
    }),
    201,
  );
  await ok(
    send("POST", `${base}/scheduled-transactions`, cookie, {
      accountId: visa.id,
      frequency: "never",
      date: "2026-12-05",
      amount: "-3000",
      payeeName: "Shop",
      memo: "split",
      subtransactions: [
        { amount: "-2000", categoryId: groceries.id },
        { amount: "-1000", categoryId: transport.id },
      ],
      today: TODAY,
    }),
    201,
  );
  const landlord = (
    await ok<{ payees: { id: string; name: string }[] }>(send("GET", `${base}/payees`, cookie))
  ).payees.find((p) => p.name === "Landlord");
  if (landlord) {
    await send("POST", `${base}/payees/${landlord.id}/rules`, cookie, {
      operator: "contains",
      text: "LANDLORD",
    });
  }
  return { cookie, budget, base, house };
}

/** Every month the budget shows, as the API computes it. */
async function months(base: string, cookie: string) {
  const first = await ok<Month>(send("GET", `${base}/months/2026-10?today=${TODAY}`, cookie));
  const out: unknown[] = [];
  for (let m = first.firstMonth; m <= first.lastMonth; ) {
    out.push(await ok(send("GET", `${base}/months/${m}?today=${TODAY}`, cookie)));
    const [y, mo] = m.split("-").map(Number) as [number, number];
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return out;
}

/** The two budgets' ids for the same things, matched by name. */
async function idPairs(oldBase: string, newBase: string, cookie: string) {
  const pairs = new Map<string, string>();
  const named = async (base: string) => {
    const { groups } = await ok<{ groups: Group[] }>(send("GET", `${base}/categories`, cookie));
    const { accounts } = await ok<{ accounts: Account[] }>(
      send("GET", `${base}/accounts?today=${TODAY}`, cookie),
    );
    const { scheduledTransactions } = await ok<{
      scheduledTransactions: { id: string; memo: string }[];
    }>(send("GET", `${base}/scheduled-transactions?today=${TODAY}`, cookie));
    return new Map<string, string>([
      ...groups.flatMap((g) => [
        [`group:${g.name}`, g.id] as const,
        ...g.categories.map((c) => [`category:${g.name}/${c.name}`, c.id] as const),
      ]),
      ...accounts.map((a) => [`account:${a.name}`, a.id] as const),
      ...scheduledTransactions.map((s) => [`schedule:${s.memo}`, s.id] as const),
    ]);
  };
  const before = await named(oldBase);
  const after = await named(newBase);
  for (const [key, id] of before) {
    const other = after.get(key);
    if (other) pairs.set(id, other);
  }
  return pairs;
}

const remap = (value: unknown, pairs: Map<string, string>): unknown =>
  JSON.parse(JSON.stringify(value), (_k, v) => (typeof v === "string" ? (pairs.get(v) ?? v) : v));

describe("budget backup", () => {
  it("round-trips: export, import as a new budget, identical computed months", async () => {
    const { cookie, budget, base } = await richBudget();
    const res = await send("GET", `${base}/backup`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("Household");
    const backup = (await res.json()) as Record<string, unknown> & {
      transactions: { id: string; amount: string }[];
    };
    expect(backup).toMatchObject({ format: "strictbudget-backup", version: 1 });
    expect(typeof backup.transactions[0]?.amount).toBe("string");

    const imported = await ok<Imported>(
      send("POST", "/v1/budgets/import?name=Restored", cookie, backup),
      201,
    );
    expect(imported.budget).toMatchObject({ name: "Restored", currency: "USD", role: "owner" });
    expect(imported.counts.transactions).toBe(backup.transactions.length);
    expect(imported.counts.scheduledSubTransactions).toBe(2);
    const newBase = `/v1/budgets/${imported.budget.id}`;
    const again = (await (await send("GET", `${newBase}/backup`, cookie)).json()) as {
      transactions: { id: string }[];
    };
    const oldIds = new Set(backup.transactions.map((t) => t.id));
    expect(again.transactions.some((t) => oldIds.has(t.id))).toBe(false);

    const pairs = await idPairs(base, newBase, cookie);
    const before = await months(base, cookie);
    const after = await months(newBase, cookie);
    expect(before.length).toBeGreaterThan(3);
    expect(after).toEqual(remap(before, pairs));

    const paceSettings = async (b: string) =>
      (
        await ok<{ categories: { name: string; setting: string | null }[] }>(
          send("GET", `${b}/reports/spending-pace?today=${TODAY}`, cookie),
        )
      ).categories.map((c) => [c.name, c.setting]);
    expect(await paceSettings(newBase)).toEqual(await paceSettings(base));
    expect(await paceSettings(newBase)).toContainEqual(["🏠 Rent/Mortgage", "include"]);
    const savingSettings = async (b: string) => {
      const r = await ok<{
        goal: number | null;
        categories: { name: string; countsAsSaving: boolean }[];
      }>(send("GET", `${b}/reports/savings-rate?from=2026-10&to=2026-10&today=${TODAY}`, cookie));
      return {
        goal: r.goal,
        saving: r.categories.filter((c) => c.countsAsSaving).map((c) => c.name),
      };
    };
    expect(await savingSettings(newBase)).toEqual(await savingSettings(base));
    expect((await savingSettings(newBase)).goal).toBe(1500);
    expect((await savingSettings(newBase)).saving).toHaveLength(1);

    const accounts = async (b: string) =>
      (await ok<{ accounts: unknown[] }>(send("GET", `${b}/accounts?today=${TODAY}`, cookie)))
        .accounts;
    expect(await accounts(newBase)).toEqual(remap(await accounts(base), pairs));

    // The original is untouched and the same file imports again as another copy.
    const second = await ok<Imported>(send("POST", "/v1/budgets/import", cookie, backup), 201);
    expect(second.budget.name).toBe("Household");
    expect(second.budget.id).not.toBe(imported.budget.id);
    expect(budget.id).not.toBe(second.budget.id);
  });

  it("keeps file imports' ids, settings and matches", async () => {
    const { cookie } = await signUp(app);
    const budget = await createBudget(app, cookie, { name: "Imports" });
    const base = `/v1/budgets/${budget.id}`;
    const checking = await ok<Account>(
      send("POST", `${base}/accounts`, cookie, {
        name: "Checking",
        type: "checking",
        balance: "0",
        date: "2026-10-01",
      }),
      201,
    );
    await ok(
      send("POST", `${base}/transactions`, cookie, {
        accountId: checking.id,
        date: "2026-10-10",
        amount: "-2000",
        payeeName: "Mine",
        categoryId: null,
        memo: "",
        flag: null,
      }),
      201,
    );
    const file = [
      { date: "2026-10-11", amount: "-2000", payee: "BANK A", memo: "" },
      { date: "2026-10-12", amount: "-300", payee: "BANK B", memo: "" },
    ];
    const settings = {
      columns: ["date", "payee", "amount"],
      mapping: { date: 0, payee: 1, memo: null, outflow: 2, inflow: 2 },
      noHeaderRow: false,
      swapInflowOutflow: false,
      dateFormat: "YYYY-MM-DD",
    };
    await ok(
      send("POST", `${base}/accounts/${checking.id}/import?today=2026-10-17`, cookie, {
        transactions: file,
        csvSettings: settings,
      }),
    );
    const backup = await ok<Record<string, unknown>>(send("GET", `${base}/backup`, cookie));
    const restored = await ok<Imported>(send("POST", "/v1/budgets/import", cookie, backup), 201);
    expect(restored.counts.accountImportIds).toBe(2);
    const newBase = `/v1/budgets/${restored.budget.id}`;
    const [account] = (
      await ok<{ accounts: Account[] }>(send("GET", `${newBase}/accounts`, cookie))
    ).accounts;
    if (!account) throw new Error("no account");
    // The same file adds nothing, the settings came along, and the match is still a match.
    const again = await ok<{ imported: number; duplicates: number }>(
      send("POST", `${newBase}/accounts/${account.id}/import?today=2026-10-17`, cookie, {
        transactions: file,
      }),
    );
    expect(again).toMatchObject({ imported: 0, duplicates: 2 });
    const context = await ok<{ csvSettings: unknown }>(
      send("GET", `${newBase}/accounts/${account.id}/import-context`, cookie),
    );
    expect(context.csvSettings).toEqual(settings);
    const matched = await ok<{ transactions: { payeeName: string; matched: unknown }[] }>(
      send(
        "GET",
        `${newBase}/transactions?accountId=${account.id}&q=${encodeURIComponent("Is: Matched")}`,
        cookie,
      ),
    );
    expect(matched.transactions.map((t) => t.payeeName)).toEqual(["Mine"]);
  });

  it("refuses a backup that doesn't hold together, keeping nothing", async () => {
    const { cookie, base } = await richBudget();
    const backup = (await (await send("GET", `${base}/backup`, cookie)).json()) as {
      transactions: { accountId: string }[];
    };
    const [first] = backup.transactions;
    if (first) first.accountId = "missing";
    const res = await send("POST", "/v1/budgets/import", cookie, backup);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_BACKUP");
    const rows = await db.select().from(budgetTable).where(eq(budgetTable.name, "Household"));
    expect(rows).toHaveLength(1);

    const wrong = await send("POST", "/v1/budgets/import", cookie, { format: "x", version: 9 });
    expect(wrong.status).toBe(400);
  });

  it("is only for members", async () => {
    const { base } = await richBudget();
    const stranger = await signUp(app);
    expect((await send("GET", `${base}/backup`, stranger.cookie)).status).toBe(404);
  });
});
