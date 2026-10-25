import type { AccountType } from "@strictbudget/engine";
import { describe, expect, it } from "vitest";
import type { CategoryList } from "./categories";
import { inCurrency, type MoneySettings } from "./money-input";
import {
  categoryOptions,
  cellUpdate,
  createBody,
  type Draft,
  draftFrom,
  emptyDraft,
  emptyLine,
  movableAccounts,
  paymentCategoryCard,
  splitMismatch,
  splitRemaining,
  startSplit,
  type Transaction,
  transferChoiceLabel,
  transferRateLabel,
  transferRowLabel,
  updateBody,
  withSplitTotal,
} from "./transactions";

const acc = (name: string, type: AccountType) => ({ name, type });

describe("transfer wording", () => {
  const brac = acc("Brac", "checking");
  const cardA = acc("Card A", "credit_card");
  const cardB = acc("Card B", "credit_card");
  const track = acc("Track", "asset");
  const liab = acc("Liab", "liability");
  const loc = acc("LOC", "line_of_credit");
  const mort = acc("Mort", "mortgage");

  it("words the payee list by direction in a card", () => {
    expect(transferChoiceLabel("credit_card", brac, "in")).toBe("Payment from Brac");
    expect(transferChoiceLabel("credit_card", track, "in")).toBe("Payment from Track");
    expect(transferChoiceLabel("credit_card", cardB, "in")).toBe("Transfer from Card B");
    expect(transferChoiceLabel("credit_card", liab, "in")).toBe("Transfer from Liab");
    expect(transferChoiceLabel("credit_card", loc, "in")).toBe("Transfer from LOC");
    expect(transferChoiceLabel("credit_card", brac, "out")).toBe("Transfer to Brac");
    expect(transferChoiceLabel("credit_card", brac, null)).toBe("To/From Brac");
    expect(transferChoiceLabel("credit_card", mort, "in")).toBe("Payment: Mort");
  });

  it("words the payee list by direction in a cash account", () => {
    expect(transferChoiceLabel("checking", cardA, "out")).toBe("Payment to Card A");
    expect(transferChoiceLabel("checking", track, "out")).toBe("Transfer to Track");
    expect(transferChoiceLabel("checking", cardA, "in")).toBe("Transfer from Card A");
    expect(transferChoiceLabel("checking", mort, "out")).toBe("Payment: Mort");
    expect(transferChoiceLabel("checking", mort, null)).toBe("Payment: Mort");
  });

  it("names a saved transfer the same way on both sides", () => {
    // Brac → Card A (a payment), on each side.
    expect(transferRowLabel("checking", cardA, -500n)).toBe("Payment: Card A");
    expect(transferRowLabel("credit_card", brac, 500n)).toBe("Payment: Brac");
    // Card A → Brac (a cash advance), Card B → Card A, Brac → Savings.
    expect(transferRowLabel("credit_card", brac, -100n)).toBe("Transfer: Brac");
    expect(transferRowLabel("checking", cardA, 100n)).toBe("Transfer: Card A");
    expect(transferRowLabel("credit_card", cardB, 300n)).toBe("Transfer: Card B");
    expect(transferRowLabel("checking", acc("Savings", "savings"), -100n)).toBe(
      "Transfer: Savings",
    );
    // Tracking → card, and a loan payment.
    expect(transferRowLabel("credit_card", track, 100n)).toBe("Payment: Track");
    expect(transferRowLabel("asset", cardA, -100n)).toBe("Payment: Card A");
    expect(transferRowLabel("cash", mort, -90000n)).toBe("Payment: Mort");
    expect(transferRowLabel("mortgage", acc("Wallet", "cash"), 90000n)).toBe("Payment: Wallet");
  });

  it("shows the card's payment category between a card and a cash account only", () => {
    expect(paymentCategoryCard(brac, cardA)).toBe(cardA);
    expect(paymentCategoryCard(cardA, brac)).toBe(cardA);
    expect(paymentCategoryCard(cardA, cardB)).toBeNull();
    expect(paymentCategoryCard(cardA, track)).toBeNull();
    expect(paymentCategoryCard(brac, acc("Savings", "savings"))).toBeNull();
  });
});

const usd: MoneySettings = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
};

const txn: Transaction = {
  id: "t1",
  accountId: "a1",
  accountName: "Checking",
  date: "2026-10-01",
  amount: "-123456",
  currency: "USD",
  baseAmount: "0",
  fxRate: null,
  fxRateManual: false,
  payeeId: "p1",
  payeeName: "Market",
  categoryId: null,
  categoryName: null,
  memo: "",
  cleared: "reconciled",
  transferAccountId: null,
  transferTransactionId: null,
  flag: null,
  approved: true,
  needsCategory: false,
  imported: false,
  importedPayee: null,
  matched: null,
  transferFromSplit: false,
  transferReconciled: false,
  transferSide: null,
  subtransactions: [],
  runningBalance: "0",
  matchingLineIds: null,
  enteredBy: null,
  attachment: null,
  changedBy: null,
  version: 1,
};

describe("register drafts", () => {
  it("starts a new transaction cleared only in a cash account", () => {
    expect(emptyDraft("w", "2026-10-01", "cash").cleared).toBe("cleared");
    expect(emptyDraft("c", "2026-10-01", "checking").cleared).toBe("uncleared");
    expect(emptyDraft("s", "2026-10-01", "savings").cleared).toBe("uncleared");
    expect(emptyDraft("x", "2026-10-01").cleared).toBe("uncleared");
  });

  it("turns outflow and inflow fields into a signed amount", () => {
    const draft: Draft = { ...emptyDraft("a1", "2026-10-01"), outflow: "1,234.56" };
    expect(createBody(draft, usd)).toEqual({
      ok: true,
      body: {
        accountId: "a1",
        date: "2026-10-01",
        amount: "-123456",
        payeeName: null,
        categoryId: null,
        memo: "",
        cleared: "uncleared",
        flag: null,
      },
    });
    const income = createBody({ ...draft, outflow: "", inflow: "50", payeeName: " Job " }, usd);
    expect(income).toMatchObject({ ok: true, body: { amount: "5000", payeeName: "Job" } });
  });

  it("asks for a transfer by account instead of a payee name", () => {
    const draft: Draft = {
      ...emptyDraft("a1", "2026-10-01"),
      outflow: "5",
      payeeName: "Transfer : Savings",
      transferAccountId: "a2",
    };
    expect(createBody(draft, usd)).toMatchObject({
      ok: true,
      body: { payeeName: null, transferAccountId: "a2" },
    });
  });

  it("sends a typed FX rate, and an emptied one as null", () => {
    const draft: Draft = { ...emptyDraft("a1", "2026-10-01"), outflow: "5", fxRate: " 1.0842 " };
    expect(createBody(draft, usd)).toMatchObject({ ok: true, body: { fxRate: "1.0842" } });
    expect(createBody({ ...draft, fxRate: "" }, usd)).toMatchObject({
      ok: true,
      body: expect.not.objectContaining({ fxRate: expect.anything() }),
    });
    expect(createBody({ ...draft, fxRate: "1,08" }, usd)).toMatchObject({ ok: false });
    expect(createBody({ ...draft, fxRate: "0" }, usd)).toMatchObject({ ok: false });

    const typed: Transaction = { ...txn, currency: "EUR", fxRate: "1.15", fxRateManual: true };
    const before = draftFrom(typed, usd);
    expect(before.fxRate).toBe("1.15");
    expect(updateBody(typed, before, usd)).toEqual({ ok: true, body: {} });
    expect(updateBody(typed, { ...before, fxRate: "" }, usd)).toEqual({
      ok: true,
      body: { fxRate: null },
    });
    // The date's rate isn't shown as typed, so saving doesn't lock it by hand.
    const looked: Transaction = { ...typed, fxRateManual: false };
    expect(draftFrom(looked, usd).fxRate).toBe("");
  });

  describe("transfers between currencies", () => {
    const eur = inCurrency(usd, "EUR");
    const jpy = inCurrency(usd, "JPY");
    const draft: Draft = {
      ...emptyDraft("a1", "2026-10-01"),
      outflow: "100",
      payeeName: "Transfer : Euros",
      transferAccountId: "a2",
    };

    it("sends what the other account receives, the other way, in its currency", () => {
      expect(createBody({ ...draft, transferAmount: "85.00" }, usd, eur)).toMatchObject({
        ok: true,
        body: { amount: "-10000", transferAccountId: "a2", transferAmount: "8500" },
      });
      // An inflow: what the other account sends, here in yen (no decimals).
      expect(
        createBody({ ...draft, outflow: "", inflow: "100", transferAmount: "15,000" }, usd, jpy),
      ).toMatchObject({ ok: true, body: { amount: "10000", transferAmount: "-15000" } });
      // Empty, it's the date's rate; in one currency it isn't sent at all.
      expect(createBody(draft, usd, eur)).toMatchObject({
        ok: true,
        body: expect.not.objectContaining({ transferAmount: expect.anything() }),
      });
      expect(createBody({ ...draft, transferAmount: "85" }, usd)).toMatchObject({
        ok: true,
        body: expect.not.objectContaining({ transferAmount: expect.anything() }),
      });
      expect(createBody({ ...draft, transferAmount: "8x" }, usd, eur)).toMatchObject({ ok: false });
    });

    it("sends a fee in the sending account's currency with its category", () => {
      expect(createBody({ ...draft, fee: "3", feeCategoryId: "c1" }, usd, eur)).toMatchObject({
        ok: true,
        body: { fee: { amount: "300", categoryId: "c1" } },
      });
      // An inflow's fee is the other (yen) account's.
      expect(
        createBody({ ...draft, outflow: "", inflow: "100", fee: "500" }, usd, jpy),
      ).toMatchObject({ ok: true, body: { fee: { amount: "500", categoryId: null } } });
      expect(createBody({ ...draft, fee: "0" }, usd, eur)).toMatchObject({ ok: false });
      // Only a transfer has one.
      expect(
        createBody({ ...draft, transferAccountId: null, payeeName: "Shop", fee: "3" }, usd),
      ).toMatchObject({ ok: true, body: expect.not.objectContaining({ fee: expect.anything() }) });
    });

    it("keeps the other side's amount unless it's changed, and clears it to null", () => {
      const transfer: Transaction = {
        ...txn,
        cleared: "uncleared",
        amount: "-10000",
        transferAccountId: "a2",
        transferTransactionId: "t2",
        transferSide: {
          id: "side",
          version: 1,
          memo: "",
          cleared: "uncleared",
          flag: null,
          approved: true,
          categoryId: null,
          amount: "8500",
          currency: "EUR",
        },
      };
      const before = draftFrom(transfer, usd);
      expect(before.transferAmount).toBe("85.00");
      expect(updateBody(transfer, { ...before, outflow: "200" }, usd, eur)).toEqual({
        ok: true,
        body: { amount: "-20000" },
      });
      expect(updateBody(transfer, { ...before, transferAmount: "90" }, usd, eur)).toEqual({
        ok: true,
        body: { transferAmount: "9000" },
      });
      expect(updateBody(transfer, { ...before, transferAmount: "" }, usd, eur)).toEqual({
        ok: true,
        body: { transferAmount: null },
      });
    });

    it("shows the rate the two amounts imply", () => {
      expect(transferRateLabel(-10000n, "USD", 8500n, "EUR")).toBe("1 EUR = 1.17647 USD");
      expect(transferRateLabel(10000n, "USD", -15000n, "JPY")).toBe("1 JPY = 0.00666667 USD");
      expect(transferRateLabel(0n, "USD", 8500n, "EUR")).toBeNull();
    });
  });

  it("explains an amount it can't read", () => {
    const draft = { ...emptyDraft("a1", "2026-10-01"), outflow: "12.345" };
    expect(createBody(draft, usd)).toEqual({ ok: false, error: "Enter an amount like 1,234.56" });
  });

  it("sends only the fields that changed", () => {
    const draft = draftFrom(txn, usd);
    expect(draft).toMatchObject({ outflow: "1,234.56", inflow: "", cleared: "cleared" });
    // Untouched: nothing to send, so a reconciled transaction stays reconciled and an
    // uncategorized starting balance stays uncategorized.
    expect(updateBody(txn, draft, usd)).toEqual({ ok: true, body: {} });
    expect(updateBody(txn, { ...draft, memo: "weekly", outflow: "20" }, usd)).toEqual({
      ok: true,
      body: { memo: "weekly", amount: "-2000" },
    });
  });

  it("offers Ready to Assign and visible categories, never payment categories", () => {
    const list: CategoryList = {
      readyToAssignCategoryId: "rta",
      uncategorizedCategoryId: "uncat",
      groups: [
        {
          id: "cc",
          name: "Credit Card Payments",
          hidden: false,
          kind: "credit_card_payments",
          categories: [
            {
              id: "visa",
              groupId: "cc",
              name: "Visa",
              note: "",
              hidden: false,
              linkedAccountId: "a2",
              hasTransactions: false,
              transactionCount: 0,
              hasAssignedMoney: false,
              target: null,
            },
          ],
        },
        {
          id: "bills",
          name: "Bills",
          hidden: false,
          kind: null,
          categories: [
            {
              id: "rent",
              groupId: "bills",
              name: "Rent",
              note: "",
              hidden: false,
              linkedAccountId: null,
              hasTransactions: false,
              transactionCount: 0,
              hasAssignedMoney: false,
              target: null,
            },
            {
              id: "old",
              groupId: "bills",
              name: "Old",
              note: "",
              hidden: true,
              linkedAccountId: null,
              hasTransactions: false,
              transactionCount: 0,
              hasAssignedMoney: false,
              target: null,
            },
          ],
        },
      ],
    };
    expect(categoryOptions(list)).toEqual([
      { id: "rta", name: "Ready to Assign", group: "Inflow" },
      { id: "rent", name: "Rent", group: "Bills" },
    ]);
  });
});

describe("a transaction in an account's own currency", () => {
  const yenTxn: Transaction = { ...txn, amount: "-1200", currency: "JPY" };
  const yen = inCurrency(usd, yenTxn.currency);

  it("edits yen amounts without decimals, in the budget's number format", () => {
    expect(draftFrom(yenTxn, yen)).toMatchObject({ outflow: "1,200", inflow: "" });
    expect(cellUpdate(yenTxn, "outflow", "1,500", yen)).toEqual({
      ok: true,
      body: { amount: "-1500" },
    });
    expect(cellUpdate(yenTxn, "outflow", "12.50", yen)).toMatchObject({ ok: false });
  });

  it("reads a new transaction's amount in its account's currency", () => {
    const draft: Draft = { ...emptyDraft("a1", "2026-10-01"), outflow: "1.5" };
    expect(createBody(draft, inCurrency(usd, "KWD"))).toMatchObject({
      ok: true,
      body: { amount: "-1500" },
    });
    expect(createBody(draft, usd)).toMatchObject({ ok: true, body: { amount: "-150" } });
  });
});

describe("movableAccounts", () => {
  it("offers open accounts in the transaction's currency, and the one it's in", () => {
    const accounts = [
      { id: "usd", closed: false, currency: "USD" },
      { id: "usd2", closed: false, currency: "USD" },
      { id: "eur", closed: false, currency: "EUR" },
      { id: "old", closed: true, currency: "USD" },
    ];
    expect(
      movableAccounts(accounts, { accountId: "usd", currency: "USD" }).map((a) => a.id),
    ).toEqual(["usd", "usd2"]);
    expect(
      movableAccounts(accounts, { accountId: "eur", currency: "EUR" }).map((a) => a.id),
    ).toEqual(["eur"]);
    expect(
      movableAccounts(accounts, { accountId: "old", currency: "USD" }).map((a) => a.id),
    ).toEqual(["usd", "usd2", "old"]);
  });
});

describe("cellUpdate", () => {
  it("turns an edited amount cell into the transaction's new amount", () => {
    expect(cellUpdate(txn, "outflow", "230+30", usd)).toEqual({
      ok: true,
      body: { amount: "-26000" },
    });
    // Typing an inflow on an outflow flips it.
    expect(cellUpdate(txn, "inflow", "5", usd)).toEqual({ ok: true, body: { amount: "500" } });
    // Emptying the outflow of an outflow makes it zero; emptying the other side changes nothing.
    expect(cellUpdate(txn, "outflow", "", usd)).toEqual({ ok: true, body: { amount: "0" } });
    expect(cellUpdate(txn, "inflow", "", usd)).toEqual({ ok: true, body: {} });
    expect(cellUpdate(txn, "outflow", "1,234.56", usd)).toEqual({ ok: true, body: {} });
    expect(cellUpdate(txn, "outflow", "abc", usd)).toMatchObject({ ok: false });
  });

  it("sends only a changed field", () => {
    expect(cellUpdate(txn, "memo", "", usd)).toEqual({ ok: true, body: {} });
    expect(cellUpdate(txn, "memo", "milk", usd)).toEqual({ ok: true, body: { memo: "milk" } });
    expect(cellUpdate(txn, "payee", " ", usd)).toEqual({ ok: true, body: { payeeName: null } });
    expect(cellUpdate(txn, "date", "2026-10-02", usd)).toEqual({
      ok: true,
      body: { date: "2026-10-02" },
    });
  });

  it("switches between payees and transfers", () => {
    const transfer = { ...txn, payeeName: "Transfer : Savings", transferAccountId: "a2" };
    expect(cellUpdate(txn, "payee", "Transfer : Savings", usd, "a2")).toEqual({
      ok: true,
      body: { transferAccountId: "a2" },
    });
    expect(cellUpdate(transfer, "payee", "Transfer : Savings", usd, "a2")).toEqual({
      ok: true,
      body: {},
    });
    // Same text, but no longer the transfer: it becomes a normal payee.
    expect(cellUpdate(transfer, "payee", "Transfer : Savings", usd)).toEqual({
      ok: true,
      body: { payeeName: "Transfer : Savings" },
    });
    expect(cellUpdate(transfer, "payee", "Bank", usd)).toEqual({
      ok: true,
      body: { payeeName: "Bank" },
    });
  });
});

describe("splits", () => {
  const receipt: Draft = {
    ...emptyDraft("a1", "2026-10-01"),
    payeeName: "Supermarket",
    outflow: "120",
    lines: [
      emptyLine({ categoryId: "groceries", outflow: "80", memo: "food" }),
      emptyLine({ categoryId: "household", outflow: "40" }),
    ],
  };

  it("finds a split that doesn't add up, and distributes the rest", () => {
    expect(splitMismatch(receipt, usd)).toBeNull();
    expect(splitMismatch({ ...receipt, outflow: "" }, usd)).toBeNull();
    const short = { ...receipt, outflow: "0.03", lines: [] as Draft["lines"] };
    const draft: Draft = {
      ...short,
      lines: [
        emptyLine({ outflow: "0.01" }),
        emptyLine({ outflow: "0.01" }),
        emptyLine({ outflow: "0" }),
      ],
    };
    const found = splitMismatch(draft, usd);
    expect(found).toMatchObject({ total: -3n, lines: -2n, unassigned: -1n });
    // The $0 line is skipped and keeps what was typed.
    expect(found?.distributed?.map((l) => [l.outflow, l.inflow])).toEqual([
      ["0.02", ""],
      ["0.01", ""],
      ["0", ""],
    ]);
    // Every line empty: spread evenly, the first taking the extra cent.
    const empty: Draft = {
      ...receipt,
      outflow: "",
      inflow: "0.10",
      lines: [emptyLine(), emptyLine(), emptyLine()],
    };
    expect(splitMismatch(empty, usd)?.distributed?.map((l) => l.inflow)).toEqual([
      "0.04",
      "0.03",
      "0.03",
    ]);
    expect(withSplitTotal({ ...receipt, outflow: "130" }, usd).outflow).toBe("120.00");
  });

  it("moves the category to the first line when splitting", () => {
    const split = startSplit({ ...emptyDraft("a1", "2026-10-01"), categoryId: "groceries" });
    expect(split.categoryId).toBeNull();
    expect(split.lines?.map((l) => l.categoryId)).toEqual(["groceries", null]);
  });

  it("counts what's left to split, for outflows and inflows", () => {
    const short = { ...receipt, outflow: "130" };
    expect(splitRemaining(short, usd)).toEqual({ total: -13000n, remaining: 1000n });
    expect(splitRemaining({ ...receipt, outflow: "100" }, usd)).toMatchObject({
      remaining: -2000n,
    });
    // No total typed: the lines make it up.
    expect(splitRemaining({ ...receipt, outflow: "" }, usd)).toEqual({
      total: -12000n,
      remaining: 0n,
    });
    expect(createBody(short, usd)).toEqual({
      ok: false,
      error: "The lines must add up to the total: 10.00 left to split.",
    });
  });

  it("sends the lines, with transfers by account", () => {
    const lines = receipt.lines ?? [];
    const draft: Draft = {
      ...receipt,
      lines: [
        ...lines.slice(0, 1),
        { ...(lines[1] ?? emptyLine()), categoryId: null, transferAccountId: "a2", payeeName: "x" },
      ],
    };
    expect(createBody(draft, usd)).toMatchObject({
      ok: true,
      body: {
        amount: "-12000",
        categoryId: null,
        subtransactions: [
          { amount: "-8000", payeeName: null, categoryId: "groceries", memo: "food" },
          { amount: "-4000", payeeName: null, transferAccountId: "a2", categoryId: null },
        ],
      },
    });
  });

  it("isn't a split any more with one line left: it keeps that line's category", () => {
    const one = { ...receipt, outflow: "", lines: receipt.lines?.slice(1) ?? [] };
    const result = createBody(one, usd);
    expect(result).toMatchObject({ ok: true, body: { amount: "-4000", categoryId: "household" } });
    expect(result.ok && "subtransactions" in result.body).toBe(false);
  });

  it("only sends changed lines, and un-splits with a category", () => {
    const split: Transaction = {
      ...txn,
      amount: "-12000",
      cleared: "uncleared",
      subtransactions: [
        {
          id: "l1",
          amount: "-8000",
          baseAmount: "-8000",
          payeeId: null,
          payeeName: null,
          categoryId: "groceries",
          categoryName: "Groceries",
          needsCategory: false,
          memo: "",
          transferAccountId: null,
          transferTransactionId: null,
          transferReconciled: false,
          transferSide: null,
        },
        {
          id: "l2",
          amount: "-4000",
          baseAmount: "-4000",
          payeeId: null,
          payeeName: null,
          categoryId: "household",
          categoryName: "Household",
          needsCategory: false,
          memo: "",
          transferAccountId: null,
          transferTransactionId: null,
          transferReconciled: false,
          transferSide: null,
        },
      ],
    };
    const draft = draftFrom(split, usd);
    expect(updateBody(split, draft, usd)).toEqual({ ok: true, body: {} });

    const lines = draft.lines ?? [];
    const edited = { ...draft, lines: lines.map((l, i) => (i === 0 ? { ...l, memo: "food" } : l)) };
    expect(updateBody(split, edited, usd)).toMatchObject({
      ok: true,
      body: { subtransactions: [{ id: "l1", memo: "food" }, { id: "l2" }] },
    });

    const unsplit = { ...draft, lines: lines.slice(0, 1), outflow: "120" };
    expect(updateBody(split, unsplit, usd)).toEqual({
      ok: true,
      body: { categoryId: "groceries" },
    });
  });
});
