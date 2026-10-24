import { newId } from "@strictbudget/db";
import { budgetMember } from "@strictbudget/db/schema";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  signUp,
  type TestBudget,
} from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Account = {
  id: string;
  name: string;
  type: string;
  note: string;
  closed: boolean;
  starredOrder: number | null;
  paymentCategoryId: string | null;
  pairedCategoryId: string | null;
  balances: { working: string };
};
type Category = {
  id: string;
  name: string;
  note: string;
  hidden: boolean;
  linkedAccountId: string | null;
  target: Record<string, unknown> | null;
};
type Group = { name: string; kind: string | null; hidden: boolean; categories: Category[] };
type Txn = { amount: string; payeeName: string | null; categoryName: string | null; date: string };
type Budget = TestBudget & { archivedAt: string | null };

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
  const budget = await createBudget(app, owner.cookie, { name: "Household" });
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (input: Record<string, unknown>) =>
    json<Account>(await send("POST", `${base}/accounts`, owner.cookie, { date: TODAY, ...input }));
  return { owner, budget, base, addAccount };
}

const freshStart = (budgetId: string, cookie: string, name = "Household") =>
  send("POST", `/v1/budgets/${budgetId}/fresh-start`, cookie, { date: TODAY, name });

describe("fresh start", () => {
  it("archives the old budget and continues in a copy without transactions", async () => {
    const { owner, budget, base, addAccount } = await setup();
    const checking = await addAccount({ name: "Checking", type: "checking", balance: "250000" });
    const visa = await addAccount({ name: "Visa", type: "credit_card", balance: "-37500" });
    const old = await json<Account>(
      await send("POST", `${base}/accounts/${checking.id}/close`, owner.cookie, { date: TODAY }),
    );
    expect(old.closed).toBe(true);
    const groups = (
      await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, owner.cookie))
    ).groups;
    const bills = groups.find((g) => g.name === "Bills");
    await addAccount({
      name: "Mortgage",
      type: "mortgage",
      balance: "-100000",
      interestRate: "6",
      pairedCategoryId: bills?.categories[2]?.id,
    });
    await send("PATCH", `${base}/categories/${bills?.categories[0]?.id}`, owner.cookie, {
      note: "Due on the 1st",
      hidden: true,
    });
    const spend = await send("POST", `${base}/transactions`, owner.cookie, {
      accountId: visa.id,
      date: TODAY,
      amount: "-1000",
      payeeName: "Costco",
      categoryId: bills?.categories[1]?.id,
    });
    expect(spend.status).toBe(201);
    const costco = await json<{ payeeId: string }>(spend);
    await send("PATCH", `${base}/payees/${costco.payeeId}`, owner.cookie, { hidden: true });

    await send("PATCH", `${base}/accounts/${visa.id}`, owner.cookie, { starred: true });

    const res = await freshStart(budget.id, owner.cookie, "Household 2027");
    expect(res.status).toBe(201);
    const fresh = await json<Budget>(res);
    expect(fresh).toMatchObject({
      name: "Household 2027",
      currency: budget.currency,
      numberFormat: budget.numberFormat,
      dateFormat: budget.dateFormat,
      role: "owner",
      archivedAt: null,
    });
    expect(fresh.id).not.toBe(budget.id);

    const list = await json<{ lastUsedBudgetId: string }>(
      await send("GET", "/v1/budgets", owner.cookie),
    );
    expect(list.lastUsedBudgetId).toBe(fresh.id);

    const archived = await json<Budget>(await send("GET", base, owner.cookie));
    // The stamp uses the ISO date whatever the budget's date format.
    expect(archived.name).toBe("Household (Archived on 2026-10-01)");
    expect(archived.archivedAt).not.toBeNull();

    const freshBase = `/v1/budgets/${fresh.id}`;
    const accounts = (
      await json<{ accounts: Account[] }>(await send("GET", `${freshBase}/accounts`, owner.cookie))
    ).accounts;
    // Accounts start at $0 for the user to update.
    expect(accounts.map((a) => [a.name, a.type, a.closed, a.balances.working])).toEqual([
      ["Checking", "checking", true, "0"],
      ["Visa", "credit_card", false, "0"],
      ["Mortgage", "mortgage", false, "0"],
    ]);
    expect(accounts.map((a) => a.starredOrder)).toEqual([null, 0, null]);
    const newVisa = accounts.find((a) => a.name === "Visa");
    const visaTxns = (
      await json<{ transactions: Txn[] }>(
        await send("GET", `${freshBase}/transactions?accountId=${newVisa?.id}`, owner.cookie),
      )
    ).transactions;
    expect(visaTxns).toEqual([
      expect.objectContaining({ amount: "0", payeeName: "Starting Balance", date: TODAY }),
    ]);
    const payees = await json<{ payees: unknown[] }>(
      await send("GET", `${freshBase}/payees`, owner.cookie),
    );
    expect(payees.payees).toEqual([
      {
        id: expect.any(String),
        name: "Costco",
        hidden: true,
        useCount: 0,
        categorization: "auto",
        defaultCategoryId: null,
        autoCategoryId: expect.any(String),
        prefillCategoryId: expect.any(String),
        recentCategoryIds: [],
      },
    ]);

    const freshGroups = (
      await json<{ groups: Group[] }>(await send("GET", `${freshBase}/categories`, owner.cookie))
    ).groups;
    expect(freshGroups.map((g) => g.name)).toEqual(groups.map((g) => g.name));
    const pairedName = bills?.categories[2]?.name;
    const newPaired = freshGroups.flatMap((g) => g.categories).find((c) => c.name === pairedName);
    expect(accounts.find((a) => a.name === "Mortgage")?.pairedCategoryId).toBe(newPaired?.id);
    const freshBills = freshGroups.find((g) => g.name === "Bills");
    expect(freshBills?.categories[0]).toMatchObject({ note: "Due on the 1st", hidden: true });
    const payment = freshGroups[0]?.categories[0];
    expect(payment).toMatchObject({ name: "Visa", linkedAccountId: newVisa?.id });
    expect(newVisa?.paymentCategoryId).toBe(payment?.id);
    expect(visa.id).not.toBe(newVisa?.id);
  });

  it("copies scheduled transactions onto the new accounts, categories and payees", async () => {
    const { owner, budget, base, addAccount } = await setup();
    const checking = await addAccount({ name: "Checking", type: "checking", balance: "250000" });
    const visa = await addAccount({ name: "Visa", type: "credit_card", balance: "-37500" });
    const [rent, utilities] = (
      await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, owner.cookie))
    ).groups.flatMap((g) => (g.kind ? [] : g.categories));
    const schedule = async (input: Record<string, unknown>) => {
      const res = await send("POST", `${base}/scheduled-transactions`, owner.cookie, {
        accountId: checking.id,
        today: TODAY,
        ...input,
      });
      expect(res.status, await res.clone().text()).toBe(201);
    };
    await schedule({
      date: "2026-10-24",
      frequency: "monthly",
      amount: "-6000",
      payeeName: "Landlord",
      categoryId: rent?.id,
      memo: "x-order2",
      flag: "red",
    });
    await schedule({ date: "2026-10-21", amount: "-5000", transferAccountId: visa.id });
    await schedule({
      date: "2026-10-15",
      amount: "-900",
      payeeName: "Shop",
      subtransactions: [
        { amount: "-400", categoryId: rent?.id },
        { amount: "-500", categoryId: utilities?.id },
      ],
    });

    const fresh = await json<Budget>(await freshStart(budget.id, owner.cookie));
    const freshBase = `/v1/budgets/${fresh.id}`;
    type Row = {
      kind: string;
      accountId: string;
      frequency: string;
      dateFirst: string;
      dateNext: string;
      amount: string;
      payeeName: string | null;
      categoryId: string | null;
      memo: string;
      flag: string | null;
      transferAccountId: string | null;
      subtransactions: { amount: string; categoryId: string | null }[];
    };
    const list = async (b: string) =>
      (
        await json<{ scheduledTransactions: Row[] }>(
          // Pinned `today`: the server's date would enter the schedules once the clock passes them.
          await send("GET", `${b}/scheduled-transactions?today=${TODAY}`, owner.cookie),
        )
      ).scheduledTransactions.filter((r) => r.kind === "schedule");
    const accounts = (
      await json<{ accounts: Account[] }>(await send("GET", `${freshBase}/accounts`, owner.cookie))
    ).accounts;
    const newChecking = accounts.find((a) => a.name === "Checking");
    const newVisa = accounts.find((a) => a.name === "Visa");
    const [newRent, newUtilities] = (
      await json<{ groups: Group[] }>(await send("GET", `${freshBase}/categories`, owner.cookie))
    ).groups.flatMap((g) => (g.kind ? [] : g.categories));

    const copied = await list(freshBase);
    expect(copied).toHaveLength(3);
    expect(copied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: newChecking?.id,
          frequency: "monthly",
          dateFirst: "2026-10-24",
          dateNext: "2026-10-24",
          amount: "-6000",
          payeeName: "Landlord",
          categoryId: newRent?.id,
          memo: "x-order2",
          flag: "red",
        }),
        expect.objectContaining({ amount: "-5000", transferAccountId: newVisa?.id }),
        expect.objectContaining({
          amount: "-900",
          subtransactions: [
            expect.objectContaining({ amount: "-400", categoryId: newRent?.id }),
            expect.objectContaining({ amount: "-500", categoryId: newUtilities?.id }),
          ],
        }),
      ]),
    );
    expect(await list(base)).toHaveLength(3);
  });

  it("brings partners along with their roles", async () => {
    const { owner, budget } = await setup();
    const partner = await signUp(app);
    const me = await json<{ id: string }>(await send("GET", "/v1/me", partner.cookie));
    await db
      .insert(budgetMember)
      .values({ id: newId(), budgetId: budget.id, userId: me.id, role: "editor" });

    const fresh = await json<Budget>(await freshStart(budget.id, owner.cookie));
    const seen = await json<Budget>(await send("GET", `/v1/budgets/${fresh.id}`, partner.cookie));
    expect(seen.role).toBe("editor");
  });

  it("is only for the owner", async () => {
    const { budget } = await setup();
    const partner = await signUp(app);
    const me = await json<{ id: string }>(await send("GET", "/v1/me", partner.cookie));
    await db
      .insert(budgetMember)
      .values({ id: newId(), budgetId: budget.id, userId: me.id, role: "editor" });
    expect((await freshStart(budget.id, partner.cookie)).status).toBe(403);
  });

  // An archived budget is an ordinary budget with a stamp in its name.
  it("restores an archived budget by renaming it, and lets it start fresh again", async () => {
    const { owner, budget, base } = await setup();
    expect((await freshStart(budget.id, owner.cookie)).status).toBe(201);
    const renamed = await json<Budget>(
      await send("PATCH", base, owner.cookie, { name: "Household (Archived on 2026-10-01) old" }),
    );
    expect(renamed.archivedAt).not.toBeNull();
    const restored = await json<Budget>(
      await send("PATCH", base, owner.cookie, { name: "Household old" }),
    );
    expect(restored).toMatchObject({ name: "Household old", archivedAt: null });

    expect((await freshStart(budget.id, owner.cookie, "Household again")).status).toBe(201);
    const again = await json<Budget>(await send("GET", base, owner.cookie));
    expect(again.name).toBe("Household old (Archived on 2026-10-01)");
    expect((await freshStart(budget.id, owner.cookie, "Third")).status).toBe(201);
  });

  it("needs a name for the new budget", async () => {
    const { owner, budget } = await setup();
    expect((await freshStart(budget.id, owner.cookie, "   ")).status).toBe(400);
    const res = await send("POST", `/v1/budgets/${budget.id}/fresh-start`, owner.cookie, {
      date: TODAY,
    });
    expect(res.status).toBe(400);
  });

  it("copies targets, starting in the fresh start's month", async () => {
    const { owner, budget, base } = await setup();
    const categories = async (b: string) =>
      (
        await json<{ groups: Group[] }>(
          await send("GET", `/v1/budgets/${b}/categories`, owner.cookie),
        )
      ).groups.flatMap((g) => g.categories);
    const [rent] = await categories(budget.id);
    if (!rent) throw new Error("starter data missing");
    await send("PUT", `${base}/categories/${rent.id}/target`, owner.cookie, {
      cadence: "monthly",
      behavior: "refill",
      amount: "12000",
      dueDay: 5,
      month: "2026-08",
    });
    const fresh = await json<Budget>(await freshStart(budget.id, owner.cookie));
    const copy = (await categories(fresh.id)).find((c) => c.name === rent.name);
    expect(copy?.target).toEqual({
      cadence: "monthly",
      behavior: "refill",
      amount: "12000",
      currency: "USD",
      dueDay: 5,
      dueDate: null,
      repeatEvery: null,
      repeatUnit: null,
      startMonth: "2026-10",
      startDay: null,
      snoozedMonth: null,
    });
  });

  it("keeps a weekly target's start day in the same month", async () => {
    const { owner, budget, base } = await setup();
    const categories = async (b: string) =>
      (
        await json<{ groups: Group[] }>(
          await send("GET", `/v1/budgets/${b}/categories`, owner.cookie),
        )
      ).groups.flatMap((g) => g.categories);
    const [rent] = await categories(budget.id);
    if (!rent) throw new Error("starter data missing");
    await send("PUT", `${base}/categories/${rent.id}/target`, owner.cookie, {
      cadence: "weekly",
      behavior: "set_aside",
      amount: "1000",
      dueDay: 6,
      month: TODAY.slice(0, 7),
      today: `${TODAY.slice(0, 7)}-12`,
    });
    const fresh = await json<Budget>(await freshStart(budget.id, owner.cookie));
    const copy = (await categories(fresh.id)).find((c) => c.name === rent.name);
    const month = await json<{ categories: { categoryId: string; target: { needed: string } }[] }>(
      await send("GET", `/v1/budgets/${fresh.id}/months/2026-10?today=${TODAY}`, owner.cookie),
    );
    // Saturdays from the 12th of October 2026: the 17th, 24th and 31st.
    expect(month.categories.find((c) => c.categoryId === copy?.id)?.target.needed).toBe("3000");
  });

  it("starts budgets created from scratch with the template", async () => {
    const { owner, base } = await setup();
    const groups = (
      await json<{ groups: Group[] }>(await send("GET", `${base}/categories`, owner.cookie))
    ).groups;
    expect(groups.map((g) => g.name)).toContain("Bills");
  });
});
