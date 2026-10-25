import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/lib/accounts";
import {
  cardPaymentAmount,
  cardPaymentDraft,
  OverspendingFigure,
  PaymentFigure,
} from "./card-payment";

vi.mock("@/lib/budget-context", () => ({ useBudget: () => ({ budget: { id: "b1" } }) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search }: { children: ReactNode; search: { category: string } }) => (
    <a href={`/budgets/b1?category=${search.category}`}>{children}</a>
  ),
}));

const usd = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
} as const;

const account = (
  id: string,
  type: Account["type"],
  extra: Partial<Account> = {},
  cleared = "0",
): Account => ({
  id,
  name: id,
  logo: null,
  type,
  note: "",
  closed: false,
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
  balances: { cleared, uncleared: "0", working: cleared },
  ...extra,
});

const format = (minorUnits: string) => `$${(Number(minorUnits) / 100).toFixed(2)}`;

describe("a card's Record Payment", () => {
  it("pays the lower of the payment Available and the cleared balance owed", () => {
    expect(cardPaymentAmount(300n, -100n)).toBe(100n);
    expect(cardPaymentAmount(200n, -500n)).toBe(200n);
    expect(cardPaymentAmount(0n, -100n)).toBe(0n);
    expect(cardPaymentAmount(300n, 0n)).toBe(0n);
    expect(cardPaymentAmount(-50n, -100n)).toBe(0n);
  });

  it("prefills a transfer from the cash account last used, dated today", () => {
    const cash = account("F Cash", "cash");
    const card = account(
      "x-130 Card",
      "credit_card",
      { lastPaymentFromAccountId: "F Cash" },
      "-100",
    );
    const draft = cardPaymentDraft({
      card,
      accounts: [cash, card],
      available: 300n,
      settings: usd,
      today: "2026-10-14",
    });
    expect(draft).toMatchObject({
      accountId: "x-130 Card",
      date: "2026-10-14",
      payeeName: "Payment from F Cash",
      transferAccountId: "F Cash",
      inflow: "1.00",
      outflow: "",
      categoryId: null,
    });
  });

  it("leaves the payee and amount empty with no earlier payment and nothing set aside", () => {
    const card = account("x-144 Card", "credit_card", {}, "-200");
    const draft = cardPaymentDraft({
      card,
      accounts: [account("F Cash", "cash"), card],
      available: 0n,
      settings: usd,
      today: "2026-10-14",
    });
    expect(draft).toMatchObject({ payeeName: "", transferAccountId: null, inflow: "" });
  });

  it("prefills another card the card was last paid from", () => {
    const other = account("x-c11-163 Card B", "credit_card");
    const card = account("Card", "credit_card", { lastPaymentFromAccountId: other.id }, "-100");
    const draft = cardPaymentDraft({
      card,
      accounts: [other, card],
      available: 0n,
      settings: usd,
      today: "2026-10-15",
    });
    expect(draft).toMatchObject({
      transferAccountId: other.id,
      // Nothing set aside, so no amount: the payee reads "To/From" then.
      payeeName: "To/From x-c11-163 Card B",
    });
  });

  it("doesn't prefill a closed account", () => {
    const closed = account("Old", "checking", { closed: true });
    const card = account("Card", "credit_card", { lastPaymentFromAccountId: "Old" }, "-100");
    const draft = cardPaymentDraft({
      card,
      accounts: [closed, card],
      available: 100n,
      settings: usd,
      today: "2026-10-14",
    });
    expect(draft.transferAccountId).toBeNull();
  });
});

describe("the card register's Payment figure", () => {
  it("is plain green when the payment is covered", () => {
    render(<PaymentFigure categoryId="pay" available={300n} caution={false} format={format} />);
    expect(screen.getByText("Payment")).toBeTruthy();
    expect(screen.getByTitle("$3.00")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains a shortfall and links to the plan", async () => {
    render(<PaymentFigure categoryId="pay" available={0n} caution format={format} />);
    await userEvent.click(screen.getByRole("button", { name: /not enough set aside/ }));
    expect(
      await screen.findByText("You don't have enough money set aside for your payment."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "fix this in your plan." }).getAttribute("href")).toBe(
      "/budgets/b1?category=pay",
    );
  });
});

describe("the card register's Overspending figure", () => {
  it("shows this month's credit overspending, labelled with the month", () => {
    render(<OverspendingFigure amount={200n} month="2026-10" format={format} />);
    expect(screen.getByText("Overspending (Oct)")).toBeTruthy();
    expect(screen.getByTitle("$2.00")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides at zero", () => {
    const { container } = render(
      <OverspendingFigure amount={0n} month="2026-10" format={format} />,
    );
    expect(container.textContent).toBe("");
  });
});
