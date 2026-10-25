import { describe, expect, it } from "vitest";
import { createBodyFromTransaction, updateBodyFromTransaction } from "./transaction-history";
import type { Transaction } from "./transactions";

const transaction: Transaction = {
  id: "t1",
  accountId: "a1",
  accountName: "Checking",
  date: "2026-10-03",
  amount: "-1200",
  currency: "USD",
  baseAmount: "0",
  fxRate: null,
  fxRateManual: false,
  payeeId: "p1",
  payeeName: "Shop",
  categoryId: null,
  categoryName: null,
  memo: "weekly",
  cleared: "cleared",
  flag: "blue",
  approved: true,
  needsCategory: false,
  imported: false,
  importedPayee: null,
  matched: null,
  transferAccountId: null,
  transferTransactionId: null,
  transferFromSplit: false,
  transferReconciled: false,
  transferSide: null,
  subtransactions: [
    {
      id: "s1",
      amount: "-700",
      baseAmount: "-700",
      payeeId: null,
      payeeName: null,
      categoryId: "c1",
      categoryName: "Food",
      needsCategory: false,
      memo: "food",
      transferAccountId: null,
      transferTransactionId: null,
      transferReconciled: false,
      transferSide: null,
    },
    {
      id: "s2",
      amount: "-500",
      baseAmount: "-500",
      payeeId: null,
      payeeName: null,
      categoryId: null,
      categoryName: null,
      needsCategory: false,
      memo: "transfer",
      transferAccountId: "a2",
      transferTransactionId: "t2",
      transferReconciled: false,
      transferSide: null,
    },
  ],
  runningBalance: "10000",
  matchingLineIds: null,
  enteredBy: null,
  attachment: null,
  changedBy: null,
  version: 1,
};

describe("transaction history bodies", () => {
  it("recreates a deleted split without reusing its database line ids", () => {
    expect(createBodyFromTransaction(transaction).subtransactions).toEqual([
      { amount: "-700", payeeName: null, categoryId: "c1", memo: "food" },
      {
        amount: "-500",
        payeeName: null,
        transferAccountId: "a2",
        categoryId: null,
        memo: "transfer",
      },
    ]);
  });

  it("restores an edited split by matching its existing line ids", () => {
    expect(updateBodyFromTransaction(transaction).subtransactions?.map((line) => line.id)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("brings a transfer's other side back as it was, even to an account closed since", () => {
    const side = {
      id: "side",
      version: 1,
      memo: "their memo",
      cleared: "reconciled" as const,
      flag: "red" as const,
      approved: true,
      categoryId: "c9",
      amount: "500",
      currency: "USD" as const,
    };
    const { currency: _, ...input } = side;
    const transfer = {
      ...transaction,
      payeeName: "Transfer : Savings",
      transferAccountId: "a2",
      transferTransactionId: "t2",
      approved: false,
      transferSide: side,
      subtransactions: [],
    };
    expect(createBodyFromTransaction(transfer)).toMatchObject({
      transferAccountId: "a2",
      payeeName: null,
      approved: false,
      transferSide: input,
      restore: true,
    });
    // A split's transfer lines keep their other sides' state too.
    const lines = transaction.subtransactions.map((line) =>
      line.transferAccountId ? { ...line, transferSide: side } : line,
    );
    expect(
      createBodyFromTransaction({ ...transaction, subtransactions: lines }).subtransactions?.[1],
    ).toMatchObject({ transferAccountId: "a2", transferSide: input });
    expect(createBodyFromTransaction(transaction)).not.toHaveProperty("transferSide");
  });

  it("brings back a cross-currency transfer's other amount", () => {
    const side = {
      id: "side",
      version: 1,
      memo: "",
      cleared: "uncleared" as const,
      flag: null,
      approved: true,
      categoryId: null,
      amount: "430",
      currency: "EUR" as const,
    };
    const transfer = {
      ...transaction,
      payeeName: "Transfer : Euros",
      transferAccountId: "a3",
      transferTransactionId: "t3",
      transferSide: side,
      subtransactions: [],
    };
    const { currency: _, ...input } = side;
    expect(createBodyFromTransaction(transfer).transferSide).toEqual(input);
    expect(updateBodyFromTransaction(transfer).transferAmount).toBe("430");
    // In one currency the other side just follows.
    const same = { ...transfer, transferSide: { ...side, currency: "USD" as const } };
    expect(updateBodyFromTransaction(same)).not.toHaveProperty("transferAmount");
  });

  it("brings back a deleted FX Revaluation with its booked base amount", () => {
    const revaluation: Transaction = {
      ...transaction,
      amount: "0",
      currency: "EUR",
      baseAmount: "5435",
      fxRate: "1.25",
      fxRateManual: false,
      subtransactions: [],
    };
    expect(createBodyFromTransaction(revaluation)).toMatchObject({
      amount: "0",
      baseAmount: "5435",
      fxRate: "1.25",
      restore: true,
    });
    expect(createBodyFromTransaction(transaction)).not.toHaveProperty("baseAmount");
  });

  it("keeps a reconciled transaction reconciled", () => {
    const reconciled = { ...transaction, cleared: "reconciled" as const };
    expect(createBodyFromTransaction(reconciled).cleared).toBe("reconciled");
    expect(updateBodyFromTransaction(reconciled)).not.toHaveProperty("cleared");
    expect(updateBodyFromTransaction(transaction).cleared).toBe("cleared");
  });

  it("puts an edited transaction's approval back (edits approve it)", () => {
    expect(updateBodyFromTransaction({ ...transaction, approved: false }).approved).toBe(false);
    expect(updateBodyFromTransaction(transaction).approved).toBe(true);
  });
});
