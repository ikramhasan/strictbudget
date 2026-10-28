import { category, payee, transaction } from "@strictbudget/db/schema";
import { eq } from "drizzle-orm";
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
  fx.reset().seed("2026-10-01", "EUR", { USD: "1.1" }).seed("2026-10-11", "EUR", { USD: "1.2" });
});
afterAll(close);

type Txn = {
  id: string;
  date: string;
  amount: string;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  memo: string;
  cleared: string;
  approved: boolean;
  baseAmount: string;
  fxRate: string | null;
  version: number;
};
type Result = {
  imported: number;
  matched: number;
  duplicates: number;
  transactionIds: string[];
  matchedIds: string[];
};

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
  const addAccount = async (name: string, type = "checking", currency?: string) =>
    json<{ id: string }>(
      await send("POST", `${base}/accounts`, owner.cookie, {
        name,
        type,
        balance: "0",
        date: "2026-10-01",
        ...(currency ? { currency } : {}),
      }),
    );
  const checking = await addAccount("Checking");
  const importFile = async (
    rows: unknown[],
    extra: Record<string, unknown> = {},
    accountId = checking.id,
  ) => {
    const res = await send(
      "POST",
      `${base}/accounts/${accountId}/import?today=2026-10-17`,
      owner.cookie,
      {
        transactions: rows,
        ...extra,
      },
    );
    expect(res.status, await res.clone().text()).toBe(200);
    return json<Result>(res);
  };
  const rows = async (accountId = checking.id) =>
    (
      await json<{ transactions: Txn[] }>(
        await send("GET", `${base}/transactions?accountId=${accountId}&limit=500`, owner.cookie),
      )
    ).transactions.filter((t) => t.payeeName !== "Starting Balance");
  const { groups } = await json<{
    groups: { kind: string | null; categories: { id: string; name: string }[] }[];
  }>(await send("GET", `${base}/categories`, owner.cookie));
  const groceries = groups.filter((g) => !g.kind).flatMap((g) => g.categories)[3];
  if (!groceries) throw new Error("starter categories missing");
  return { owner, budget, base, checking, addAccount, importFile, rows, groceries };
}

const coffee = { date: "2026-10-10", amount: "-450", payee: "x Coffee Shop", memo: "latte" };
const pay = { date: "2026-10-11", amount: "120000", payee: "x Employer", memo: "paycheck" };
const zero = { date: "2026-10-12", amount: "0", payee: "x Zero", memo: "" };

describe("file import", () => {
  it("adds rows cleared and unapproved, keeping memos and $0 rows", async () => {
    const { importFile, rows, base, owner } = await setup();
    const result = await importFile([coffee, pay, zero]);
    expect(result).toMatchObject({ imported: 3, duplicates: 0 });
    const list = await rows();
    expect(list.map((t) => [t.date, t.amount, t.payeeName, t.memo, t.cleared, t.approved])).toEqual(
      [
        ["2026-10-12", "0", "x Zero", "", "cleared", false],
        ["2026-10-11", "120000", "x Employer", "paycheck", "cleared", false],
        ["2026-10-10", "-450", "x Coffee Shop", "latte", "cleared", false],
      ],
    );
    // An inflow from a new payee goes to Ready to Assign; outflows stay Uncategorized.
    expect(list.map((t) => t.categoryName)).toEqual([
      "Uncategorized",
      "Inflow: Ready to Assign",
      "Uncategorized",
    ]);
    const accounts = await json<{ accounts: { name: string; toReview: number }[] }>(
      await send("GET", `${base}/accounts`, owner.cookie),
    );
    expect(accounts.accounts.find((a) => a.name === "Checking")?.toReview).toBe(3);
  });

  it("skips rows imported before, even after they're deleted", async () => {
    const { importFile, rows, base, owner } = await setup();
    await importFile([coffee, coffee, pay]);
    expect(await importFile([coffee, coffee, pay])).toMatchObject({ imported: 0, duplicates: 3 });
    // A third coffee that day is a new row (the file's third occurrence).
    expect(await importFile([coffee, coffee, coffee])).toMatchObject({
      imported: 1,
      duplicates: 2,
    });
    const [first] = await rows();
    if (!first) throw new Error("no rows");
    expect((await send("DELETE", `${base}/transactions/${first.id}`, owner.cookie)).status).toBe(
      204,
    );
    expect(await importFile([coffee, coffee, coffee, pay])).toMatchObject({
      imported: 0,
      duplicates: 4,
    });
    expect(await rows()).toHaveLength(3);
  });

  it("takes in each row once when the same file is imported twice at once", async () => {
    const { importFile, rows } = await setup();
    const [a, b] = await Promise.all([importFile([coffee, pay]), importFile([coffee, pay])]);
    expect((a?.imported ?? 0) + (b?.imported ?? 0)).toBe(2);
    expect((a?.duplicates ?? 0) + (b?.duplicates ?? 0)).toBe(2);
    expect(await rows()).toHaveLength(2);
  });

  it("keeps each account's import ids to itself", async () => {
    const { importFile, addAccount } = await setup();
    const savings = await addAccount("Savings", "savings");
    await importFile([coffee]);
    expect(await importFile([coffee], {}, savings.id)).toMatchObject({ imported: 1 });
  });

  it("renames payees by the plan's rules and uses the payee's usual category", async () => {
    const { importFile, rows, base, owner, checking, groceries } = await setup();
    const res = await send("POST", `${base}/transactions`, owner.cookie, {
      accountId: checking.id,
      date: "2026-10-02",
      amount: "-100",
      payeeName: "Market",
      categoryId: groceries.id,
      memo: "",
      flag: null,
    });
    const market = (await json<Txn>(res)).payeeId;
    await send("POST", `${base}/payees/${market}/rules`, owner.cookie, {
      operator: "contains",
      text: "MKT",
    });
    await importFile([{ date: "2026-10-12", amount: "-2500", payee: "POS MKT #123", memo: "" }]);
    const [row] = await rows();
    expect(row).toMatchObject({ payeeName: "Market", categoryId: groceries.id, approved: false });
  });

  it("takes in a year-long file of 5,000 rows in seconds", async () => {
    const { importFile, base, owner, checking, groceries } = await setup();
    // A payee with a usual category and a rule, so the file exercises every lookup.
    const res = await send("POST", `${base}/transactions`, owner.cookie, {
      accountId: checking.id,
      date: "2026-10-02",
      amount: "-100",
      payeeName: "Market",
      categoryId: groceries.id,
      memo: "",
      flag: null,
    });
    const market = (await json<Txn>(res)).payeeId;
    await send("POST", `${base}/payees/${market}/rules`, owner.cookie, {
      operator: "contains",
      text: "MKT",
    });
    const day = (i: number) =>
      new Date(Date.UTC(2025, 9, 18) + (i % 365) * 86_400_000).toISOString().slice(0, 10);
    const file = Array.from({ length: 5000 }, (_, i) => ({
      date: day(i),
      amount: i % 10 === 0 ? `${100_000 + i}` : `-${1000 + i}`,
      // Payees repeat, in different cases, as a bank's do.
      payee: i % 7 === 0 ? `POS MKT #${i}` : `${i % 2 ? "store" : "STORE"} ${i % 150}`,
      memo: `row ${i}`,
    }));
    const started = performance.now();
    const result = await importFile(file);
    const took = performance.now() - started;
    expect(result).toMatchObject({ imported: 5000, duplicates: 0 });
    // ~2 s alone; CI's runner, busy with the other test workers, takes up to four times that. A
    // statement per row would take minutes.
    expect(took).toBeLessThan(15_000);

    const all = await db
      .select({
        memo: transaction.memo,
        payeeId: transaction.payeeId,
        payeeName: payee.name,
        categoryId: transaction.categoryId,
        categoryName: category.name,
      })
      .from(transaction)
      .leftJoin(payee, eq(payee.id, transaction.payeeId))
      .leftJoin(category, eq(category.id, transaction.categoryId))
      .where(eq(transaction.accountId, checking.id));
    const byMemo = new Map(all.map((t) => [t.memo, t]));
    expect(byMemo.get("row 7")).toMatchObject({ payeeName: "Market", categoryId: groceries.id });
    expect(byMemo.get("row 10")?.categoryName).toBe("Inflow: Ready to Assign");
    expect(byMemo.get("row 1")?.categoryName).toBe("Uncategorized");
    // "store 1" and "STORE 1" are one payee, named as the file first spelled it.
    expect(byMemo.get("row 151")?.payeeId).toBe(byMemo.get("row 1")?.payeeId);
    expect(byMemo.get("row 1")?.payeeName).toBe("store 1");
    // A second import of the file takes in nothing.
    expect(await importFile(file)).toMatchObject({ imported: 0, duplicates: 5000 });
    // The rows, the Market purchase and the starting balance.
    expect(all).toHaveLength(5002);
  }, 60_000);

  it("converts rows in a foreign-currency account at each date's rate", async () => {
    const { importFile, rows, addAccount } = await setup();
    const euro = await addAccount("Euro", "checking", "EUR");
    await importFile(
      [
        { date: "2026-10-05", amount: "-1000", payee: "x Bakery", memo: "" },
        { date: "2026-10-12", amount: "-1000", payee: "x Bakery", memo: "" },
        { date: "2026-10-13", amount: "0", payee: "x Zero", memo: "" },
      ],
      {},
      euro.id,
    );
    expect((await rows(euro.id)).map((t) => [t.date, t.baseAmount, t.fxRate])).toEqual([
      ["2026-10-13", "0", null],
      ["2026-10-12", "-1200", "1.2"],
      ["2026-10-05", "-1100", "1.1"],
    ]);
  });

  it("refuses rows dated after today and closed accounts", async () => {
    const { base, owner, checking } = await setup();
    const future = await send(
      "POST",
      `${base}/accounts/${checking.id}/import?today=2026-10-17`,
      owner.cookie,
      {
        transactions: [{ ...coffee, date: "2026-10-18" }],
      },
    );
    expect(future.status).toBe(400);
    expect((await json<{ error: { code: string } }>(future)).error.code).toBe("DATE_IN_FUTURE");
  });

  it("remembers the CSV settings and reports the start date and last reconciliation", async () => {
    const { importFile, base, owner, checking } = await setup();
    const settings = {
      columns: ["date", "description", "memo", "amount"],
      mapping: { date: 0, payee: 1, memo: 2, outflow: 3, inflow: 3 },
      noHeaderRow: false,
      swapInflowOutflow: false,
      dateFormat: "MM/DD/YYYY",
    };
    const context = async () =>
      json<{
        startDate: string | null;
        reconciledThrough: string | null;
        csvSettings: unknown;
        statementSettings: unknown;
      }>(await send("GET", `${base}/accounts/${checking.id}/import-context`, owner.cookie));
    expect(await context()).toEqual({
      startDate: "2026-10-01",
      reconciledThrough: null,
      csvSettings: null,
      statementSettings: null,
    });
    await importFile([coffee], { csvSettings: settings });
    expect(await context()).toMatchObject({ startDate: "2026-10-01", csvSettings: settings });
    await importFile([{ ...pay, date: "2026-09-20" }]);
    expect((await context()).startDate).toBe("2026-09-20");
    expect((await context()).csvSettings).toEqual(settings);
    await importFile([], { csvSettings: null });
    expect((await context()).csvSettings).toBeNull();
    // OFX/QIF options are kept apart.
    const statement = { importMemos: false, swapPayeeMemo: true, swapInflowOutflow: false };
    await importFile([], { statementSettings: statement });
    expect(await context()).toMatchObject({ csvSettings: null, statementSettings: statement });
  });

  it("lets editors import and refuses viewers", async () => {
    const { budget, base, owner, checking } = await setup();
    const viewer = await shareBudget(app, owner.cookie, budget.id, { role: "viewer" });
    const res = await send("POST", `${base}/accounts/${checking.id}/import`, viewer.cookie, {
      transactions: [coffee],
    });
    expect(res.status).toBe(403);
    const stranger = await signUp(app);
    expect(
      (await send("GET", `${base}/accounts/${checking.id}/import-context`, stranger.cookie)).status,
    ).toBe(404);
  });
});

describe("matching imports", () => {
  type Row = Txn & {
    imported: boolean;
    importedPayee: string | null;
    matched: { date: string; amount: string; payee: string; memo: string } | null;
  };
  async function entered(s: Awaited<ReturnType<typeof setup>>, input: Record<string, unknown>) {
    const res = await send("POST", `${s.base}/transactions`, s.owner.cookie, {
      accountId: s.checking.id,
      categoryId: s.groceries.id,
      flag: null,
      cleared: "uncleared",
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<Row>(res);
  }
  const list = async (s: Awaited<ReturnType<typeof setup>>, q = "") =>
    (
      await json<{ transactions: Row[] }>(
        await send(
          "GET",
          `${s.base}/transactions?accountId=${s.checking.id}&limit=500&q=${encodeURIComponent(q)}`,
          s.owner.cookie,
        ),
      )
    ).transactions.filter((t) => t.payeeName !== "Starting Balance");

  it("matches an entered transaction of the same amount within ten days", async () => {
    const s = await setup();
    const a = await entered(s, {
      date: "2026-10-10",
      amount: "-2000",
      payeeName: "Mine A",
      memo: "mine A",
    });
    await entered(s, { date: "2026-10-02", amount: "-3000", payeeName: "Mine Far", memo: "far" });
    await entered(s, { date: "2026-10-12", amount: "-4000", payeeName: "Mine C", memo: "mine C" });
    const result = await s.importFile([
      { date: "2026-10-13", amount: "-2000", payee: "BANK A", memo: "bank A" },
      { date: "2026-10-14", amount: "-3000", payee: "BANK FAR", memo: "bank far" },
      { date: "2026-10-12", amount: "-4100", payee: "BANK C", memo: "bank C" },
    ]);
    expect(result).toMatchObject({ imported: 2, matched: 1, matchedIds: [a.id] });
    const rows = await list(s);
    const matched = rows.find((t) => t.id === a.id);
    // The entered details stay; it's cleared, approved and imported, with the bank side kept.
    expect(matched).toMatchObject({
      date: "2026-10-10",
      amount: "-2000",
      payeeName: "Mine A",
      memo: "mine A",
      categoryId: s.groceries.id,
      cleared: "cleared",
      approved: true,
      imported: true,
      importedPayee: "BANK A",
      matched: { date: "2026-10-13", amount: "-2000", payee: "BANK A", memo: "bank A" },
    });
    expect(rows.map((t) => t.payeeName).sort()).toEqual([
      "BANK C",
      "BANK FAR",
      "Mine A",
      "Mine C",
      "Mine Far",
    ]);
    const payees = await json<{ payees: { name: string }[] }>(
      await send("GET", `${s.base}/payees`, s.owner.cookie),
    );
    expect(payees.payees.map((p) => p.name)).not.toContain("BANK A");
    expect((await list(s, "Is: Matched")).map((t) => t.id)).toEqual([a.id]);
    // A match keeps the entered payee: there's nothing to rename back.
    expect(
      (await send("POST", `${s.base}/transactions/${a.id}/dont-rename`, s.owner.cookie)).status,
    ).toBe(400);
  });

  it("picks the nearest date, and matches each entered transaction once", async () => {
    const s = await setup();
    await entered(s, { date: "2026-10-01", amount: "-500", payeeName: "Early", memo: "" });
    const near = await entered(s, {
      date: "2026-10-09",
      amount: "-500",
      payeeName: "Near",
      memo: "",
    });
    const result = await s.importFile([
      { date: "2026-10-10", amount: "-500", payee: "X", memo: "" },
      { date: "2026-10-10", amount: "-500", payee: "Y", memo: "" },
      { date: "2026-10-10", amount: "-500", payee: "Z", memo: "" },
    ]);
    expect(result.matched).toBe(2);
    expect(result.matchedIds[0]).toBe(near.id);
    expect(result.imported).toBe(1);
  });

  it("doesn't match reconciled or already imported transactions", async () => {
    const s = await setup();
    await entered(s, {
      date: "2026-10-10",
      amount: "-700",
      payeeName: "Done",
      memo: "",
      cleared: "reconciled",
    });
    await s.importFile([{ date: "2026-10-11", amount: "-800", payee: "Imp", memo: "" }]);
    const result = await s.importFile([
      { date: "2026-10-10", amount: "-700", payee: "R", memo: "" },
      { date: "2026-10-12", amount: "-800", payee: "Imp2", memo: "" },
    ]);
    expect(result).toMatchObject({ matched: 0, imported: 2 });
  });

  it("matches and unmatches by hand, restoring both sides", async () => {
    const s = await setup();
    const c = await entered(s, {
      date: "2026-10-12",
      amount: "-4000",
      payeeName: "Mine C",
      memo: "mine C",
    });
    const imported = (
      await s.importFile([{ date: "2026-10-01", amount: "-4100", payee: "BANK C", memo: "bank C" }])
    ).transactionIds[0];
    const match = await send("POST", `${s.base}/transactions/match`, s.owner.cookie, {
      transactionIds: [imported, c.id],
    });
    expect(match.status, await match.clone().text()).toBe(200);
    let rows = await list(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: c.id,
      date: "2026-10-12",
      amount: "-4100",
      payeeName: "Mine C",
      memo: "mine C",
      cleared: "cleared",
      approved: true,
      matched: { date: "2026-10-01", amount: "-4100", payee: "BANK C", memo: "bank C" },
    });
    const accounts = await json<{ accounts: { id: string; balances: { working: string } }[] }>(
      await send("GET", `${s.base}/accounts`, s.owner.cookie),
    );
    expect(accounts.accounts.find((a) => a.id === s.checking.id)?.balances.working).toBe("-4100");

    const unmatch = await send("POST", `${s.base}/transactions/${c.id}/unmatch`, s.owner.cookie);
    expect(unmatch.status, await unmatch.clone().text()).toBe(200);
    rows = await list(s);
    expect(rows.find((t) => t.id === c.id)).toMatchObject({
      amount: "-4000",
      cleared: "uncleared",
      approved: true,
      imported: false,
      matched: null,
    });
    expect(rows.find((t) => t.id !== c.id)).toMatchObject({
      date: "2026-10-01",
      amount: "-4100",
      payeeName: "BANK C",
      memo: "bank C",
      cleared: "cleared",
      approved: false,
      categoryName: "Uncategorized",
      imported: true,
    });
    expect(
      (await send("POST", `${s.base}/transactions/${c.id}/unmatch`, s.owner.cookie)).status,
    ).toBe(400);
    const other = await entered(s, {
      date: "2026-10-12",
      amount: "-1",
      payeeName: "Two",
      memo: "",
    });
    const twoEntered = await send("POST", `${s.base}/transactions/match`, s.owner.cookie, {
      transactionIds: [other.id, c.id],
    });
    expect(twoEntered.status).toBe(400);
  });

  it("refuses to match an imported row made into a transfer, which would orphan its other side", async () => {
    const s = await setup();
    const savings = await s.addAccount("Savings", "savings");
    const c = await entered(s, { date: "2026-10-12", amount: "-900", payeeName: "Mine", memo: "" });
    const [imported] = (
      await s.importFile([{ date: "2026-10-01", amount: "-900", payee: "BANK", memo: "" }])
    ).transactionIds;
    // Eleven days apart, so the import didn't match it.
    const toTransfer = await send("PATCH", `${s.base}/transactions/${imported}`, s.owner.cookie, {
      transferAccountId: savings.id,
      payeeName: null,
      categoryId: null,
    });
    expect(toTransfer.status, await toTransfer.clone().text()).toBe(200);
    const match = await send("POST", `${s.base}/transactions/match`, s.owner.cookie, {
      transactionIds: [imported, c.id],
    });
    expect(match.status).toBe(400);
    expect(await s.rows(savings.id)).toHaveLength(1);
  });

  it("unmatches a transfer edited after the match without breaking its two sides", async () => {
    const s = await setup();
    const savings = await s.addAccount("Savings", "savings");
    const t = await entered(s, {
      date: "2026-10-12",
      amount: "-2000",
      transferAccountId: savings.id,
      categoryId: null,
      memo: "",
    });
    const result = await s.importFile([
      { date: "2026-10-13", amount: "-2000", payee: "BANK XFER", memo: "" },
    ]);
    expect(result.matchedIds).toEqual([t.id]);
    const edit = await send("PATCH", `${s.base}/transactions/${t.id}`, s.owner.cookie, {
      amount: "-2500",
    });
    expect(edit.status, await edit.clone().text()).toBe(200);
    const unmatch = await send("POST", `${s.base}/transactions/${t.id}/unmatch`, s.owner.cookie);
    expect(unmatch.status, await unmatch.clone().text()).toBe(200);
    expect((await list(s)).find((r) => r.id === t.id)?.amount).toBe("-2500");
    expect((await s.rows(savings.id)).map((r) => r.amount)).toEqual(["2500"]);
  });

  it("refuses to unmatch a reconciled transaction", async () => {
    const s = await setup();
    const c = await entered(s, { date: "2026-10-12", amount: "-300", payeeName: "Mine", memo: "" });
    await s.importFile([{ date: "2026-10-12", amount: "-300", payee: "BANK", memo: "" }]);
    const reconcile = await send(
      "POST",
      `${s.base}/accounts/${s.checking.id}/reconcile`,
      s.owner.cookie,
      { balance: "-300", date: "2026-10-17" },
    );
    expect(reconcile.status, await reconcile.clone().text()).toBe(200);
    const unmatch = await send("POST", `${s.base}/transactions/${c.id}/unmatch`, s.owner.cookie);
    expect(unmatch.status).toBe(409);
    expect(await list(s)).toHaveLength(1);
  });
});

describe("renaming imported payees", () => {
  it("makes an Is rule when an imported transaction's payee changes, and Don't Rename undoes it", async () => {
    const s = await setup();
    const [id] = (
      await s.importFile([
        { date: "2026-10-10", amount: "-500", payee: "SQ *CORNER CAFE", memo: "" },
      ])
    ).transactionIds;
    const res = await send("PATCH", `${s.base}/transactions/${id}`, s.owner.cookie, {
      payeeName: "Corner Cafe",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const payee = (await json<{ payeeId: string }>(res)).payeeId;
    const rules = async () =>
      (
        await json<{ rules: { payeeId: string; operator: string; text: string }[] }>(
          await send("GET", `${s.base}/payees/rules`, s.owner.cookie),
        )
      ).rules;
    expect(await rules()).toEqual([
      expect.objectContaining({ payeeId: payee, operator: "is", text: "SQ *CORNER CAFE" }),
    ]);
    // Changing it again, or to the same payee, adds nothing more.
    await send("PATCH", `${s.base}/transactions/${id}`, s.owner.cookie, { memo: "x" });
    expect(await rules()).toHaveLength(1);
    await s.importFile([
      { date: "2026-10-12", amount: "-600", payee: "SQ *CORNER CAFE", memo: "" },
    ]);
    expect((await s.rows()).map((t) => t.payeeName)).toEqual(["Corner Cafe", "Corner Cafe"]);

    const back = await send("POST", `${s.base}/transactions/${id}/dont-rename`, s.owner.cookie);
    expect(back.status, await back.clone().text()).toBe(200);
    expect(await rules()).toEqual([]);
    const row = (await s.rows()).find((t) => t.id === id);
    expect(row).toMatchObject({ payeeName: "SQ *CORNER CAFE", approved: true });
  });

  it("checks the version, and its undo brings back the same rule", async () => {
    const s = await setup();
    const [id] = (
      await s.importFile([{ date: "2026-10-10", amount: "-500", payee: "SQ *DELI", memo: "" }])
    ).transactionIds;
    const renamed = await json<Txn>(
      await send("PATCH", `${s.base}/transactions/${id}`, s.owner.cookie, { payeeName: "Deli" }),
    );
    const rules = async () =>
      (
        await json<{ rules: { id: string; payeeId: string; operator: string; text: string }[] }>(
          await send("GET", `${s.base}/payees/rules`, s.owner.cookie),
        )
      ).rules;
    const [rule] = await rules();
    // A stale version is refused and changes nothing.
    const stale = await send(
      "POST",
      `${s.base}/transactions/${id}/dont-rename?expectedVersion=${renamed.version - 1}`,
      s.owner.cookie,
    );
    expect(stale.status).toBe(409);
    expect(await json<{ error: { code: string } }>(stale)).toMatchObject({
      error: { code: "STALE_VERSION" },
    });
    expect(await rules()).toEqual([rule]);

    const back = await send(
      "POST",
      `${s.base}/transactions/${id}/dont-rename?expectedVersion=${renamed.version}`,
      s.owner.cookie,
    );
    expect(back.status, await back.clone().text()).toBe(200);
    const result = await json<{
      removedRules: { id: string }[];
      version: number;
      previousVersions: Record<string, number>;
    }>(back);
    expect(result).toMatchObject({
      removedRules: [{ id: rule?.id, operator: "is", text: "SQ *DELI" }],
      version: renamed.version + 1,
      previousVersions: { [id as string]: renamed.version },
    });
    expect(await rules()).toEqual([]);

    const undo = (expectedVersion: number) =>
      send(
        "POST",
        `${s.base}/transactions/${id}/dont-rename/undo?expectedVersion=${expectedVersion}`,
        s.owner.cookie,
        { payeeId: renamed.payeeId, approved: renamed.approved, rules: result.removedRules },
      );
    expect((await undo(result.version - 1)).status).toBe(409);
    const undone = await undo(result.version);
    expect(undone.status, await undone.clone().text()).toBe(200);
    expect(await json<{ version: number }>(undone)).toMatchObject({
      version: result.version + 1,
    });
    // The same rule (same id, so the same age and place) is back.
    expect(await rules()).toEqual([rule]);
    expect((await s.rows()).find((t) => t.id === id)).toMatchObject({
      payeeName: "Deli",
      approved: renamed.approved,
    });
  });

  it("brings no rule back on undo when there was none to remove, and checks what comes back", async () => {
    const s = await setup();
    // Renamed on import by a "contains" rule, so there's no "Is" rule to remove.
    const market = await json<Txn>(
      await send("POST", `${s.base}/transactions`, s.owner.cookie, {
        accountId: s.checking.id,
        date: "2026-10-02",
        amount: "-100",
        payeeName: "Market",
        categoryId: null,
        memo: "",
        flag: null,
      }),
    );
    await send("POST", `${s.base}/payees/${market.payeeId}/rules`, s.owner.cookie, {
      operator: "contains",
      text: "MKT",
    });
    const [id] = (
      await s.importFile([{ date: "2026-10-10", amount: "-500", payee: "POS MKT 1", memo: "" }])
    ).transactionIds;
    const back = await json<{ removedRules: unknown[]; version: number }>(
      await send("POST", `${s.base}/transactions/${id}/dont-rename`, s.owner.cookie),
    );
    expect(back.removedRules).toEqual([]);
    const undo = (rules: unknown[]) =>
      send("POST", `${s.base}/transactions/${id}/dont-rename/undo`, s.owner.cookie, {
        payeeId: market.payeeId,
        approved: false,
        rules,
      });
    // Only the payee's "Is <imported name>" rule can come back this way.
    const other = {
      id: "x",
      payeeId: market.payeeId,
      operator: "contains",
      text: "POS",
      position: 0,
      createdAt: new Date().toISOString(),
    };
    expect((await undo([other])).status).toBe(400);
    expect((await undo([])).status).toBe(200);
    const rules = await json<{ rules: { operator: string; text: string }[] }>(
      await send("GET", `${s.base}/payees/rules`, s.owner.cookie),
    );
    expect(rules.rules).toEqual([expect.objectContaining({ operator: "contains", text: "MKT" })]);
    expect((await s.rows()).find((t) => t.id === id)).toMatchObject({
      payeeName: "Market",
      approved: false,
    });
  });

  it("leaves entered and matched transactions' payee changes alone", async () => {
    const s = await setup();
    const res = await send("POST", `${s.base}/transactions`, s.owner.cookie, {
      accountId: s.checking.id,
      date: "2026-10-10",
      amount: "-100",
      payeeName: "Typed",
      categoryId: null,
      memo: "",
      flag: null,
    });
    const typed = await json<{ id: string }>(res);
    await send("PATCH", `${s.base}/transactions/${typed.id}`, s.owner.cookie, {
      payeeName: "Other",
    });
    const rules = await json<{ rules: unknown[] }>(
      await send("GET", `${s.base}/payees/rules`, s.owner.cookie),
    );
    expect(rules.rules).toEqual([]);
    expect(
      (await send("POST", `${s.base}/transactions/${typed.id}/dont-rename`, s.owner.cookie)).status,
    ).toBe(400);
  });
});
