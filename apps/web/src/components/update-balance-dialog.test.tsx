import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/lib/accounts";
import { UpdateBalanceDialog } from "./loan-dialogs";

const usd = {
  currency: "USD",
  numberFormat: "comma_dot",
  currencySymbolPosition: "before",
  dateFormat: "MM/DD/YYYY",
} as const;
const show = (amount: bigint) =>
  `${amount < 0n ? "−" : ""}$${(Number(amount < 0n ? -amount : amount) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** −$99,498.75 at 6% with $150.00 escrow. */
const mortgage = {
  id: "loan",
  name: "x-126-Mort",
  type: "mortgage",
  interestRate: "6.000",
  minimumPayment: "90000",
  escrowAmount: "15000",
  balances: { cleared: "-9949875", uncleared: "0", working: "-9949875" },
} as Account;

function renderDialog(account: Account, preview: bigint | string = 18188n) {
  const onPreview = vi.fn().mockResolvedValue(preview);
  const onReconcile = vi.fn().mockResolvedValue(null);
  render(
    <UpdateBalanceDialog
      open
      onOpenChange={vi.fn()}
      account={account}
      settings={usd}
      format={show}
      month="2026-10"
      onPreview={onPreview}
      onReconcile={onReconcile}
    />,
  );
  return { onPreview, onReconcile };
}

async function enterBalance(owed: string) {
  await userEvent.click(screen.getByRole("button", { name: "No" }));
  await userEvent.type(
    screen.getByLabelText("Current balance at your financial institution"),
    owed,
  );
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

describe("UpdateBalanceDialog's interest rate / escrow check", () => {
  it("asks about the rate and escrow, then lists the changes", async () => {
    const { onPreview, onReconcile } = renderDialog(mortgage);
    await enterBalance("99400");

    expect(screen.getByText("$98.75")).toBeVisible();
    expect(screen.getByText(/doesn't match your account/)).toBeVisible();
    expect(screen.getByLabelText("Interest rate")).toHaveValue("6");
    expect(screen.getByLabelText("Monthly escrow amount")).toHaveValue("150.00");
    const keepRate = screen.getByRole("checkbox", {
      name: "Keep this new interest rate going forward",
    });
    expect(keepRate).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Keep this new escrow amount going forward" }),
    ).toBeChecked();

    await userEvent.clear(screen.getByLabelText("Interest rate"));
    await userEvent.type(screen.getByLabelText("Interest rate"), "7");
    await userEvent.click(keepRate);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    const loanTerms = {
      interestRate: { rate: "7", keepGoingForward: false },
      escrowAmount: { amount: "15000", keepGoingForward: true },
    };
    expect(onPreview).toHaveBeenCalledWith(-9940000n, loanTerms);
    // The API's adjustment, with October re-estimated at 7%.
    expect(screen.getByText("$181.88")).toBeVisible();
    expect(screen.getByText("+$181.88")).toBeVisible();
    expect(
      screen.getByText("Your interest rate has been changed to 7% for October."),
    ).toBeVisible();
    expect(screen.queryByText(/escrow amount has been changed/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onReconcile).toHaveBeenCalledWith(-9940000n, loanTerms);
    expect(screen.getByText(/Your balance has been updated!/)).toBeVisible();
  });

  it("words an escrow change kept going forward", async () => {
    renderDialog(mortgage, 14875n);
    await enterBalance("99400");
    await userEvent.clear(screen.getByLabelText("Monthly escrow amount"));
    await userEvent.type(screen.getByLabelText("Monthly escrow amount"), "200");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("+$148.75")).toBeVisible();
    expect(
      screen.getByText(
        "Your monthly escrow amount has been changed to $200.00 for October and going forward.",
      ),
    ).toBeVisible();
  });

  it("goes straight to the adjustment when nothing changes", async () => {
    const { onPreview, onReconcile } = renderDialog(mortgage);
    await enterBalance("99400");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByText("+$98.75")).toBeVisible();
    expect(screen.queryByText(/has been changed/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onReconcile).toHaveBeenCalledWith(-9940000n, undefined);
  });

  it("asks only the rate on loans that aren't mortgages", async () => {
    renderDialog({ ...mortgage, type: "personal_loan", escrowAmount: null });
    await enterBalance("99400");
    expect(screen.getByLabelText("Interest rate")).toBeVisible();
    expect(screen.queryByLabelText("Monthly escrow amount")).toBeNull();
  });

  it("refuses a rate it can't read", async () => {
    const { onPreview } = renderDialog(mortgage);
    await enterBalance("99400");
    await userEvent.clear(screen.getByLabelText("Interest rate"));
    await userEvent.type(screen.getByLabelText("Interest rate"), "seven");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Enter the interest rate like 6.125")).toBeVisible();
    expect(onPreview).not.toHaveBeenCalled();
  });
});
