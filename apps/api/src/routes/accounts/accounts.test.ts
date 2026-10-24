import { newId } from "@strictbudget/db";
import { budgetMember, category, transaction } from "@strictbudget/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBudget, createTestApp, resetDatabase, signUp } from "../../../test/helpers";

const { app, db, close } = createTestApp();
beforeEach(() => resetDatabase(db));
afterAll(close);

type Balances = { cleared: string; uncleared: string; working: string };
type Account = {
  id: string;
  name: string;
  type: string;
  note: string;
  closed: boolean;
  starredOrder: number | null;
  currency: string;
  interestRate: string | null;
  minimumPayment: string | null;
  escrowAmount: string | null;
  paymentCategoryId: string | null;
  balances: Balances;
  lastReconciledAt: string | null;
  pairedCategoryId: string | null;
  lastPaymentDate: string | null;
};
type Txn = {
  date: string;
  amount: string;
  payeeName: string | null;
  categoryName: string | null;
  cleared: string;
};
type Category = {
  id: string;
  name: string;
  hidden: boolean;
  linkedAccountId: string | null;
  hasTransactions: boolean;
};
type Group = { id: string; name: string; kind: string | null; categories: Category[] };
type ErrorBody = { error: { code: string } };

const TODAY = "2026-10-01";

function send(method: string, path: string, cookie: string, body?: unknown) {
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
  const addAccount = async (input: Record<string, unknown>): Promise<Account> => {
    const res = await send("POST", `${base}/accounts`, cookie, { date: TODAY, ...input });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as Account;
  };
  const accounts = async () =>
    ((await (await send("GET", `${base}/accounts`, cookie)).json()) as { accounts: Account[] })
      .accounts;
  const transactions = async (accountId: string) =>
    (
      (await (await send("GET", `${base}/transactions?accountId=${accountId}`, cookie)).json()) as {
        transactions: Txn[];
      }
    ).transactions;
  const groups = async () =>
    ((await (await send("GET", `${base}/categories`, cookie)).json()) as { groups: Group[] })
      .groups;
  return { cookie, budget, base, addAccount, accounts, transactions, groups };
}

describe("accounts", () => {
  it("adds a cash account whose starting balance goes to Ready to Assign", async () => {
    const { addAccount, transactions } = await setup();
    const checking = await addAccount({ name: "Checking", type: "checking", balance: "250000" });
    expect(checking).toMatchObject({
      name: "Checking",
      type: "checking",
      currency: "USD",
      closed: false,
      paymentCategoryId: null,
      balances: { cleared: "250000", uncleared: "0", working: "250000" },
    });
    expect(await transactions(checking.id)).toEqual([
      expect.objectContaining({
        date: TODAY,
        amount: "250000",
        payeeName: "Starting Balance",
        categoryName: "Inflow: Ready to Assign",
        cleared: "cleared",
      }),
    ]);
  });

  it("gives a credit card a payment category in a pinned Credit Card Payments group", async () => {
    const { addAccount, transactions, groups } = await setup();
    const visa = await addAccount({ name: "Visa", type: "credit_card", balance: "-37500" });
    expect(visa.balances.working).toBe("-37500");
    expect(visa.paymentCategoryId).toBeTruthy();

    const [first] = await groups();
    expect(first).toMatchObject({ name: "Credit Card Payments", kind: "credit_card_payments" });
    expect(first?.categories).toEqual([
      expect.objectContaining({
        id: visa.paymentCategoryId,
        name: "Visa",
        linkedAccountId: visa.id,
      }),
    ]);
    // Starting debt has no category.
    expect((await transactions(visa.id))[0]).toMatchObject({
      amount: "-37500",
      categoryName: null,
    });
  });

  it("puts a credit card that starts with money on it into Ready to Assign", async () => {
    const { addAccount, transactions } = await setup();
    const card = await addAccount({ name: "Amex", type: "credit_card", balance: "1000" });
    expect((await transactions(card.id))[0]?.categoryName).toBe("Inflow: Ready to Assign");
  });

  it("keeps loans and tracking accounts off budget", async () => {
    const { addAccount, transactions, groups } = await setup();
    const mortgage = await addAccount({
      name: "Home loan",
      type: "mortgage",
      balance: "-25000000",
      interestRate: "6.125",
      minimumPayment: "180000",
      escrowAmount: "40000",
    });
    expect(mortgage).toMatchObject({
      interestRate: "6.125",
      minimumPayment: "180000",
      escrowAmount: "40000",
      paymentCategoryId: null,
    });
    const house = await addAccount({ name: "House", type: "asset", balance: "40000000" });
    for (const account of [mortgage, house]) {
      expect((await transactions(account.id))[0]?.categoryName).toBeNull();
    }
    expect((await groups()).some((g) => g.kind)).toBe(false);
  });

  it("rejects loan details on other account types", async () => {
    const { cookie, base } = await setup();
    const res = await send("POST", `${base}/accounts`, cookie, {
      name: "Checking",
      type: "checking",
      balance: "0",
      date: TODAY,
      interestRate: "1.5",
    });
    expect(res.status).toBe(400);
  });

  it("renames a credit account together with its payment category", async () => {
    const { cookie, base, addAccount, groups } = await setup();
    const visa = await addAccount({ name: "Visa", type: "credit_card", balance: "0" });
    const res = await send("PATCH", `${base}/accounts/${visa.id}`, cookie, {
      name: "Visa Rewards",
      note: "Autopay on the 5th",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "Visa Rewards", note: "Autopay on the 5th" });
    expect((await groups())[0]?.categories[0]?.name).toBe("Visa Rewards");
  });

  it("changes the type only within the same family", async () => {
    const { cookie, base, addAccount } = await setup();
    const account = await addAccount({ name: "Everyday", type: "checking", balance: "0" });
    expect(
      (await send("PATCH", `${base}/accounts/${account.id}`, cookie, { type: "savings" })).status,
    ).toBe(200);
    expect(
      (await send("PATCH", `${base}/accounts/${account.id}`, cookie, { type: "credit_card" }))
        .status,
    ).toBe(400);
  });

  it("reorders accounts", async () => {
    const { cookie, base, addAccount, accounts } = await setup();
    const a = await addAccount({ name: "A", type: "checking", balance: "0" });
    const b = await addAccount({ name: "B", type: "savings", balance: "0" });
    await send("POST", `${base}/accounts/${b.id}/move`, cookie, { beforeAccountId: a.id });
    expect((await accounts()).map((x) => x.name)).toEqual(["B", "A"]);
  });

  // Open cash and credit accounts only, budget-wide; new stars go at the end of the Starred
  // group, reorderable within it.
  it("stars accounts for everyone on the budget, in their own order", async () => {
    const { cookie, budget, base, addAccount, accounts } = await setup();
    const a = await addAccount({ name: "A", type: "checking", balance: "0" });
    const b = await addAccount({ name: "B", type: "credit_card", balance: "0" });
    const t = await addAccount({ name: "T", type: "asset", balance: "0" });
    const star = (id: string, starred: boolean, who = cookie) =>
      send("PATCH", `${base}/accounts/${id}`, who, { starred });
    const starredNames = async () =>
      (await accounts())
        .filter((x) => x.starredOrder !== null)
        .sort((x, y) => (x.starredOrder ?? 0) - (y.starredOrder ?? 0))
        .map((x) => x.name);

    expect(a.starredOrder).toBeNull();
    expect(await (await star(b.id, true)).json()).toMatchObject({ starredOrder: 0 });
    expect((await star(a.id, true)).status).toBe(200);
    expect(await starredNames()).toEqual(["B", "A"]);
    await star(b.id, true);
    expect(await starredNames()).toEqual(["B", "A"]);

    const moved = await send("POST", `${base}/accounts/${a.id}/move`, cookie, {
      beforeAccountId: b.id,
      starred: true,
    });
    expect(moved.status).toBe(200);
    expect(await starredNames()).toEqual(["A", "B"]);
    // The sidebar order is untouched.
    expect((await accounts()).map((x) => x.name)).toEqual(["A", "B", "T"]);
    expect(
      (
        await send("POST", `${base}/accounts/${a.id}/move`, cookie, {
          beforeAccountId: t.id,
          starred: true,
        })
      ).status,
    ).toBe(400);

    // Tracking accounts can't be starred, nor closed ones.
    expect(((await (await star(t.id, true)).json()) as ErrorBody).error.code).toBe("BAD_REQUEST");
    await send("POST", `${base}/accounts/${t.id}/close`, cookie, { date: TODAY });
    expect((await star(t.id, true)).status).toBe(400);
    // Closing drops the star; reopened, the account isn't starred.
    const c = await addAccount({ name: "C", type: "cash", balance: "0" });
    await star(c.id, true);
    await send("POST", `${base}/accounts/${c.id}/close`, cookie, { date: TODAY });
    const reopened = await send("POST", `${base}/accounts/${c.id}/reopen`, cookie);
    expect(await reopened.json()).toMatchObject({ closed: false, starredOrder: null });

    const partner = await signUp(app);
    const me = (await (await send("GET", "/v1/me", partner.cookie)).json()) as { id: string };
    await db
      .insert(budgetMember)
      .values({ id: newId(), budgetId: budget.id, userId: me.id, role: "editor" });
    expect((await star(a.id, false, partner.cookie)).status).toBe(200);
    expect(await starredNames()).toEqual(["B"]);
  });

  it("closes an account, zeroing its balance and keeping its payment category", async () => {
    const { cookie, base, addAccount, accounts, transactions, groups } = await setup();
    const savings = await addAccount({ name: "Savings", type: "savings", balance: "10000" });
    const res = await send("POST", `${base}/accounts/${savings.id}/close`, cookie, { date: TODAY });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ closed: true, balances: { working: "0" } });
    expect((await transactions(savings.id))[0]).toMatchObject({
      amount: "-10000",
      payeeName: "Manual Balance Adjustment",
      categoryName: "Inflow: Ready to Assign",
      memo: "Closed Account",
    });

    const visa = await addAccount({ name: "Visa", type: "credit_card", balance: "0" });
    // Only a starting balance: no history. The closing adjustment gives Savings some.
    expect((await accounts()).find((a) => a.id === visa.id)).toMatchObject({ hasHistory: false });
    expect((await accounts()).find((a) => a.id === savings.id)).toMatchObject({ hasHistory: true });
    await send("POST", `${base}/accounts/${visa.id}/close`, cookie, { date: TODAY });
    // The category stays visible with whatever is set aside.
    expect((await groups())[0]?.categories[0]?.hidden).toBe(false);
    expect(await transactions(visa.id)).toHaveLength(1);

    const reopened = await send("POST", `${base}/accounts/${visa.id}/reopen`, cookie);
    expect(await reopened.json()).toMatchObject({ closed: false });
    expect((await groups())[0]?.categories[0]?.hidden).toBe(false);
  });

  it("reconciles: locks cleared transactions and adjusts for a difference", async () => {
    // Bank $480 against a cleared $483 adds a reconciled −$3 "Reconciliation Balance Adjustment"
    // in Inflow: Ready to Assign.
    const { base, cookie, addAccount, accounts, transactions } = await setup();
    const checking = await addAccount({ name: "Checking", type: "checking", balance: "48300" });
    expect(checking.lastReconciledAt).toBeNull();
    const post = (input: Record<string, unknown>) =>
      send("POST", `${base}/transactions`, cookie, {
        accountId: checking.id,
        categoryId: null,
        payeeName: "Shop",
        ...input,
      });
    await post({ date: TODAY, amount: "-1000" });
    await post({ date: "2026-10-09", amount: "-500", cleared: "cleared" });

    const res = await send("POST", `${base}/accounts/${checking.id}/reconcile`, cookie, {
      balance: "48000",
      date: TODAY,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const reconciled = (await res.json()) as Account;
    expect(reconciled.lastReconciledAt).not.toBeNull();
    expect(reconciled.balances).toEqual({ cleared: "48000", uncleared: "-1000", working: "47000" });
    const rows = await transactions(checking.id);
    expect(rows.find((t) => t.payeeName === "Reconciliation Balance Adjustment")).toMatchObject({
      amount: "-300",
      date: TODAY,
      categoryName: "Inflow: Ready to Assign",
      cleared: "reconciled",
    });
    expect(rows.find((t) => t.payeeName === "Starting Balance")?.cleared).toBe("reconciled");
    // Uncleared, and cleared but still in the future, stay as they were.
    expect(
      rows
        .filter((t) => t.payeeName === "Shop")
        .map((t) => t.cleared)
        .sort(),
    ).toEqual(["cleared", "uncleared"]);

    await send("POST", `${base}/accounts/${checking.id}/reconcile`, cookie, {
      balance: "48000",
      date: TODAY,
    });
    expect(
      (await transactions(checking.id)).filter(
        (t) => t.payeeName === "Reconciliation Balance Adjustment",
      ),
    ).toHaveLength(1);
    expect((await accounts())[0]?.lastReconciledAt).not.toBeNull();
  });

  it("reconciles cards, tracking accounts and loans", async () => {
    const { base, cookie, addAccount, transactions } = await setup();
    const card = await addAccount({ name: "Visa", type: "credit_card", balance: "-5000" });
    const house = await addAccount({ name: "House", type: "asset", balance: "10000" });
    const loan = await addAccount({ name: "Car", type: "auto_loan", balance: "-900000" });
    const reconcile = (id: string, balance: string) =>
      send("POST", `${base}/accounts/${id}/reconcile`, cookie, { balance, date: TODAY });

    const rta = async () =>
      (
        (await (await send("GET", `${base}/months/2026-10`, cookie)).json()) as {
          readyToAssign: string;
        }
      ).readyToAssign;
    const before = await rta();
    expect((await reconcile(card.id, "-5700")).status).toBe(200);
    // More debt from Ready to Assign doesn't move it.
    expect(await rta()).toBe(before);
    expect(
      (await transactions(card.id)).find(
        (t) => t.payeeName === "Reconciliation Balance Adjustment",
      ),
    ).toMatchObject({ amount: "-700", categoryName: "Inflow: Ready to Assign" });
    expect((await reconcile(house.id, "12000")).status).toBe(200);
    expect(
      (await transactions(house.id)).find(
        (t) => t.payeeName === "Reconciliation Balance Adjustment",
      ),
    ).toMatchObject({ amount: "2000", categoryName: null });
    // A loan's Update Balance.
    expect((await reconcile(loan.id, "-890000")).status).toBe(200);
    expect(
      (await transactions(loan.id)).find(
        (t) => t.payeeName === "Reconciliation Balance Adjustment",
      ),
    ).toMatchObject({ amount: "10000", categoryName: null, cleared: "reconciled" });
  });

  it("sets a working balance with a Manual Balance Adjustment", async () => {
    // 328 → 320 adds a cleared −$8 adjustment with no memo; a card's −64 → 70 adds +$134, both in
    // Inflow: Ready to Assign.
    const { base, cookie, addAccount, transactions } = await setup();
    const checking = await addAccount({ name: "Checking", type: "checking", balance: "32800" });
    const card = await addAccount({ name: "Visa", type: "credit_card", balance: "-6400" });
    const patch = (id: string, body: Record<string, unknown>) =>
      send("PATCH", `${base}/accounts/${id}`, cookie, { date: TODAY, ...body });

    const res = await patch(checking.id, { workingBalance: "32000" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as Account).balances.working).toBe("32000");
    expect(
      (await transactions(checking.id)).find((t) => t.payeeName === "Manual Balance Adjustment"),
    ).toMatchObject({
      amount: "-800",
      date: TODAY,
      categoryName: "Inflow: Ready to Assign",
      cleared: "cleared",
    });
    await patch(card.id, { workingBalance: "7000" });
    expect(
      (await transactions(card.id)).find((t) => t.payeeName === "Manual Balance Adjustment")
        ?.amount,
    ).toBe("13400");

    // The same balance adds nothing; closed accounts have no working balance field. A loan's is
    // its Today's Balance.
    await patch(checking.id, { workingBalance: "32000" });
    expect(
      (await transactions(checking.id)).filter((t) => t.payeeName === "Manual Balance Adjustment"),
    ).toHaveLength(1);
    await send("POST", `${base}/accounts/${card.id}/close`, cookie, { date: TODAY });
    expect((await patch(card.id, { workingBalance: "0" })).status).toBe(400);
    const loan = await addAccount({ name: "Car", type: "auto_loan", balance: "-900000" });
    expect((await patch(loan.id, { workingBalance: "-850000" })).status).toBe(200);
    expect(
      (await transactions(loan.id)).find((t) => t.payeeName === "Manual Balance Adjustment"),
    ).toMatchObject({ amount: "50000", categoryName: null });
  });

  it("deletes a fresh account with its starting balance and payment category", async () => {
    const { cookie, base, addAccount, accounts, groups } = await setup();
    const visa = await addAccount({ name: "Visa", type: "credit_card", balance: "-500" });
    expect((await send("DELETE", `${base}/accounts/${visa.id}`, cookie)).status).toBe(204);
    expect(await accounts()).toEqual([]);
    expect((await groups())[0]?.categories ?? []).toEqual([]);
  });

  it("refuses to delete an account with history beyond its starting balance", async () => {
    const { cookie, base, addAccount } = await setup();
    const savings = await addAccount({ name: "Savings", type: "savings", balance: "10000" });
    await send("POST", `${base}/accounts/${savings.id}/close`, cookie, { date: TODAY });
    const res = await send("DELETE", `${base}/accounts/${savings.id}`, cookie);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe("ACCOUNT_HAS_HISTORY");
  });

  it("hides accounts from non-members and lets editors manage them", async () => {
    const owner = await setup();
    const stranger = await signUp(app);
    const account = await owner.addAccount({ name: "Checking", type: "checking", balance: "0" });
    expect((await send("GET", `${owner.base}/accounts`, stranger.cookie)).status).toBe(404);

    const me = (await (await send("GET", "/v1/me", stranger.cookie)).json()) as { id: string };
    await db
      .insert(budgetMember)
      .values({ id: newId(), budgetId: owner.budget.id, userId: me.id, role: "editor" });
    const res = await send("PATCH", `${owner.base}/accounts/${account.id}`, stranger.cookie, {
      name: "Joint checking",
    });
    expect(res.status).toBe(200);
  });

  it("deletes a whole budget with accounts and transactions", async () => {
    const { cookie, base, budget, addAccount } = await setup();
    await addAccount({ name: "Checking", type: "checking", balance: "100" });
    expect((await send("DELETE", base, cookie)).status).toBe(204);
    expect(await db.select().from(transaction).where(eq(transaction.budgetId, budget.id))).toEqual(
      [],
    );
  });
});

describe("payment categories and category history", () => {
  it("can't be renamed, deleted or moved out; others can't move in", async () => {
    const { cookie, base, addAccount, groups } = await setup();
    const visa = await addAccount({ name: "Visa", type: "credit_card", balance: "0" });
    const [ccGroup, bills] = await groups();
    const payment = visa.paymentCategoryId;
    const rent = bills?.categories[0];

    const attempts = [
      send("PATCH", `${base}/categories/${payment}`, cookie, { name: "Mine" }),
      send("DELETE", `${base}/categories/${payment}`, cookie),
      send("POST", `${base}/categories/${payment}/move`, cookie, {
        groupId: bills?.id,
        beforeCategoryId: null,
      }),
      send("POST", `${base}/categories/${rent?.id}/move`, cookie, {
        groupId: ccGroup?.id,
        beforeCategoryId: null,
      }),
      send("POST", `${base}/categories`, cookie, { groupId: ccGroup?.id, name: "Extra" }),
      send("PATCH", `${base}/category-groups/${ccGroup?.id}`, cookie, { name: "Cards" }),
      send("DELETE", `${base}/category-groups/${ccGroup?.id}`, cookie),
      send("POST", `${base}/category-groups/${ccGroup?.id}/move`, cookie, { beforeGroupId: null }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(409);
      expect(((await res.json()) as ErrorBody).error.code).toBe("MANAGED_CATEGORY");
    }

    const ok = await send("PATCH", `${base}/categories/${payment}`, cookie, {
      note: "Pay in full",
      hidden: true,
    });
    expect(ok.status).toBe(200);
  });

  it("requires somewhere to move a category's history before deleting it", async () => {
    const { cookie, base, budget, addAccount, groups } = await setup();
    const checking = await addAccount({ name: "Checking", type: "checking", balance: "0" });
    const [bills, frequent] = await groups();
    const rent = bills?.categories[0];
    const groceries = frequent?.categories[0];
    // Insert a transaction directly to give Rent some history.
    await db.insert(transaction).values({
      id: newId(),
      budgetId: budget.id,
      accountId: checking.id,
      date: TODAY,
      amount: -120000n,
      baseAmount: -120000n,
      currency: "USD",
      categoryId: rent?.id,
    });

    const listed = (await groups())[0]?.categories.find((c) => c.id === rent?.id);
    expect(listed).toMatchObject({ hasTransactions: true });

    const refused = await send("DELETE", `${base}/categories/${rent?.id}`, cookie);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as ErrorBody).error.code).toBe("CATEGORY_HAS_HISTORY");
    const toItself = await send(
      "DELETE",
      `${base}/categories/${rent?.id}?reassignToCategoryId=${rent?.id}`,
      cookie,
    );
    expect(toItself.status).toBe(400);

    const res = await send(
      "DELETE",
      `${base}/categories/${rent?.id}?reassignToCategoryId=${groceries?.id}`,
      cookie,
    );
    expect(res.status).toBe(204);
    const moved = await db
      .select()
      .from(transaction)
      .where(
        and(eq(transaction.budgetId, budget.id), eq(transaction.categoryId, groceries?.id ?? "")),
      );
    expect(moved).toHaveLength(1);
    expect(
      await db
        .select()
        .from(category)
        .where(eq(category.id, rent?.id ?? "")),
    ).toEqual([]);
  });

  it("moves a whole group's history when deleting the group", async () => {
    const { cookie, base, budget, addAccount, groups } = await setup();
    const checking = await addAccount({ name: "Checking", type: "checking", balance: "0" });
    const [bills, frequent] = await groups();
    await db.insert(transaction).values({
      id: newId(),
      budgetId: budget.id,
      accountId: checking.id,
      date: TODAY,
      amount: -5000n,
      baseAmount: -5000n,
      currency: "USD",
      categoryId: bills?.categories[2]?.id,
    });
    expect((await send("DELETE", `${base}/category-groups/${bills?.id}`, cookie)).status).toBe(409);
    const target = frequent?.categories[0]?.id;
    const res = await send(
      "DELETE",
      `${base}/category-groups/${bills?.id}?reassignToCategoryId=${target}`,
      cookie,
    );
    expect(res.status).toBe(204);
  });
});
