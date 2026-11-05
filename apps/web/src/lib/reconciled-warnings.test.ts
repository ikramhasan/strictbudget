import { describe, expect, it } from "vitest";
import { deleteWarning, editWarning, rowDeleteScope } from "./reconciled-warnings";
import type { Transaction } from "./transactions";

const base: Transaction = {
  id: "t1",
  accountId: "a1",
  accountName: "Checking",
  date: "2026-10-01",
  amount: "-900",
  currency: "USD",
  baseAmount: "0",
  fxRate: null,
  fxRateManual: false,
  payeeId: "p1",
  payeeName: "Shop",
  categoryId: null,
  categoryName: null,
  memo: "",
  cleared: "uncleared",
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
const transfer: Transaction = {
  ...base,
  payeeName: "Transfer : Savings",
  transferAccountId: "a2",
  transferTransactionId: "t2",
  transferReconciled: true,
  transferSide: null,
};
const name = (id: string) => (id === "a2" ? "Savings" : "Other");

describe("editWarning", () => {
  it("warns on a reconciled transaction's amount or account, not its memo or date", () => {
    const reconciled = { ...base, cleared: "reconciled" as const };
    expect(editWarning(reconciled, { amount: "-800" }, name)).toMatchObject({
      title: "Save changes to reconciled transaction",
      confirm: "Save",
    });
    expect(editWarning(reconciled, { accountId: "a3" }, name)).toMatchObject({
      title: "Move reconciled transaction",
      confirm: "Move",
    });
    expect(editWarning(reconciled, { memo: "x", date: "2026-10-02" }, name)).toBeNull();
    expect(editWarning(reconciled, { amount: "-900" }, name)).toBeNull();
    expect(editWarning(base, { amount: "-800" }, name)).toBeNull();
  });

  it("warns when a transfer with a reconciled other side changes amount, payee or account", () => {
    const warning = editWarning(transfer, { amount: "-1000" }, name);
    expect(warning).toEqual({
      title: "Save changes to reconciled transfer",
      paragraphs: [
        "This transfer has already been reconciled in Savings.",
        "Any changes to this transaction will automatically modify the matching, reconciled transaction in Savings and may bring the reconciliation out of balance.",
      ],
      confirm: "Save",
    });
    expect(editWarning(transfer, { transferAccountId: "a3" }, name)?.confirm).toBe("Save");
    expect(editWarning(transfer, { payeeName: "Bank" }, name)).not.toBeNull();
    expect(editWarning(transfer, { accountId: "a3" }, name)?.confirm).toBe("Move");
    expect(editWarning(transfer, { date: "2026-10-05" }, name)).toBeNull();
  });
});

describe("deleteWarning", () => {
  it("asks only when something reconciled goes", () => {
    expect(deleteWarning(rowDeleteScope(base))).toBeNull();
    expect(deleteWarning(rowDeleteScope({ ...base, cleared: "reconciled" }))?.title).toBe(
      "Delete reconciled transaction?",
    );
    expect(deleteWarning(rowDeleteScope(transfer))?.title).toBe("Delete reconciled transfer?");
    const split = {
      ...base,
      subtransactions: [
        {
          id: "l1",
          amount: "-900",
          baseAmount: "-900",
          payeeId: null,
          payeeName: "Transfer : Savings",
          categoryId: null,
          categoryName: null,
          needsCategory: false,
          memo: "",
          transferAccountId: "a2",
          transferTransactionId: "t3",
          transferReconciled: true,
          transferSide: null,
        },
      ],
    };
    expect(deleteWarning(rowDeleteScope(split))?.title).toBe("Delete reconciled transfer?");
    // Several: "Delete 2 Transactions?", the transfer wording winning.
    expect(deleteWarning({ count: 2, reconciled: 1, reconciledTransfers: 1 })).toMatchObject({
      title: "Delete 2 Transactions?",
      paragraphs: [
        "Deleting a transfer transaction will delete the transfer in both accounts.",
        expect.stringContaining("Some matching transfers"),
      ],
    });
  });
});
