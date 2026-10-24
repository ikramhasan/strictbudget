import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CategoryList } from "@/lib/categories";
import type { MoneySettings } from "@/lib/money-input";
import { AddAccountForm, EditAccountForm } from "./account-forms";

const usd: MoneySettings = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
};

describe("AddAccountForm", () => {
  it("records a cash balance as-is, in minor units", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<AddAccountForm settings={usd} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Nickname"), "Checking");
    await userEvent.type(screen.getByLabelText("What's the balance today?"), "1,234.56");
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Checking",
      type: "checking",
      balance: "123456",
    });
  });

  it("offers a currency for every account but loans, reading the balance in it", async () => {
    // cmdk scrolls the picked currency into view, which jsdom doesn't implement.
    Element.prototype.scrollIntoView = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<AddAccountForm settings={usd} onSubmit={onSubmit} />);
    // Budget accounts take a currency; loans use the budget's.
    expect(screen.getByLabelText("Currency")).toHaveTextContent("USD");
    await userEvent.selectOptions(screen.getByLabelText("Account type"), "mortgage");
    expect(screen.queryByLabelText("Currency")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Account type"), "asset");
    expect(screen.getByLabelText("Currency")).toHaveTextContent("USD");
    await userEvent.click(screen.getByLabelText("Currency"));
    await userEvent.click(await screen.findByRole("option", { name: /JPY/ }));
    expect(screen.getByLabelText("Currency")).toHaveTextContent("JPY");
    await userEvent.type(screen.getByLabelText("Nickname"), "Tokyo");
    await userEvent.type(screen.getByLabelText("What's the balance today?"), "150,000");
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Tokyo",
      type: "asset",
      currency: "JPY",
      balance: "150000",
    });
  });

  it("asks debt accounts for the amount owed and stores it as negative", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<AddAccountForm settings={usd} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Account type"), "credit_card");
    await userEvent.type(screen.getByLabelText("Nickname"), "Visa");
    await userEvent.type(screen.getByLabelText("How much do you owe today?"), "375");
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Visa", type: "credit_card", balance: "-37500" });
  });

  it("collects loan details for loan accounts", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<AddAccountForm settings={usd} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Account type"), "mortgage");
    await userEvent.type(screen.getByLabelText("Nickname"), "Home");
    await userEvent.type(screen.getByLabelText("How much do you owe today?"), "250000");
    await userEvent.type(screen.getByLabelText("Interest rate (%)"), "6.125");
    await userEvent.type(screen.getByLabelText("Monthly payment required by your lender"), "1,800");
    await userEvent.click(screen.getByLabelText("Yes"));
    await userEvent.type(screen.getByLabelText("How much is the monthly escrow or fee?"), "150");
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Home",
      type: "mortgage",
      balance: "-25000000",
      interestRate: "6.125",
      minimumPayment: "180000",
      escrowAmount: "15000",
    });
  });

  it("drops escrow typed for a mortgage when the type changes", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<AddAccountForm settings={usd} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Account type"), "mortgage");
    await userEvent.type(screen.getByLabelText("Nickname"), "Car");
    await userEvent.click(screen.getByLabelText("Yes"));
    await userEvent.type(screen.getByLabelText("How much is the monthly escrow or fee?"), "150");
    await userEvent.selectOptions(screen.getByLabelText("Account type"), "auto_loan");
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ escrowAmount: undefined }));
  });

  it("offers to pair a loan with a category, or skip", async () => {
    const categories = {
      groups: [
        {
          id: "g1",
          name: "Bills",
          kind: null,
          categories: [{ id: "c1", name: "Car Loan", linkedAccountId: null }],
        },
      ],
    } as unknown as CategoryList;
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<AddAccountForm settings={usd} categories={categories} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Account type"), "auto_loan");
    await userEvent.type(screen.getByLabelText("Nickname"), "Car");
    await userEvent.type(screen.getByLabelText("How much do you owe today?"), "9000");
    expect(screen.queryByLabelText("How much is the monthly escrow or fee?")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Optional: Pair a Category")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Select a category"), "c1");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "auto_loan", pairing: { categoryId: "c1" } }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSubmit.mock.lastCall?.[0]).not.toHaveProperty("pairing");
  });

  it("reads amounts in the budget's number format", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(
      <AddAccountForm
        settings={{ ...usd, currency: "EUR", numberFormat: "dot_comma" }}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.type(screen.getByLabelText("Nickname"), "Girokonto");
    await userEvent.type(screen.getByLabelText("What's the balance today?"), "1.234,5");
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ balance: "123450" }));
  });

  it("explains an amount it can't read", async () => {
    const onSubmit = vi.fn();
    render(<AddAccountForm settings={usd} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Nickname"), "Checking");
    await userEvent.type(screen.getByLabelText("What's the balance today?"), "12.345");
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter an amount like 1,234.56");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("EditAccountForm", () => {
  it("only offers types from the same family", () => {
    render(
      <EditAccountForm
        settings={usd}
        initial={{
          name: "Visa",
          note: "",
          type: "credit_card",
          interestRate: null,
          minimumPayment: null,
          escrowAmount: null,
        }}
        workingBalance={-6400n}
        onSubmit={vi.fn()}
      />,
    );
    const options = within(screen.getByLabelText("Account type"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Credit Card", "Line of Credit"]);
  });

  it("labels a tracking account's balance Today's Balance", () => {
    render(
      <EditAccountForm
        settings={usd}
        initial={{
          name: "House",
          note: "",
          type: "asset",
          interestRate: null,
          minimumPayment: null,
          escrowAmount: null,
        }}
        workingBalance={4900n}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Today's Balance")).toHaveValue("49.00");
  });

  it("sends a changed working balance only", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup();
    render(
      <EditAccountForm
        settings={usd}
        initial={{
          name: "Visa",
          note: "",
          type: "credit_card",
          interestRate: null,
          minimumPayment: null,
          escrowAmount: null,
        }}
        workingBalance={-6400n}
        onSubmit={onSubmit}
      />,
    );
    const field = screen.getByLabelText("Working Balance");
    expect(field).toHaveValue("-64.00");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit.mock.lastCall?.[0]).not.toHaveProperty("workingBalance");
    // Taken as typed: a card's "70" is a positive balance.
    await user.clear(field);
    await user.type(field, "70");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit.mock.lastCall?.[0]).toMatchObject({ workingBalance: "7000" });
  });
});
