import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  shareBudget,
  signUp,
} from "../../../test/helpers";
import type { FakeFxProvider } from "../../lib/fx/fake";

const { app, db, close, fxProviders } = createTestApp();
const fx = fxProviders[0] as FakeFxProvider;
beforeEach(async () => {
  await resetDatabase(db);
  fx.reset().seed("2026-09-01", "EUR", { USD: "1.5" });
});
afterAll(close);

type Account = { id: string };
type Category = { id: string; name: string };
type Group = { id: string; name: string; kind: string | null; categories: Category[] };

const TODAY = "2026-10-15";

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup(budgetInput: Record<string, string> = {}) {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie, { name: "Bob's Plan", ...budgetInput });
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (name: string, type: string, balance: string, extra = {}) =>
    json<Account>(
      await send("POST", `${base}/accounts`, cookie, {
        name,
        type,
        balance,
        date: "2026-09-01",
        ...extra,
      }),
    );
  const groups = async () =>
    (await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, cookie))).groups;
  const post = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions`, cookie, {
      categoryId: null,
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<{ id: string }>(res);
  };
  return { cookie, budget, base, addAccount, groups, post };
}

const lines = (text: string) => text.split("\r\n");
// `Response.text()` drops the byte-order mark.
const body = async (res: Response) =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());

describe("plan export", () => {
  it("writes the plan file: every category's month, hidden ones last", async () => {
    const { cookie, base, addAccount, groups, post } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const [first] = (await groups()).filter((g) => !g.kind);
    const [groceries, other] = first?.categories ?? [];
    if (!first || !groceries || !other) throw new Error("starter categories missing");
    await send("PUT", `${base}/months/2026-10/categories/${groceries.id}`, cookie, {
      assigned: "123456",
      today: TODAY,
    });
    await post({
      accountId: checking.id,
      date: "2026-10-02",
      amount: "-5000",
      categoryId: groceries.id,
    });
    await send("PATCH", `${base}/categories/${other.id}`, cookie, { hidden: true });

    const res = await send("GET", `${base}/export/plan?today=${TODAY}`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await body(res);
    const rows = lines(text);
    expect(rows[0]).toBe(
      '﻿"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"',
    );
    expect(text.endsWith("\r\n")).toBe(false);
    expect(rows).toContain(
      `"Oct 2026","${first.name}: ${groceries.name}","${first.name}","${groceries.name}",$1234.56,-$50.00,$1184.56`,
    );
    expect(rows).toContain(
      `"Oct 2026","Hidden Categories: ${other.name}","Hidden Categories","${other.name}",$0.00,$0.00,$0.00`,
    );
    const october = rows.filter((r) => r.startsWith('"Oct 2026"'));
    expect(october.at(-1)).toContain("Hidden Categories");
    // From the first month with a transaction (September's starting balance) to next month.
    expect(rows.some((r) => r.startsWith('"Sep 2026"'))).toBe(true);
    expect(rows.some((r) => r.startsWith('"Nov 2026"'))).toBe(true);
  });

  it("is tab-separated for a comma-decimal number format", async () => {
    const { cookie, base } = await setup({ numberFormat: "dot_comma", currency: "EUR" });
    const res = await send("GET", `${base}/export/plan?today=${TODAY}`, cookie);
    expect(res.headers.get("content-type")).toContain("text/tab-separated-values");
    const [header, row] = lines(await body(res));
    expect(header?.split("\t")).toHaveLength(7);
    expect(row?.split("\t").at(-1)).toMatch(/^€0,00$/);
  });

  it("is only for members", async () => {
    const { base } = await setup();
    const stranger = await signUp(app);
    expect((await send("GET", `${base}/export/plan`, stranger.cookie)).status).toBe(404);
    expect((await send("GET", `${base}/export/register`, stranger.cookie)).status).toBe(404);
  });
});

describe("register export", () => {
  it("writes the register file: newest first, splits by line, transfers and flags", async () => {
    const { cookie, base, addAccount, groups, post } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const savings = await addAccount("Savings", "savings", "0");
    const [first] = (await groups()).filter((g) => !g.kind);
    const [groceries, other] = first?.categories ?? [];
    if (!first || !groceries || !other) throw new Error("starter categories missing");
    await send("PUT", `${base}/flags/red`, cookie, { name: "Reimburse" });
    await post({
      accountId: checking.id,
      date: "2026-10-03",
      amount: "-1500",
      payeeName: "=Shop",
      memo: 'say "hi"',
      categoryId: groceries.id,
      flag: "red",
    });
    await post({
      accountId: checking.id,
      date: "2026-10-03",
      amount: "-9000",
      payeeName: "Market",
      flag: "blue",
      subtransactions: [
        { amount: "-6000", categoryId: groceries.id, memo: "food" },
        { amount: "-3000", categoryId: other.id },
      ],
    });
    await post({
      accountId: checking.id,
      date: "2026-10-04",
      amount: "-2500",
      transferAccountId: savings.id,
    });

    const res = await send("GET", `${base}/export/register`, cookie);
    expect(res.status).toBe(200);
    const rows = lines(await body(res));
    expect(rows[0]).toBe(
      '﻿"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
    );
    const g = first.name;
    expect(rows.slice(1)).toEqual([
      // Oct 4: the transfer, the smaller amount (outflow) first.
      `"Checking","","10/04/2026","Transfer : Savings","","","","",$25.00,$0.00,"Uncleared"`,
      `"Savings","","10/04/2026","Transfer : Checking","","","","",$0.00,$25.00,"Uncleared"`,
      // Oct 3: the split (−90) before the −15 purchase; each line has the parent's payee.
      `"Checking","Blue","10/03/2026","Market","${g}: ${groceries.name}","${g}","${groceries.name}","Split (1/2) food",$60.00,$0.00,"Uncleared"`,
      `"Checking","Blue","10/03/2026","Market","${g}: ${other.name}","${g}","${other.name}","Split (2/2) ",$30.00,$0.00,"Uncleared"`,
      `"Checking","Reimburse","10/03/2026","\\=Shop","${g}: ${groceries.name}","${g}","${groceries.name}","say ""hi""",$15.00,$0.00,"Uncleared"`,
      `"Savings","","09/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$0.00,"Cleared"`,
      `"Checking","","09/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$1000.00,"Cleared"`,
    ]);
  });

  it("exports selected transactions without a byte-order mark", async () => {
    const { cookie, base, addAccount, post } = await setup();
    const checking = await addAccount("Checking", "checking", "100000");
    const picked = await post({
      accountId: checking.id,
      date: "2026-10-03",
      amount: "-1500",
      payeeName: "Shop",
    });
    await post({ accountId: checking.id, date: "2026-10-04", amount: "-100", payeeName: "Other" });
    const res = await send("POST", `${base}/export/transactions`, cookie, {
      selection: { ids: [picked.id] },
    });
    expect(res.status).toBe(200);
    const rows = lines(await body(res));
    expect(rows[0]?.startsWith('"Account"')).toBe(true);
    expect(rows.slice(1)).toEqual([
      `"Checking","","10/03/2026","Shop","","","","",$15.00,$0.00,"Uncleared"`,
    ]);
  });

  it("lets a viewer export", async () => {
    const { cookie, budget, base, addAccount, post } = await setup();
    const checking = await addAccount("Checking", "checking", "0");
    const t = await post({ accountId: checking.id, date: "2026-10-03", amount: "-100" });
    const viewer = await shareBudget(app, cookie, budget.id, { role: "viewer" });
    const res = await send("POST", `${base}/export/transactions`, viewer.cookie, {
      selection: { ids: [t.id] },
    });
    expect(res.status).toBe(200);
    expect(lines(await body(res))).toHaveLength(2);
  });

  it("adds the currency columns when an account is in another currency", async () => {
    const { cookie, base, addAccount } = await setup();
    await addAccount("Euro", "checking", "1000", { currency: "EUR" });
    const rows = lines(await body(await send("GET", `${base}/export/register`, cookie)));
    expect(rows[0]).toContain('"Cleared","Currency","FX Rate","Base Outflow","Base Inflow"');
    expect(rows[1]).toMatch(/^"Euro",.*,\$0\.00,\$15\.00$/);
    expect(rows[1]).toContain('"EUR","1.5');
  });
});
