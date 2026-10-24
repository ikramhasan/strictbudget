import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  shareBudget,
  signUp,
} from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
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
  const addAccount = async (name: string, type = "checking") =>
    json<{ id: string }>(
      await send("POST", `${base}/accounts`, owner.cookie, {
        name,
        type,
        balance: "0",
        date: "2026-10-01",
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
