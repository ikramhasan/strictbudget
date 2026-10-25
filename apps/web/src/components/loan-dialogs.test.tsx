import { render, screen } from "@testing-library/react";
import { addDays, format, parseISO } from "date-fns";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/lib/accounts";
import { todayIso } from "@/lib/dates";
import {
  type ActivityKind,
  defaultPaymentSource,
  LoanActivityDialog,
  RecordPaymentDialog,
} from "./loan-dialogs";

const usd = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
} as const;

const account = (id: string, type: Account["type"], closed = false): Account => ({
  id,
  name: id,
  logo: null,
  type,
  note: "",
  closed,
  starredOrder: null,
  currency: "USD",
  interestRate: null,
  minimumPayment: null,
  escrowAmount: null,
  paymentCategoryId: null,
  hasHistory: false,
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
  balances: { cleared: "0", uncleared: "0", working: "0" },
});

// Cash accounts and cards in sidebar order, plus a loan and a tracking account that can't pay.
const accounts = [
  account("F Card", "credit_card"),
  account("AA L7 Test", "savings"),
  account("L7 Mortgage", "mortgage"),
  account("F Cash", "cash"),
  account("x-130 Card", "credit_card"),
  account("House", "asset"),
  account("L7 Chk", "checking"),
];

function renderDialog(lastFromAccountId: string | null) {
  render(
    <RecordPaymentDialog
      open
      onOpenChange={vi.fn()}
      accounts={accounts}
      settings={usd}
      format={(n) => `$${n}`}
      paired={null}
      lastFromAccountId={lastFromAccountId}
      onSave={vi.fn(async () => null)}
    />,
  );
  return screen.getByLabelText("From Account") as HTMLSelectElement;
}

describe("Record Payment's From Account", () => {
  it("starts on the account of the payment entered last", () => {
    expect(renderDialog("L7 Chk").value).toBe("L7 Chk");
  });

  it("starts on the first account in the list when the loan has no payments", () => {
    // Cash accounts come first in the list, whatever the overall account order.
    expect(renderDialog(null).value).toBe("AA L7 Test");
  });

  it("falls back to the first account when the last one is closed or can't pay", () => {
    const closed = [...accounts, account("Old Chk", "checking", true)];
    expect(defaultPaymentSource(closed, "Old Chk")).toBe("AA L7 Test");
    expect(defaultPaymentSource(accounts, "House")).toBe("AA L7 Test");
    expect(defaultPaymentSource([account("F Card", "credit_card")], null)).toBe("F Card");
    expect(defaultPaymentSource([], null)).toBe("");
  });
});

describe("Loan credit and charge dates", () => {
  const today = todayIso();
  const tomorrow = format(addDays(parseISO(today), 1), "yyyy-MM-dd");
  const renderActivity = (kind: ActivityKind, date: string) =>
    render(
      <LoanActivityDialog
        open
        onOpenChange={vi.fn()}
        kind={kind}
        initial={{ amount: 500n, date, memo: "" }}
        settings={usd}
        onSave={vi.fn(async () => null)}
      />,
    );

  it("greys Save out for a credit or charge dated after today", () => {
    renderActivity("credit", tomorrow);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("greys Save out for a balance adjustment dated after today", () => {
    renderActivity("adjustment", tomorrow);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps Save for today", () => {
    renderActivity("charge", today);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
