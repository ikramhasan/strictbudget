import type { components } from "@strictbudget/api-client";
import { describe, expect, it } from "vitest";
import {
  balanceChange,
  isPendingId,
  patchedTransaction,
  pendingId,
  pendingTransaction,
  type RowContext,
  withBalanceChange,
  withPending,
} from "./register-optimistic";
import { DEFAULT_SORT, enteredOrder } from "./register-sort";
import type { Transaction } from "./transactions";

const accounts = {
  checking: { name: "Checking", currency: "USD", type: "checking" as const },
  savings: { name: "Savings", currency: "USD", type: "savings" as const },
  wallet: { name: "Wallet", currency: "USD", type: "cash" as const },
};

const context: RowContext = {
  account: (id) => accounts[id as keyof typeof accounts],
  categoryName: (id) => ({ food: "Groceries", rent: "Rent" })[id] ?? null,
  usesCategory: (_id, to) => to === null,
  budgetCurrency: "USD",
};

/** A saved row: `amount` and `balance` in cents. */
function row(id: string, date: string, amount: number, balance: number): Transaction {
  return {
    ...pendingTransaction(
      id,
      {
        accountId: "checking",
        date,
        amount: String(amount),
        payeeName: `Payee ${id}`,
        categoryId: "food",
        memo: "",
        flag: null,
      },
      context,
    ),
    runningBalance: String(balance),
    version: 1,
  };
}

const NONE = { creates: [], edits: [], known: new Map() };

describe("pending rows", () => {
  it("gives a new row an id that sorts after any saved one", () => {
    const id = pendingId();
    expect(isPendingId(id)).toBe(true);
    expect(id > "019a2b3c-0000-7000-8000-000000000000").toBe(true);
    expect(isPendingId("019a2b3c-0000-7000-8000-000000000000")).toBe(false);
  });

  it("names a new row's category, transfer and cleared state as a saved one would", () => {
    const transfer = pendingTransaction(
      "p",
      {
        accountId: "wallet",
        date: "2026-11-01",
        amount: "-5000",
        payeeName: null,
        transferAccountId: "savings",
        categoryId: null,
        memo: "",
        flag: null,
      },
      context,
    );
    expect(transfer).toMatchObject({
      payeeName: "Transfer : Savings",
      accountName: "Wallet",
      // A cash account's transactions start cleared.
      cleared: "cleared",
      needsCategory: false,
      transferSide: { amount: "5000", cleared: "uncleared", currency: "USD" },
    });
    const uncategorized = pendingTransaction(
      "q",
      {
        accountId: "checking",
        date: "2026-11-01",
        amount: "-100",
        payeeName: "Shop",
        categoryId: null,
        memo: "",
        flag: null,
      },
      context,
    );
    expect(uncategorized).toMatchObject({ cleared: "uncleared", needsCategory: true });
  });

  it("applies an edit's fields to a row", () => {
    const before = row("a", "2026-11-01", -1000, 9000);
    const after = patchedTransaction(
      before,
      { categoryId: "rent", memo: "November", amount: "-1500", cleared: "cleared" },
      context,
    );
    expect(after).toMatchObject({
      categoryId: "rent",
      categoryName: "Rent",
      memo: "November",
      amount: "-1500",
      baseAmount: "-1500",
      cleared: "cleared",
    });
    expect(patchedTransaction(before, { payeeName: "New name" }, context).payeeName).toBe(
      "New name",
    );
  });

  it("puts a new row at the top of its day, moving the later balances", () => {
    const rows = [
      row("019c", "2026-11-03", -200, 9500),
      row("019b", "2026-11-01", -300, 9700),
      row("019a", "2026-10-30", 10000, 10000),
    ];
    const created = pendingTransaction(
      "pending-x",
      {
        accountId: "checking",
        date: "2026-11-01",
        amount: "-1000",
        payeeName: "Shop",
        categoryId: "food",
        memo: "",
        flag: null,
      },
      context,
    );
    const merged = withPending(
      rows,
      { ...NONE, creates: [{ row: created }] },
      context,
      DEFAULT_SORT,
      "checking",
    );
    const shown = enteredOrder(merged.rows, DEFAULT_SORT);
    expect(shown.map((r) => [r.id, r.runningBalance])).toEqual([
      ["019c", "8500"],
      ["pending-x", "8700"],
      ["019b", "9700"],
      ["019a", "10000"],
    ]);
    expect(merged.pending.get("pending-x")).toBe("new");
    // Once the saved row is in, the pending one makes way for it.
    const saved = { ...row("019d", "2026-11-01", -1000, 8700) };
    const caughtUp = withPending(
      [rows[0] as Transaction, saved, ...rows.slice(1)],
      { ...NONE, creates: [{ row: created, savedId: "019d" }] },
      context,
      DEFAULT_SORT,
      "checking",
    );
    expect(caughtUp.rows.map((r) => r.id)).toEqual(["019c", "019d", "019b", "019a"]);
  });

  it("shows an edit over its row and the balances after it, and a saved row until the list has it", () => {
    const rows = [row("019b", "2026-11-02", -300, 9700), row("019a", "2026-11-01", 10000, 10000)];
    const merged = withPending(
      rows,
      { ...NONE, edits: [{ key: 1, id: "019a", body: { amount: "12000" }, kind: "row" }] },
      context,
      DEFAULT_SORT,
    );
    expect(merged.rows.map((r) => [r.amount, r.runningBalance])).toEqual([
      ["-300", "11700"],
      ["12000", "12000"],
    ]);
    expect(merged.pending.get("019a")).toBe("row");
    const savedRow = { ...(rows[1] as Transaction), memo: "Saved", version: 2 };
    const known = withPending(
      rows,
      { ...NONE, known: new Map([["019a", savedRow]]) },
      context,
      DEFAULT_SORT,
    );
    expect(known.rows[1]?.memo).toBe("Saved");
    // The list caught up: its own row wins.
    const fresh = { ...(rows[1] as Transaction), memo: "Fresh", version: 2 };
    const caughtUp = withPending(
      [rows[0] as Transaction, fresh],
      { ...NONE, known: new Map([["019a", savedRow]]) },
      context,
      DEFAULT_SORT,
    );
    expect(caughtUp.rows[1]?.memo).toBe("Fresh");
  });

  it("drops a row moved to another account from the account's register", () => {
    const rows = [row("019a", "2026-11-01", -100, 900)];
    const merged = withPending(
      rows,
      { ...NONE, edits: [{ key: 1, id: "019a", body: { accountId: "savings" } }] },
      context,
      DEFAULT_SORT,
      "checking",
    );
    expect(merged.rows).toEqual([]);
  });
});

describe("pending balances", () => {
  const list = (): components["schemas"]["AccountList"] => {
    const account = (id: string, type: "checking" | "savings", working: string) => ({
      id,
      name: id,
      logo: null,
      type,
      note: "",
      closed: false,
      starredOrder: null,
      currency: "USD" as const,
      interestRate: null,
      minimumPayment: null,
      escrowAmount: null,
      paymentCategoryId: null,
      hasHistory: true,
      balances: { cleared: working, uncleared: "0", working },
      lastReconciledAt: null,
      pairedCategoryId: null,
      lastPaymentDate: null,
      lastPaymentFromAccountId: null,
      migratedToAccountId: null,
      migratedFromAccountId: null,
      toReview: 0,
      unrealizedGain: null,
      rate: null,
      rateDate: null,
      converted: { currency: "USD" as const, cleared: working, uncleared: "0", working },
    });
    const total = (amount: string) => ({
      currency: "USD" as const,
      amount,
      converted: false,
      missing: [],
    });
    return {
      accounts: [account("checking", "checking", "10000"), account("savings", "savings", "500")],
      totals: {
        starred: total("0"),
        budget: total("10500"),
        loans: total("0"),
        tracking: total("0"),
        closed: total("0"),
        netWorth: total("10500"),
      },
      missingRates: 0,
    };
  };

  it("moves both sides of a new transfer, and the totals", () => {
    const created = pendingTransaction(
      "p",
      {
        accountId: "checking",
        date: "2026-11-01",
        amount: "-2500",
        payeeName: null,
        transferAccountId: "savings",
        categoryId: null,
        memo: "",
        flag: null,
      },
      context,
    );
    const next = withBalanceChange(list(), balanceChange(null, created, "2026-11-05"));
    const [checking, savings] = next.accounts;
    expect(checking?.balances).toEqual({ cleared: "10000", uncleared: "-2500", working: "7500" });
    expect(savings?.balances).toEqual({ cleared: "500", uncleared: "2500", working: "3000" });
    expect(checking?.converted?.working).toBe("7500");
    // Money moved within the budget: its totals stay.
    expect(next.totals.budget.amount).toBe("10500");
  });

  it("moves an edit's difference between cleared and uncleared, and leaves out future dates", () => {
    const before = row("a", "2026-11-01", -1000, 9000);
    const after = patchedTransaction(before, { cleared: "cleared", amount: "-1200" }, context);
    const change = balanceChange(before, after, "2026-11-05");
    expect(change.get("checking")).toEqual({ cleared: -1200n, uncleared: 1000n });
    const next = withBalanceChange(list(), change);
    expect(next.accounts[0]?.balances.working).toBe("9800");
    expect(next.totals.netWorth.amount).toBe("10300");
    const future = row("b", "2026-12-01", -1000, 9000);
    expect(balanceChange(null, future, "2026-11-05").size).toBe(0);
  });
});
