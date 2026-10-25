import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CategoryList } from "@/lib/categories";
import type { MoneySettings } from "@/lib/money-input";
import { OriginalHistory, UpdateToLoanDialog, UpdateToLoanSection } from "./update-to-loan";

const usd: MoneySettings = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
};
const format = (minorUnits: bigint) =>
  `${minorUnits < 0n ? "-" : ""}$${(Number(minorUnits < 0n ? -minorUnits : minorUnits) / 100).toFixed(2)}`;
const categories = {
  groups: [
    {
      id: "g1",
      name: "Bills",
      kind: null,
      categories: [{ id: "c1", name: "Rent", linkedAccountId: null }],
    },
  ],
} as unknown as CategoryList;

function renderDialog(onSubmit = vi.fn().mockResolvedValue({ loanId: "loan-1" })) {
  const onDone = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <UpdateToLoanDialog
      open
      onOpenChange={onOpenChange}
      account={{ name: "x-145 HELOC", balances: { working: "-483000" } }}
      settings={usd}
      categories={categories}
      format={format}
      onSubmit={onSubmit}
      onDone={onDone}
    />,
  );
  return { onSubmit, onDone, onOpenChange };
}

describe("Update to a Loan Account", () => {
  it("is offered from Edit Account with Learn More", async () => {
    const onLearnMore = vi.fn();
    render(<UpdateToLoanSection onLearnMore={onLearnMore} />);
    expect(
      screen.getByText(
        "Plan your payments and track your progress when you migrate to a loan account.",
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Learn More" }));
    expect(onLearnMore).toHaveBeenCalled();
  });

  it("closes on Maybe Later", async () => {
    const { onOpenChange, onSubmit } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Maybe Later" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("walks through type, details, a required pairing and the confirmation", async () => {
    const { onSubmit, onDone } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Get Started" }));
    await userEvent.click(screen.getByRole("button", { name: "Mortgage" }));

    // Prefilled from the tracking account: its name and what it owes.
    expect((screen.getByLabelText("Give it a nickname") as HTMLInputElement).value).toBe(
      "x-145 HELOC",
    );
    expect((screen.getByLabelText("Current account balance") as HTMLInputElement).value).toBe(
      "4,830.00",
    );
    await userEvent.type(screen.getByLabelText("Interest rate (%)"), "6");
    await userEvent.type(screen.getByLabelText("Monthly payment required by your lender"), "300");
    await userEvent.click(screen.getByLabelText("Yes"));
    await userEvent.type(screen.getByLabelText("How much is the monthly escrow or fee?"), "50");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    // No Skip: Done waits for a category; a new one starts with the loan's name.
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    const done = screen.getByRole("button", { name: "Done" }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    await userEvent.click(screen.getByLabelText(/Create a new category/));
    expect((screen.getByLabelText("Give your category a name") as HTMLInputElement).value).toBe(
      "x-145 HELOC",
    );
    await userEvent.selectOptions(screen.getByLabelText("Add to category group"), "g1");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByText("x-145 HELOC (6%)")).toBeTruthy();
    expect(screen.getByText("-$4830.00")).toBeTruthy();
    expect(screen.getByText("$300.00 monthly")).toBeTruthy();
    expect(screen.getByText("$50.00 escrow")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "x-145 HELOC",
      type: "mortgage",
      balance: "-483000",
      interestRate: "6",
      minimumPayment: "30000",
      escrowAmount: "5000",
      pairing: { name: "x-145 HELOC", groupId: "g1" },
    });
    expect(await screen.findByText("Success!")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledWith("loan-1");
  });

  it("shows the server's refusal on the confirmation step", async () => {
    renderDialog(vi.fn().mockResolvedValue({ error: "This account was already updated" }));
    await userEvent.click(screen.getByRole("button", { name: "Get Started" }));
    await userEvent.click(screen.getByRole("button", { name: "Auto Loan" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.selectOptions(screen.getByLabelText("Select a category"), "c1");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("This account was already updated")).toBeTruthy();
    expect(screen.queryByText("Success!")).toBeNull();
  });
});

describe("Original Tracking Account History", () => {
  it("lists each month's ending balance when opened, and links to the account", async () => {
    const onGoToAccount = vi.fn();
    render(
      <OriginalHistory
        months={[
          { month: "2026-10", endBalance: "0" },
          { month: "2026-09", endBalance: "-480000" },
        ]}
        format={format}
        onGoToAccount={onGoToAccount}
      />,
    );
    expect(screen.queryByText("September 2026")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Closed Account" }));
    expect(screen.getByText("September 2026")).toBeTruthy();
    expect(screen.getByText("-$4800.00")).toBeTruthy();
    expect(screen.getAllByText("Ending balance migrated from the original account")).toHaveLength(
      2,
    );
    await userEvent.click(screen.getByRole("button", { name: "Go To Tracking Account" }));
    expect(onGoToAccount).toHaveBeenCalled();
  });
});
